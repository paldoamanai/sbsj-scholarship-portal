-- MSWDO programs' own requirements (run after 070).
--
-- All as photos (JPG or PNG):
--   * To apply: School ID, Certificate of Registration and Barangay Indigency. No letter of intent.
--   * Before approval ("can be follow up"): Latest Grades, Simple Bio Data and a House Photo, with the
--     house pinned on a map (profiles.home_lat / home_lng / home_landmark), and a home visit the
--     office schedules and marks done (applications.home_visit_*).
--   * Before a payment is released: the signed MOA Agreement Letter, filed with the approved
--     application like a letter of intent and verified by the office.
-- Settings → Required Documents now only covers the Sangguniang Bayan Office and programs without an
-- office. Lists are mirrored in src/lib/office-requirements.ts.
--
-- Functions changed by 063 and 070 are edited from their live definitions. Run in the Supabase SQL
-- Editor. Safe to re-run.

BEGIN;

-- ── 1. Requirements by office ──
CREATE OR REPLACE FUNCTION public.office_required_documents(_office TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE _office
    WHEN 'barangay_affairs' THEN '["Student ID", "Barangay Indigency", "Certificate of Registration", "Grades"]'::jsonb
    WHEN 'mswdo' THEN '["School ID", "Certificate of Registration", "Barangay Indigency"]'::jsonb
    ELSE (SELECT CASE WHEN jsonb_typeof(value) = 'array' THEN value END
            FROM public.system_settings WHERE key = 'required_documents')
  END;
$$;

-- Documents that can follow after applying, but are needed (verified) before approval.
CREATE OR REPLACE FUNCTION public.office_followup_documents(_office TEXT)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _office
    WHEN 'mswdo' THEN '["Latest Grades", "Simple Bio Data", "House Photo"]'::jsonb
    ELSE '[]'::jsonb
  END;
$$;

CREATE OR REPLACE FUNCTION public.office_photos_only(_office TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$ SELECT _office IN ('barangay_affairs', 'mswdo'); $$;
CREATE OR REPLACE FUNCTION public.office_asks_letter(_office TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$ SELECT _office IS DISTINCT FROM 'mswdo'; $$;
CREATE OR REPLACE FUNCTION public.office_home_visit(_office TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$ SELECT _office IS NOT DISTINCT FROM 'mswdo'; $$;
CREATE OR REPLACE FUNCTION public.office_requires_moa(_office TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$ SELECT _office IS NOT DISTINCT FROM 'mswdo'; $$;

-- What approval needs: the documents to apply plus the follow-ups.
CREATE OR REPLACE FUNCTION public.program_approval_documents(_scholarship UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.program_required_documents(_scholarship), '[]'::jsonb)
         || public.office_followup_documents(public.scholarship_office(_scholarship));
$$;

CREATE OR REPLACE FUNCTION public.all_required_documents()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(DISTINCT d), '[]'::jsonb)
    FROM (SELECT jsonb_array_elements_text(COALESCE(public.office_required_documents(o), '[]'::jsonb)
                                           || public.office_followup_documents(o)) AS d
            FROM unnest(ARRAY[NULL, 'barangay_affairs', 'mswdo', 'sangguniang_bayan']) AS o) t;
$$;

GRANT EXECUTE ON FUNCTION public.office_followup_documents(TEXT), public.office_asks_letter(TEXT),
  public.office_home_visit(TEXT), public.office_requires_moa(TEXT), public.program_approval_documents(UUID)
  TO anon, authenticated;

-- ── 2. Where the house is (the student's own profile) ──
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS home_lat DOUBLE PRECISION;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS home_lng DOUBLE PRECISION;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS home_landmark TEXT;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_home_location_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_home_location_check CHECK (
  (home_lat IS NULL) = (home_lng IS NULL)
  AND (home_lat IS NULL OR (home_lat BETWEEN -90 AND 90 AND home_lng BETWEEN -180 AND 180))
  AND char_length(COALESCE(home_landmark, '')) <= 200
);

-- ── 3. Home visit, set by the office ──
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS home_visit_at TIMESTAMPTZ;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS home_visit_note TEXT;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS home_visit_done_at TIMESTAMPTZ;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS home_visit_by UUID REFERENCES auth.users (id) ON DELETE SET NULL;

-- Students may edit their own open applications (021), but not the visit.
CREATE OR REPLACE FUNCTION public.guard_home_visit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() = OLD.user_id
     AND ROW(NEW.home_visit_at, NEW.home_visit_note, NEW.home_visit_done_at, NEW.home_visit_by)
         IS DISTINCT FROM ROW(OLD.home_visit_at, OLD.home_visit_note, OLD.home_visit_done_at, OLD.home_visit_by) THEN
    RAISE EXCEPTION 'Only the scholarship office can schedule a home visit';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_guard_home_visit ON public.applications;
CREATE TRIGGER tr_guard_home_visit
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.guard_home_visit();

-- Schedules (or reschedules) the visit; NULL clears it. The student is notified.
CREATE OR REPLACE FUNCTION public.set_home_visit(_application_id UUID, _at TIMESTAMPTZ, _note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller UUID := auth.uid();
  app public.applications%ROWTYPE;
  _sch TEXT;
  _email TEXT;
  _msg TEXT := NULLIF(btrim(COALESCE(_note, '')), '');
BEGIN
  IF NOT public.staff_may(_caller, 'review') OR NOT public.mfa_ok(_caller) THEN
    RAISE EXCEPTION 'Only reviewers and admins can schedule a home visit';
  END IF;
  SELECT * INTO app FROM public.applications WHERE id = _application_id FOR UPDATE;
  IF NOT FOUND OR NOT public.office_ok(public.scholarship_office(app.scholarship_id)) THEN
    RAISE EXCEPTION 'Application not found';
  END IF;
  IF NOT public.office_home_visit(public.scholarship_office(app.scholarship_id)) THEN
    RAISE EXCEPTION 'This program does not do home visits';
  END IF;
  IF app.status NOT IN ('Pending', 'Waitlisted') THEN
    RAISE EXCEPTION 'A home visit can only be scheduled while the application is in review';
  END IF;
  IF char_length(COALESCE(_msg, '')) > 500 THEN
    RAISE EXCEPTION 'Keep the note under 500 characters';
  END IF;

  UPDATE public.applications
     SET home_visit_at = _at, home_visit_note = CASE WHEN _at IS NULL THEN NULL ELSE _msg END,
         home_visit_done_at = NULL, home_visit_by = _caller
   WHERE id = _application_id;

  SELECT name INTO _sch FROM public.scholarships WHERE id = app.scholarship_id;
  IF _at IS NOT NULL THEN
    PERFORM public.notify(app.user_id, 'Home visit scheduled',
      'The office will visit your home for ' || COALESCE(_sch, 'your application') || ' on '
        || to_char(_at AT TIME ZONE 'Asia/Manila', 'FMMonth FMDD, YYYY "at" FMHH12:MI AM') || '.'
        || COALESCE(' ' || _msg, ''),
      'info', 'application', '/student-dashboard?section=application', 'applications', _application_id);
  END IF;

  SELECT email INTO _email FROM auth.users WHERE id = _caller;
  INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, previous_value, new_value)
  VALUES (_caller, _email, CASE WHEN _at IS NULL THEN 'clear_home_visit' ELSE 'schedule_home_visit' END, 'applications', _application_id,
          jsonb_build_object('home_visit_at', app.home_visit_at), jsonb_build_object('home_visit_at', _at, 'note', _msg));
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_home_visit_done(_application_id UUID, _done BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller UUID := auth.uid();
  app public.applications%ROWTYPE;
  _email TEXT;
BEGIN
  IF NOT public.staff_may(_caller, 'review') OR NOT public.mfa_ok(_caller) THEN
    RAISE EXCEPTION 'Only reviewers and admins can record a home visit';
  END IF;
  SELECT * INTO app FROM public.applications WHERE id = _application_id FOR UPDATE;
  IF NOT FOUND OR NOT public.office_ok(public.scholarship_office(app.scholarship_id)) THEN
    RAISE EXCEPTION 'Application not found';
  END IF;
  IF app.status NOT IN ('Pending', 'Waitlisted') THEN
    RAISE EXCEPTION 'The application has been decided';
  END IF;
  IF _done AND app.home_visit_at IS NULL THEN
    RAISE EXCEPTION 'Schedule the home visit first';
  END IF;

  UPDATE public.applications
     SET home_visit_done_at = CASE WHEN _done THEN now() END, home_visit_by = _caller
   WHERE id = _application_id;

  SELECT email INTO _email FROM auth.users WHERE id = _caller;
  INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, new_value)
  VALUES (_caller, _email, CASE WHEN _done THEN 'home_visit_done' ELSE 'home_visit_not_done' END, 'applications', _application_id,
          jsonb_build_object('home_visit_at', app.home_visit_at));
END;
$$;

REVOKE ALL ON FUNCTION public.set_home_visit(UUID, TIMESTAMPTZ, TEXT), public.mark_home_visit_done(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_home_visit(UUID, TIMESTAMPTZ, TEXT), public.mark_home_visit_done(UUID, BOOLEAN) TO authenticated;

-- ── 4. Approving: the visit done and the house pinned, where the office asks ──
CREATE OR REPLACE FUNCTION public.require_office_steps_before_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _office TEXT := public.scholarship_office(NEW.scholarship_id);
BEGIN
  IF NEW.status <> 'Approved' OR OLD.status = 'Approved' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.office_home_visit(_office) AND NEW.home_visit_done_at IS NULL THEN
    RAISE EXCEPTION '%', CASE WHEN NEW.home_visit_at IS NULL THEN 'Schedule and complete the home visit before approving'
                              ELSE 'Mark the home visit done before approving' END;
  END IF;
  IF public.office_followup_documents(_office) ? 'House Photo'
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.user_id AND home_lat IS NOT NULL) THEN
    RAISE EXCEPTION 'The student has not pinned their house on the map yet';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_require_office_steps_before_approval ON public.applications;
CREATE TRIGGER tr_require_office_steps_before_approval
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.require_office_steps_before_approval();

-- ── 5. Applying without a letter of intent, where the office doesn't ask for one (063, plus that) ──
CREATE OR REPLACE FUNCTION public.check_letter_of_intent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  obj_mime TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF coalesce(NEW.letter_of_intent_path, '') = '' THEN
    IF NOT public.office_asks_letter(public.scholarship_office(NEW.scholarship_id)) THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Upload a photo of your letter of intent for this scholarship';
  END IF;
  IF split_part(NEW.letter_of_intent_path, '/', 1) <> NEW.user_id::text OR split_part(NEW.letter_of_intent_path, '/', 2) <> 'letters' THEN
    RAISE EXCEPTION 'Invalid file location';
  END IF;
  SELECT metadata->>'mimetype' INTO obj_mime
    FROM storage.objects WHERE bucket_id = 'documents' AND name = NEW.letter_of_intent_path;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The letter of intent photo could not be found. Please attach it again.';
  END IF;
  IF obj_mime IS NULL OR obj_mime NOT IN ('image/jpeg', 'image/png') THEN
    RAISE EXCEPTION 'The letter of intent must be a photo (JPG or PNG)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.documents WHERE storage_path = NEW.letter_of_intent_path) THEN
    RAISE EXCEPTION 'That photo is already filed with another application. Attach it again.';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 6. The MOA: one per approved application, a photo under "<id>/moa/" ──
CREATE OR REPLACE FUNCTION public.check_moa_document()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  obj_mime TEXT;
BEGIN
  IF NEW.document_type <> 'MOA Agreement Letter' OR auth.uid() IS NULL OR auth.uid() <> NEW.user_id THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.applications a
     WHERE a.id = NEW.application_id AND a.user_id = NEW.user_id AND a.status = 'Approved'
       AND public.office_requires_moa(public.scholarship_office(a.scholarship_id))
  ) THEN
    RAISE EXCEPTION 'The MOA agreement letter is filed with an approved application that asks for one';
  END IF;
  IF split_part(coalesce(NEW.storage_path, ''), '/', 2) <> 'moa' THEN
    RAISE EXCEPTION 'Invalid file location';
  END IF;
  SELECT metadata->>'mimetype' INTO obj_mime
    FROM storage.objects WHERE bucket_id = 'documents' AND name = NEW.storage_path;
  IF obj_mime IS NULL OR obj_mime NOT IN ('image/jpeg', 'image/png') THEN
    RAISE EXCEPTION 'The MOA agreement letter must be a photo (JPG or PNG)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_check_moa_document ON public.documents;
CREATE TRIGGER tr_check_moa_document
  BEFORE INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.check_moa_document();

-- Releasing a payment needs the MOA verified.
CREATE OR REPLACE FUNCTION public.require_moa_before_release()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  latest TEXT;
BEGIN
  IF NEW.status <> 'Disbursed' OR (TG_OP = 'UPDATE' AND OLD.status = 'Disbursed') OR auth.uid() IS NULL
     OR NEW.application_id IS NULL
     OR NOT public.office_requires_moa(public.application_office(NEW.application_id)) THEN
    RETURN NEW;
  END IF;
  SELECT status INTO latest FROM public.documents
   WHERE application_id = NEW.application_id AND document_type = 'MOA Agreement Letter'
   ORDER BY uploaded_at DESC LIMIT 1;
  IF latest IS DISTINCT FROM 'Verified' THEN
    RAISE EXCEPTION 'Verify the student''s signed MOA agreement letter before releasing this payment (%)',
      COALESCE(lower(latest), 'not uploaded yet');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_require_moa_before_release ON public.payments;
CREATE TRIGGER tr_require_moa_before_release
  BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.require_moa_before_release();

-- Tell the student to send it once they're approved.
CREATE OR REPLACE FUNCTION public.ask_for_moa()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'Approved' AND OLD.status IS DISTINCT FROM 'Approved'
     AND public.office_requires_moa(public.scholarship_office(NEW.scholarship_id)) THEN
    PERFORM public.notify(NEW.user_id, 'Upload your signed MOA',
      'Before your first payout, sign the MOA agreement letter and upload a photo of it from your Application tab.',
      'warning', 'application', '/student-dashboard?section=application', 'applications', NEW.id, 'moa-' || NEW.id::text);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_ask_for_moa ON public.applications;
CREATE TRIGGER tr_ask_for_moa
  AFTER UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.ask_for_moa();

-- ── 7. Approval and reminders include the follow-ups; the MOA is left out of the shared rules like letters ──
DO $$
DECLARE
  edits TEXT[][] := ARRAY[
    ['require_verified_documents_before_approval',
     'req := public.program_required_documents(NEW.scholarship_id);',
     'req := public.program_approval_documents(NEW.scholarship_id);'],
    ['send_document_reminders',
     'COALESCE(public.program_required_documents(a.scholarship_id), ''[]''::jsonb)',
     'public.program_approval_documents(a.scholarship_id)'],
    ['validate_document_insert',
     'IF public.documents_locked(NEW.user_id) AND NEW.document_type <> ''Letter of Intent'' AND',
     'IF public.documents_locked(NEW.user_id) AND NEW.document_type NOT IN (''Letter of Intent'', ''MOA Agreement Letter'') AND'],
    ['validate_document_insert',
     'AND NOT (req ? NEW.document_type) AND NEW.document_type <> ''Letter of Intent'' THEN',
     'AND NOT (req ? NEW.document_type) AND NEW.document_type NOT IN (''Letter of Intent'', ''MOA Agreement Letter'') THEN'],
    ['require_accepted_documents',
     'AND d.status = ''Disapproved'' AND d.document_type <> ''Letter of Intent''',
     'AND d.status = ''Disapproved'' AND d.document_type NOT IN (''Letter of Intent'', ''MOA Agreement Letter'')'],
    ['link_application_documents',
     'WHERE application_id = NEW.id AND document_type <> ''Letter of Intent'';',
     'WHERE application_id = NEW.id AND document_type NOT IN (''Letter of Intent'', ''MOA Agreement Letter'');']
  ];
  fn TEXT;
  f RECORD;
  def TEXT;
  patched TEXT;
  i INT;
BEGIN
  FOR fn IN SELECT DISTINCT e FROM unnest(edits[:][1:1]) AS e LOOP
    FOR f IN
      SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = fn
    LOOP
      def := pg_get_functiondef(f.oid);
      patched := def;
      FOR i IN 1 .. array_length(edits, 1) LOOP
        CONTINUE WHEN edits[i][1] <> fn;
        CONTINUE WHEN position(edits[i][3] IN patched) > 0;
        patched := replace(patched, edits[i][2], edits[i][3]);
      END LOOP;
      IF patched <> def THEN EXECUTE patched; END IF;
    END LOOP;
  END LOOP;

  FOR i IN 1 .. array_length(edits, 1) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = edits[i][1]
         AND position(edits[i][3] IN p.prosrc) > 0
    ) THEN
      RAISE EXCEPTION 'Could not update % (looking for: %); update it by hand', edits[i][1], edits[i][2];
    END IF;
  END LOOP;
END $$;

-- ── 8. Storage: MOA photos upload past the approval lock (070, plus "moa") ──
DROP POLICY IF EXISTS "documents_owner_insert" ON storage.objects;
CREATE POLICY "documents_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND ((storage.foldername(name))[2] IN ('receipts', 'letters', 'moa')
         OR NOT public.documents_locked(auth.uid())
         OR ((storage.foldername(name))[2] = 'documents'
             AND public.document_folder_open(auth.uid(), (storage.foldername(name))[3])))
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
