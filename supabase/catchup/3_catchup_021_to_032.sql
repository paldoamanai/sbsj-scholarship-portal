-- Catch-up for migrations 021 to 032 (student applications, documents, scholarships, disbursement,
-- profile, notification settings, notification overhaul, public stats, bug fixes, 2FA-in-RLS).
-- Run once in the Supabase SQL Editor, after 2_catchup_002_to_018.sql and migrations 019 and 020.
-- Each part is safe to re-run. If it stops on an error, fix that and run the whole script again.
-- Migration 032 (2FA enforced in RLS) is the riskiest part here: test with a real MFA-enrolled
-- account before relying on it. See its header comment for what it assumes about your project.

-- ════════════════════════════════════════════════════════════════════
-- 021_student_application_hardening
-- ════════════════════════════════════════════════════════════════════
-- Student application hardening.
--   * students could rewrite their own application row (notes, amount, disbursement status): now locked down
--   * a real "Withdrawn" status instead of deleting (there was never a DELETE policy, so "Cancel" did nothing)
--   * the application now carries a statement, household details, a certification and a snapshot of the
--     student's school details at the time of applying
--   * required documents are enforced on submit; documents are linked to the application they were filed with
-- Run after 020. Safe to re-run.

-- ── 1. Withdrawn status + new columns ──
ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_status_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_status_check
  CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Waitlisted', 'Withdrawn'));

ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS statement TEXT;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS household_income NUMERIC;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS household_size INTEGER;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS certified_at TIMESTAMPTZ;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS school_name TEXT;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS course TEXT;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS year_level TEXT;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS average_grade NUMERIC;

-- ── 2. Students may only edit/withdraw their own open applications ──
DROP POLICY IF EXISTS "Users can update own pending applications" ON public.applications;
DROP POLICY IF EXISTS "Users can update own open applications" ON public.applications;
CREATE POLICY "Users can update own open applications" ON public.applications
  FOR UPDATE
  USING (auth.uid() = user_id AND status IN ('Pending', 'Waitlisted'))
  WITH CHECK (auth.uid() = user_id AND status IN ('Pending', 'Waitlisted', 'Withdrawn'));

-- ── 3. Column guard: an owner can change only their statement/household details, or withdraw ──
-- Updates by anyone other than the owner (admins, via their own RLS policy) and updates fired from
-- another trigger (payments -> disbursement sync) are not restricted here.
CREATE OR REPLACE FUNCTION public.protect_application_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR auth.uid() IS NULL OR auth.uid() <> OLD.user_id THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.scholarship_id IS DISTINCT FROM OLD.scholarship_id
     OR NEW.disbursement_status IS DISTINCT FROM OLD.disbursement_status
     OR NEW.amount_approved IS DISTINCT FROM OLD.amount_approved
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.academic_year IS DISTINCT FROM OLD.academic_year
     OR NEW.semester IS DISTINCT FROM OLD.semester
     OR NEW.is_renewal IS DISTINCT FROM OLD.is_renewal
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.certified_at IS DISTINCT FROM OLD.certified_at
     OR NEW.school_name IS DISTINCT FROM OLD.school_name
     OR NEW.course IS DISTINCT FROM OLD.course
     OR NEW.year_level IS DISTINCT FROM OLD.year_level
     OR NEW.average_grade IS DISTINCT FROM OLD.average_grade THEN
    RAISE EXCEPTION 'You can only edit your statement and household details on your own application';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (NEW.status = 'Withdrawn' AND OLD.status IN ('Pending', 'Waitlisted')) THEN
    RAISE EXCEPTION 'Only a pending or waitlisted application can be withdrawn';
  END IF;

  IF (NEW.statement IS DISTINCT FROM OLD.statement
      OR NEW.household_income IS DISTINCT FROM OLD.household_income
      OR NEW.household_size IS DISTINCT FROM OLD.household_size) THEN
    IF OLD.status <> 'Pending' THEN
      RAISE EXCEPTION 'Only a pending application can be edited';
    END IF;
    IF char_length(btrim(COALESCE(NEW.statement, ''))) < 50 OR char_length(NEW.statement) > 2000 THEN
      RAISE EXCEPTION 'Your statement must be between 50 and 2000 characters';
    END IF;
    IF NEW.household_income IS NOT NULL AND NEW.household_income < 0 THEN
      RAISE EXCEPTION 'Household income cannot be negative';
    END IF;
    IF NEW.household_size IS NOT NULL AND (NEW.household_size < 1 OR NEW.household_size > 30) THEN
      RAISE EXCEPTION 'Household size must be between 1 and 30';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_application_columns ON public.applications;
CREATE TRIGGER tr_protect_application_columns
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.protect_application_columns();

-- ── 4. Insert rules: withdrawn applications don't count, required documents, statement, snapshot ──
CREATE OR REPLACE FUNCTION public.enforce_application_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  open_d TEXT := public.setting_text('application_open_date', '');
  close_d TEXT := public.setting_text('application_close_date', '');
  min_grade NUMERIC := public.setting_number('min_grade_requirement', 0);
  max_apps INTEGER := public.setting_number('max_scholarships_per_student', 1)::integer;
  prior_approved INTEGER;
  year_count INTEGER;
  required_docs JSONB;
  missing TEXT;
  prof public.profiles%ROWTYPE;
BEGIN
  IF public.setting_bool('maintenance_mode', false) THEN
    RAISE EXCEPTION '%', public.setting_text('maintenance_message', 'The portal is temporarily unavailable for submissions.');
  END IF;
  IF NOT public.setting_bool('applications_open', true) THEN
    RAISE EXCEPTION 'Applications are currently closed';
  END IF;
  IF open_d <> '' AND CURRENT_DATE < open_d::date THEN
    RAISE EXCEPTION 'Applications open on %', to_char(open_d::date, 'FMMonth DD, YYYY');
  END IF;
  IF close_d <> '' AND CURRENT_DATE > close_d::date THEN
    RAISE EXCEPTION 'The application period ended on %', to_char(close_d::date, 'FMMonth DD, YYYY');
  END IF;

  -- Renewals: a student with an earlier approved application is renewing.
  -- prior_approved = renewals already used + 1, so allowing up to max_renewals means
  -- one original award plus max_renewals renewals.
  SELECT COUNT(*) INTO prior_approved FROM public.applications
   WHERE user_id = NEW.user_id AND status = 'Approved';
  IF prior_approved > 0 THEN
    IF NOT public.setting_bool('renewal_enabled', true) THEN
      RAISE EXCEPTION 'Scholarship renewals are not open right now';
    END IF;
    IF prior_approved > public.setting_number('max_renewals', 3) THEN
      RAISE EXCEPTION 'You have reached the maximum of % renewal(s)', public.setting_number('max_renewals', 3)::integer;
    END IF;
    min_grade := public.setting_number('renewal_min_grade', min_grade);
    NEW.is_renewal := true;
  END IF;

  SELECT * INTO prof FROM public.profiles WHERE id = NEW.user_id;

  IF min_grade > 0 THEN
    IF prof.average_grade IS NULL THEN
      RAISE EXCEPTION 'Add your average grade to your profile before applying (minimum required: %)', min_grade;
    END IF;
    IF prof.average_grade < min_grade THEN
      RAISE EXCEPTION 'Your average grade (%) is below the minimum of % required to apply', prof.average_grade, min_grade;
    END IF;
  END IF;

  -- A withdrawn application frees the slot again.
  SELECT COUNT(*) INTO year_count FROM public.applications
   WHERE user_id = NEW.user_id
     AND status <> 'Withdrawn'
     AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM now());
  IF year_count >= max_apps THEN
    RAISE EXCEPTION 'You have reached the limit of % application(s) for this year', max_apps;
  END IF;

  -- Checks for applications submitted by a signed-in student (not seed / service-role inserts).
  IF auth.uid() IS NOT NULL THEN
    IF char_length(btrim(COALESCE(NEW.statement, ''))) < 50 OR char_length(NEW.statement) > 2000 THEN
      RAISE EXCEPTION 'Your statement must be between 50 and 2000 characters';
    END IF;
    IF NEW.household_income IS NOT NULL AND NEW.household_income < 0 THEN
      RAISE EXCEPTION 'Household income cannot be negative';
    END IF;
    IF NEW.household_size IS NOT NULL AND (NEW.household_size < 1 OR NEW.household_size > 30) THEN
      RAISE EXCEPTION 'Household size must be between 1 and 30';
    END IF;
    IF NEW.certified_at IS NULL THEN
      RAISE EXCEPTION 'You must certify that the information you provided is true';
    END IF;

    -- Every required document must be on file and not yet attached to another application.
    SELECT value INTO required_docs FROM public.system_settings WHERE key = 'required_documents';
    IF required_docs IS NOT NULL AND jsonb_typeof(required_docs) = 'array' THEN
      SELECT string_agg(d, ', ') INTO missing
        FROM jsonb_array_elements_text(required_docs) AS d
       WHERE NOT EXISTS (
         SELECT 1 FROM public.documents doc
          WHERE doc.user_id = NEW.user_id AND doc.application_id IS NULL AND doc.document_type = d
       );
      IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'Upload all required documents before applying. Missing: %', missing;
      END IF;
    END IF;
  END IF;

  -- Server-set values the student can't spoof.
  IF NEW.certified_at IS NOT NULL THEN NEW.certified_at := now(); END IF;
  NEW.school_name := prof.school_name;
  NEW.course := prof.course;
  NEW.year_level := prof.year_level;
  NEW.average_grade := prof.average_grade;
  NEW.academic_year := public.setting_text('academic_year', NULL);
  NEW.semester := public.setting_text('current_semester', NULL);
  RETURN NEW;
END;
$$;

-- ── 5. Documents follow the application: attached on submit, released again on withdrawal ──
CREATE OR REPLACE FUNCTION public.link_application_documents()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.documents SET application_id = NEW.id
     WHERE user_id = NEW.user_id AND application_id IS NULL;
  ELSIF NEW.status = 'Withdrawn' AND OLD.status <> 'Withdrawn' THEN
    UPDATE public.documents SET application_id = NULL WHERE application_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_link_application_documents ON public.applications;
CREATE TRIGGER tr_link_application_documents
  AFTER INSERT OR UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.link_application_documents();

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════
-- 022_document_hardening
-- ════════════════════════════════════════════════════════════════════
-- Document hardening. Run after 021. Safe to re-run.
--   * uploads go straight from the browser to storage, so the rules must live in the database:
--     file type + size (read from the stored object, not from what the client claims), document type,
--     ownership of the linked application, and the lock after approval
--   * students can remove / replace documents (and the stored file goes with it)
--   * admins review documents (Pending / Verified / Rejected + reason); the student is notified
--   * documents record the storage path, size and MIME type; the stored "public URL" was never usable

-- ── 1. Columns ──
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'Pending';
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_status_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_status_check CHECK (status IN ('Pending', 'Verified', 'Rejected'));

-- Older rows kept a (private-bucket) public URL: recover the object path where it is unambiguous.
UPDATE public.documents
   SET storage_path = substring(file_url from '/documents/([^?]+)$')
 WHERE storage_path IS NULL AND file_url LIKE '%/documents/%' AND position('%' in file_url) = 0;

CREATE INDEX IF NOT EXISTS documents_user_type_idx ON public.documents (user_id, document_type);

-- ── 2. Bucket-level limits (hard cap; the configurable limit is enforced in step 4) ──
UPDATE storage.buckets
   SET file_size_limit = 25 * 1024 * 1024,
       allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png']
 WHERE id = 'documents';

-- ── 3. Lock: no document changes once this year's application is approved ──
CREATE OR REPLACE FUNCTION public.documents_locked(_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.applications
     WHERE user_id = _user
       AND status = 'Approved'
       AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM now())
  );
$$;

-- ── 4. Validate every student upload ──
CREATE OR REPLACE FUNCTION public.validate_document_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req JSONB;
  obj_size BIGINT;
  obj_mime TEXT;
  max_mb NUMERIC := public.setting_number('max_upload_mb', 5);
BEGIN
  -- Only student uploads are checked (not service-role / seed inserts).
  IF auth.uid() IS NULL OR auth.uid() <> NEW.user_id THEN
    RETURN NEW;
  END IF;

  IF public.setting_bool('maintenance_mode', false) THEN
    RAISE EXCEPTION '%', public.setting_text('maintenance_message', 'The portal is temporarily unavailable for submissions.');
  END IF;
  IF public.documents_locked(NEW.user_id) THEN
    RAISE EXCEPTION 'Your documents are locked because your scholarship has been approved';
  END IF;

  IF NEW.storage_path IS NULL OR split_part(NEW.storage_path, '/', 1) <> NEW.user_id::text THEN
    RAISE EXCEPTION 'Invalid file location';
  END IF;

  SELECT value INTO req FROM public.system_settings WHERE key = 'required_documents';
  IF req IS NOT NULL AND jsonb_typeof(req) = 'array' AND NOT (req ? NEW.document_type) THEN
    RAISE EXCEPTION '"%" is not a document we ask for', NEW.document_type;
  END IF;

  IF NEW.application_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.applications
     WHERE id = NEW.application_id AND user_id = NEW.user_id AND status <> 'Withdrawn'
  ) THEN
    RAISE EXCEPTION 'That application is not yours or is no longer open';
  END IF;

  -- The stored object is the source of truth for size and type.
  SELECT (metadata->>'size')::bigint, metadata->>'mimetype'
    INTO obj_size, obj_mime
    FROM storage.objects
   WHERE bucket_id = 'documents' AND name = NEW.storage_path;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The uploaded file could not be found. Please try again.';
  END IF;
  IF obj_mime IS NULL OR obj_mime NOT IN ('application/pdf', 'image/jpeg', 'image/png') THEN
    RAISE EXCEPTION 'Only PDF, JPG and PNG files are allowed';
  END IF;
  IF obj_size IS NULL OR obj_size <= 0 THEN
    RAISE EXCEPTION 'The file is empty';
  END IF;
  IF obj_size > max_mb * 1024 * 1024 THEN
    RAISE EXCEPTION 'File is too large (max % MB)', trim_scale(max_mb);
  END IF;

  NEW.file_size := obj_size;
  NEW.mime_type := obj_mime;
  NEW.file_url := NEW.storage_path;
  NEW.status := 'Pending';
  NEW.review_note := NULL;
  NEW.reviewed_by := NULL;
  NEW.reviewed_at := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_validate_document_insert ON public.documents;
CREATE TRIGGER tr_validate_document_insert
  BEFORE INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.validate_document_insert();

-- ── 5. Row policies ──
-- Students may remove: an unattached document, a rejected one, or one that has been replaced by a newer upload.
DROP POLICY IF EXISTS "Users can delete own documents" ON public.documents;
CREATE POLICY "Users can delete own documents" ON public.documents
  FOR DELETE USING (
    auth.uid() = user_id
    AND NOT public.documents_locked(user_id)
    AND (
      application_id IS NULL
      OR status = 'Rejected'
      OR EXISTS (
        SELECT 1 FROM public.documents n
         WHERE n.user_id = documents.user_id
           AND n.document_type = documents.document_type
           AND n.uploaded_at > documents.uploaded_at
      )
    )
  );

-- Staff (same roles the storage policies already use) can read and review every document.
DROP POLICY IF EXISTS "Staff can view all documents" ON public.documents;
CREATE POLICY "Staff can view all documents" ON public.documents
  FOR SELECT USING (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Staff can review documents" ON public.documents;
CREATE POLICY "Staff can review documents" ON public.documents
  FOR UPDATE USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- ── 6. Review guard: staff can change only the review fields ──
CREATE OR REPLACE FUNCTION public.guard_document_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF ROW(NEW.user_id, NEW.application_id, NEW.document_type, NEW.file_url, NEW.file_name,
         NEW.storage_path, NEW.file_size, NEW.mime_type, NEW.uploaded_at)
     IS DISTINCT FROM
     ROW(OLD.user_id, OLD.application_id, OLD.document_type, OLD.file_url, OLD.file_name,
         OLD.storage_path, OLD.file_size, OLD.mime_type, OLD.uploaded_at) THEN
    RAISE EXCEPTION 'Only the review status of a document can be changed';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.review_note IS DISTINCT FROM OLD.review_note THEN
    IF NEW.status = 'Rejected' AND btrim(COALESCE(NEW.review_note, '')) = '' THEN
      RAISE EXCEPTION 'Add a reason so the student knows what to fix';
    END IF;
    IF NEW.status = 'Pending' THEN
      NEW.review_note := NULL;
      NEW.reviewed_by := NULL;
      NEW.reviewed_at := NULL;
    ELSE
      NEW.reviewed_by := auth.uid();
      NEW.reviewed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_guard_document_review ON public.documents;
CREATE TRIGGER tr_guard_document_review
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_document_review();

-- ── 7. Notifications + audit ──
-- Admins: one heads-up per student per day, not one per file.
CREATE OR REPLACE FUNCTION public.notify_document_uploaded()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.notify_admins('Documents Uploaded', public.display_name(NEW.user_id) || ' uploaded documents for review.',
    'info', 'application', '/admin?section=applications', 'documents', NEW.id,
    'doc-upload:' || NEW.user_id::text || ':' || to_char(now(), 'YYYY-MM-DD'));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_notify_document_uploaded ON public.documents;
CREATE TRIGGER tr_notify_document_uploaded
  AFTER INSERT ON public.documents FOR EACH ROW EXECUTE FUNCTION public.notify_document_uploaded();

-- Student: told when a document is verified or rejected (with the reason). Reviews are audited.
CREATE OR REPLACE FUNCTION public.notify_document_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  IF NEW.status = 'Verified' THEN
    PERFORM public.notify(NEW.user_id, 'Document Verified', 'Your ' || NEW.document_type || ' was verified.',
      'success', 'application', '/student-dashboard?section=documents', 'documents', NEW.id);
    PERFORM public.write_audit('verify_document', 'documents', NEW.id, jsonb_build_object('status', OLD.status), jsonb_build_object('status', NEW.status));
  ELSIF NEW.status = 'Rejected' THEN
    PERFORM public.notify(NEW.user_id, 'Document Needs Attention', 'Your ' || NEW.document_type || ' was not accepted. Reason: ' || NEW.review_note || ' Please upload a new copy.',
      'warning', 'application', '/student-dashboard?section=documents', 'documents', NEW.id);
    PERFORM public.write_audit('reject_document', 'documents', NEW.id, jsonb_build_object('status', OLD.status), jsonb_build_object('status', NEW.status, 'note', NEW.review_note));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_notify_document_review ON public.documents;
CREATE TRIGGER tr_notify_document_review
  AFTER UPDATE OF status ON public.documents FOR EACH ROW EXECUTE FUNCTION public.notify_document_review();

-- ── 8. A rejected document must be replaced before applying ──
CREATE OR REPLACE FUNCTION public.require_accepted_documents()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bad TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  SELECT string_agg(DISTINCT d.document_type, ', ') INTO bad
    FROM public.documents d
   WHERE d.user_id = NEW.user_id AND d.application_id IS NULL AND d.status = 'Rejected'
     AND NOT EXISTS (
       SELECT 1 FROM public.documents n
        WHERE n.user_id = d.user_id AND n.application_id IS NULL
          AND n.document_type = d.document_type AND n.uploaded_at > d.uploaded_at
     );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Replace the rejected documents before applying: %', bad;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_require_accepted_documents ON public.applications;
CREATE TRIGGER tr_require_accepted_documents
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.require_accepted_documents();

-- ── 9. Storage policies: same lock, and students can remove their own document files (never receipts) ──
DROP POLICY IF EXISTS "documents_owner_insert" ON storage.objects;
CREATE POLICY "documents_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND ((storage.foldername(name))[2] = 'receipts' OR NOT public.documents_locked(auth.uid()))
  );

DROP POLICY IF EXISTS "documents_owner_delete" ON storage.objects;
CREATE POLICY "documents_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND COALESCE((storage.foldername(name))[2], '') <> 'receipts'
    AND NOT public.documents_locked(auth.uid())
  );

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════
-- 023_require_verified_documents
-- ════════════════════════════════════════════════════════════════════
-- An application can only be approved once every required document has been verified.
-- "Latest copy wins": for each required document type, the newest upload that belongs to this
-- application (or is still unattached, for applications that predate document linking) must be
-- Verified. Missing, Pending and Rejected copies all block approval.
-- Run after 022. Safe to re-run. Updates with no signed-in user (SQL editor / service role) are not checked.

CREATE OR REPLACE FUNCTION public.require_verified_documents_before_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req JSONB;
  outstanding TEXT;
BEGIN
  IF NEW.status <> 'Approved' OR OLD.status = 'Approved' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT value INTO req FROM public.system_settings WHERE key = 'required_documents';
  IF req IS NULL OR jsonb_typeof(req) <> 'array' THEN
    RETURN NEW;
  END IF;

  SELECT string_agg(
           d || CASE WHEN latest.status IS NULL THEN ' (missing)' ELSE ' (' || lower(latest.status) || ')' END,
           ', ')
    INTO outstanding
    FROM jsonb_array_elements_text(req) AS d
    LEFT JOIN LATERAL (
      SELECT doc.status
        FROM public.documents doc
       WHERE doc.user_id = NEW.user_id
         AND doc.document_type = d
         AND (doc.application_id = NEW.id OR doc.application_id IS NULL)
       ORDER BY doc.uploaded_at DESC
       LIMIT 1
    ) latest ON true
   WHERE latest.status IS DISTINCT FROM 'Verified';

  IF outstanding IS NOT NULL THEN
    RAISE EXCEPTION 'Verify all required documents before approving. Outstanding: %', outstanding;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_require_verified_documents_before_approval ON public.applications;
CREATE TRIGGER tr_require_verified_documents_before_approval
  BEFORE UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.require_verified_documents_before_approval();

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════
-- 024_scholarship_hardening
-- ════════════════════════════════════════════════════════════════════
-- Scholarship programs: real award amounts and budgets, per-program eligibility rules, an opening
-- date, safe edits, and a public listing that shows availability without exposing the budget.
-- Run after 023. Safe to re-run.

-- ── 1. Columns and constraints ──
ALTER TABLE public.scholarships ADD COLUMN IF NOT EXISTS open_date DATE;
ALTER TABLE public.scholarships ADD COLUMN IF NOT EXISTS min_grade NUMERIC;         -- NULL = only the global minimum applies
ALTER TABLE public.scholarships ADD COLUMN IF NOT EXISTS year_levels TEXT[];        -- NULL / empty = any year level
ALTER TABLE public.scholarships ADD COLUMN IF NOT EXISTS municipality TEXT;         -- NULL / empty = any residence

ALTER TABLE public.scholarships DROP CONSTRAINT IF EXISTS scholarships_budget_nonneg;
ALTER TABLE public.scholarships ADD CONSTRAINT scholarships_budget_nonneg CHECK (total_budget IS NULL OR total_budget >= 0);
ALTER TABLE public.scholarships DROP CONSTRAINT IF EXISTS scholarships_min_grade_range;
ALTER TABLE public.scholarships ADD CONSTRAINT scholarships_min_grade_range CHECK (min_grade IS NULL OR (min_grade >= 0 AND min_grade <= 100));
ALTER TABLE public.scholarships DROP CONSTRAINT IF EXISTS scholarships_window;
ALTER TABLE public.scholarships ADD CONSTRAINT scholarships_window CHECK (open_date IS NULL OR deadline IS NULL OR open_date <= deadline);

-- ── 2. Money committed to a program = approved awards (the program amount where none was set) ──
CREATE OR REPLACE FUNCTION public.scholarship_committed(_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(COALESCE(a.amount_approved, s.amount, 0)), 0)
    FROM public.applications a
    JOIN public.scholarships s ON s.id = a.scholarship_id
   WHERE a.scholarship_id = _id AND a.status = 'Approved';
$$;

-- ── 3. Safe edits by admins ──
CREATE OR REPLACE FUNCTION public.validate_scholarship_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  approved INTEGER;
  committed NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;   -- seed / service role

  NEW.name := btrim(NEW.name);
  IF NEW.name = '' THEN RAISE EXCEPTION 'Name is required'; END IF;

  IF NEW.deadline IS NOT NULL AND NEW.deadline < CURRENT_DATE
     AND (TG_OP = 'INSERT' OR NEW.deadline IS DISTINCT FROM OLD.deadline) THEN
    RAISE EXCEPTION 'The deadline cannot be in the past';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.slots > 0 AND NEW.slots IS DISTINCT FROM OLD.slots THEN
      SELECT COUNT(*) INTO approved FROM public.applications WHERE scholarship_id = NEW.id AND status = 'Approved';
      IF NEW.slots < approved THEN
        RAISE EXCEPTION 'Slots cannot be lower than the % scholar(s) already approved', approved;
      END IF;
    END IF;
    IF NEW.total_budget > 0 AND NEW.total_budget IS DISTINCT FROM OLD.total_budget THEN
      committed := public.scholarship_committed(NEW.id);
      IF NEW.total_budget < committed THEN
        RAISE EXCEPTION 'The budget cannot be lower than the % already committed to approved scholars', committed;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_validate_scholarship_change ON public.scholarships;
CREATE TRIGGER tr_validate_scholarship_change
  BEFORE INSERT OR UPDATE ON public.scholarships
  FOR EACH ROW EXECUTE FUNCTION public.validate_scholarship_change();

-- ── 4. Applying: opening date and the program's own eligibility rules ──
CREATE OR REPLACE FUNCTION public.enforce_scholarship_open()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.scholarships%ROWTYPE;
  prof public.profiles%ROWTYPE;
  approved_count INTEGER;
BEGIN
  IF NEW.scholarship_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO s FROM public.scholarships WHERE id = NEW.scholarship_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scholarship program not found';
  END IF;
  IF NOT s.is_active THEN
    RAISE EXCEPTION '% is not accepting applications', s.name;
  END IF;
  IF s.open_date IS NOT NULL AND s.open_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Applications for % open on %', s.name, to_char(s.open_date, 'FMMonth DD, YYYY');
  END IF;
  IF s.deadline IS NOT NULL AND s.deadline < CURRENT_DATE THEN
    RAISE EXCEPTION 'The deadline for % has passed (%)', s.name, s.deadline;
  END IF;
  IF s.slots > 0 THEN
    SELECT COUNT(*) INTO approved_count FROM public.applications
     WHERE scholarship_id = s.id AND status = 'Approved';
    IF approved_count >= s.slots THEN
      RAISE EXCEPTION 'All % slots for % are already filled', s.slots, s.name;
    END IF;
  END IF;

  -- The program's own eligibility rules (for signed-in students; not seed / service-role inserts).
  IF auth.uid() IS NOT NULL THEN
    SELECT * INTO prof FROM public.profiles WHERE id = NEW.user_id;

    IF s.min_grade IS NOT NULL AND s.min_grade > 0 THEN
      IF prof.average_grade IS NULL THEN
        RAISE EXCEPTION 'Add your average grade to your profile before applying to % (minimum: %)', s.name, s.min_grade;
      END IF;
      IF prof.average_grade < s.min_grade THEN
        RAISE EXCEPTION 'Your average grade (%) is below the % required for %', prof.average_grade, s.min_grade, s.name;
      END IF;
    END IF;
    IF s.year_levels IS NOT NULL AND cardinality(s.year_levels) > 0
       AND (prof.year_level IS NULL OR NOT (prof.year_level = ANY (s.year_levels))) THEN
      RAISE EXCEPTION '% is open to % students only', s.name, array_to_string(s.year_levels, ', ');
    END IF;
    IF btrim(COALESCE(s.municipality, '')) <> ''
       AND lower(btrim(COALESCE(prof.municipality, ''))) <> lower(btrim(s.municipality)) THEN
      RAISE EXCEPTION '% is for residents of % only', s.name, s.municipality;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 5. Approving: award the program amount and respect the budget ──
CREATE OR REPLACE FUNCTION public.apply_scholarship_award()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.scholarships%ROWTYPE;
  committed NUMERIC;
BEGIN
  IF NEW.status <> 'Approved' OR OLD.status = 'Approved' THEN RETURN NEW; END IF;

  SELECT * INTO s FROM public.scholarships WHERE id = NEW.scholarship_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.amount_approved IS NULL AND COALESCE(s.amount, 0) > 0 THEN
    NEW.amount_approved := s.amount;
  END IF;

  IF COALESCE(s.total_budget, 0) > 0 THEN
    committed := public.scholarship_committed(s.id);   -- this application isn't Approved yet, so it isn't counted
    IF committed + COALESCE(NEW.amount_approved, 0) > s.total_budget THEN
      RAISE EXCEPTION 'Approving this would exceed the budget for % (% of % already committed)', s.name, committed, s.total_budget;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_apply_scholarship_award ON public.applications;
CREATE TRIGGER tr_apply_scholarship_award
  BEFORE UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.apply_scholarship_award();

-- ── 6. Public listing: availability without exposing the budget ──
CREATE OR REPLACE FUNCTION public.scholarships_public()
RETURNS TABLE (
  id UUID, name TEXT, description TEXT, amount NUMERIC, slots INTEGER, slots_left INTEGER,
  deadline DATE, open_date DATE, eligibility TEXT, min_grade NUMERIC, year_levels TEXT[],
  municipality TEXT, created_at TIMESTAMPTZ, availability TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.name, s.description, s.amount, s.slots,
         CASE WHEN s.slots > 0 THEN GREATEST(s.slots - a.cnt, 0) END,
         s.deadline, s.open_date, s.eligibility, s.min_grade, s.year_levels, s.municipality, s.created_at,
         CASE
           WHEN s.open_date IS NOT NULL AND s.open_date > CURRENT_DATE THEN 'upcoming'
           WHEN s.deadline IS NOT NULL AND s.deadline < CURRENT_DATE THEN 'closed'
           WHEN s.slots > 0 AND a.cnt >= s.slots THEN 'full'
           ELSE 'open'
         END
    FROM public.scholarships s
   CROSS JOIN LATERAL (
     SELECT COUNT(*)::int AS cnt FROM public.applications ap WHERE ap.scholarship_id = s.id AND ap.status = 'Approved'
   ) a
   WHERE s.is_active
   ORDER BY s.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.scholarships_public() TO anon, authenticated;

-- The public (signed-out) role no longer reads the budget column directly.
REVOKE SELECT ON public.scholarships FROM anon;
GRANT SELECT (id, name, description, amount, slots, is_active, deadline, eligibility, created_at,
              open_date, min_grade, year_levels, municipality)
  ON public.scholarships TO anon;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════
-- 025_student_disbursement
-- ════════════════════════════════════════════════════════════════════
-- Student disbursement. Run after 024. Safe to re-run.
--   * receipts are verified (the file must exist, be a PDF/JPG/PNG within the upload limit) and can't be
--     overwritten once submitted, unless staff rejected them
--   * staff review student receipts (Accepted / Rejected + reason) and the student is told
--   * students can report a problem with a payment (not received, wrong amount, other); staff respond
--   * cancelled payments carry a reason the student can see
--   * claim instructions (pickup place / what to bring) are settings shown to the student

-- ── 1. Columns ──
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS receipt_review_status TEXT NOT NULL DEFAULT 'Pending';
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS receipt_review_note TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS receipt_reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS receipt_reviewed_at TIMESTAMPTZ;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_receipt_review_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_receipt_review_check
  CHECK (receipt_review_status IN ('Pending', 'Accepted', 'Rejected'));

-- ── 2. Disbursed payments stay locked, except the receipt fields and their review ──
CREATE OR REPLACE FUNCTION public.guard_payments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'Disbursed' THEN
      RAISE EXCEPTION 'Disbursed payments are locked and cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'Disbursed' THEN
    -- Only the student's receipt and its review may change once disbursed.
    IF (to_jsonb(NEW) - 'student_receipt_path' - 'student_receipt_at'
                      - 'receipt_review_status' - 'receipt_review_note' - 'receipt_reviewed_by' - 'receipt_reviewed_at')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'student_receipt_path' - 'student_receipt_at'
                      - 'receipt_review_status' - 'receipt_review_note' - 'receipt_reviewed_by' - 'receipt_reviewed_at') THEN
      RAISE EXCEPTION 'Disbursed payments are locked';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.application_id IS NOT NULL THEN
    SELECT status INTO app_status FROM public.applications WHERE id = NEW.application_id;
    IF app_status IS DISTINCT FROM 'Approved' THEN
      RAISE EXCEPTION 'Payments can only be created for approved applications';
    END IF;
  END IF;

  IF NEW.preferred_method IS NOT NULL AND NEW.status <> 'Cancelled' AND NEW.method IS DISTINCT FROM NEW.preferred_method THEN
    RAISE EXCEPTION 'The student chose % for this payment, so the method cannot be changed', NEW.preferred_method;
  END IF;

  IF NEW.status = 'Disbursed' THEN
    IF NEW.method NOT IN ('Cash', 'Cheque') THEN
      RAISE EXCEPTION 'Only Cash or Cheque payments can be disbursed';
    END IF;
    IF NEW.method = 'Cheque' AND COALESCE(btrim(NEW.reference), '') = '' THEN
      RAISE EXCEPTION 'A cheque number is required';
    END IF;
    IF NEW.receipt_path IS NULL THEN
      RAISE EXCEPTION 'A receipt is required before marking as disbursed';
    END IF;
    NEW.disbursed_at := COALESCE(NEW.disbursed_at, now());
  END IF;

  RETURN NEW;
END;
$$;

-- ── 3. Student receipt: verified, and not overwritable once submitted ──
CREATE OR REPLACE FUNCTION public.submit_student_receipt(_payment_id UUID, _path TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay public.payments%ROWTYPE;
  obj_size BIGINT;
  obj_mime TEXT;
  max_mb NUMERIC := public.setting_number('max_upload_mb', 5);
BEGIN
  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND OR pay.user_id <> auth.uid() THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF pay.status <> 'Disbursed' THEN RAISE EXCEPTION 'A receipt can only be submitted for a disbursed payment'; END IF;

  -- One submission, unless staff rejected it and asked for another.
  IF pay.student_receipt_at IS NOT NULL AND pay.receipt_review_status <> 'Rejected' THEN
    RAISE EXCEPTION 'You have already submitted your receipt for this payment';
  END IF;

  IF _path IS NULL THEN
    IF pay.method <> 'Cash' THEN RAISE EXCEPTION 'Please upload the signed receipt for a cheque payment'; END IF;
  ELSE
    IF _path NOT LIKE (auth.uid()::text || '/receipts/' || _payment_id::text || '/%') THEN
      RAISE EXCEPTION 'Invalid receipt path';
    END IF;
    -- The stored object is the source of truth for type and size.
    SELECT (metadata->>'size')::bigint, metadata->>'mimetype'
      INTO obj_size, obj_mime
      FROM storage.objects
     WHERE bucket_id = 'documents' AND name = _path;
    IF NOT FOUND THEN RAISE EXCEPTION 'The uploaded file could not be found. Please try again.'; END IF;
    IF obj_mime IS NULL OR obj_mime NOT IN ('application/pdf', 'image/jpeg', 'image/png') THEN
      RAISE EXCEPTION 'Only PDF, JPG and PNG files are allowed';
    END IF;
    IF obj_size IS NULL OR obj_size <= 0 THEN RAISE EXCEPTION 'The file is empty'; END IF;
    IF obj_size > max_mb * 1024 * 1024 THEN RAISE EXCEPTION 'File is too large (max % MB)', trim_scale(max_mb); END IF;
  END IF;

  UPDATE public.payments
     SET student_receipt_path = _path, student_receipt_at = now(),
         receipt_review_status = 'Pending', receipt_review_note = NULL,
         receipt_reviewed_by = NULL, receipt_reviewed_at = NULL
   WHERE id = _payment_id;

  PERFORM public.notify_admins(
    CASE WHEN _path IS NULL THEN 'Cash Receipt Confirmed' ELSE 'Receipt Submitted' END,
    CASE WHEN _path IS NULL THEN public.display_name(auth.uid()) || ' confirmed receiving a cash payment (no file attached).'
         ELSE public.display_name(auth.uid()) || ' submitted a signed receipt for a disbursed payment.' END,
    'info', 'payment', '/admin?section=disbursement', 'payments', _payment_id);
END;
$$;

-- ── 4. Staff review of the student's receipt ──
CREATE OR REPLACE FUNCTION public.review_student_receipt(_payment_id UUID, _status TEXT, _note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay public.payments%ROWTYPE;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _status NOT IN ('Accepted', 'Rejected') THEN RAISE EXCEPTION 'Choose Accepted or Rejected'; END IF;

  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF pay.student_receipt_at IS NULL THEN RAISE EXCEPTION 'The student has not submitted a receipt yet'; END IF;
  IF _status = 'Rejected' AND btrim(COALESCE(_note, '')) = '' THEN
    RAISE EXCEPTION 'Add a reason so the student knows what to fix';
  END IF;

  UPDATE public.payments
     SET receipt_review_status = _status,
         receipt_review_note = CASE WHEN _status = 'Rejected' THEN btrim(_note) ELSE NULL END,
         receipt_reviewed_by = auth.uid(), receipt_reviewed_at = now()
   WHERE id = _payment_id;

  IF _status = 'Accepted' THEN
    PERFORM public.notify(pay.user_id, 'Receipt Accepted', 'Your receipt for the payment of ₱' || to_char(pay.amount, 'FM999,999,990.00') || ' was accepted. Thank you.',
      'success', 'payment', '/student-dashboard?section=disbursement', 'payments', pay.id);
  ELSE
    PERFORM public.notify(pay.user_id, 'Receipt Needs Attention', 'Your receipt was not accepted. Reason: ' || btrim(_note) || ' Please submit a new one.',
      'warning', 'payment', '/student-dashboard?section=disbursement', 'payments', pay.id);
  END IF;
  PERFORM public.write_audit(CASE WHEN _status = 'Accepted' THEN 'accept_receipt' ELSE 'reject_receipt' END, 'payments', pay.id,
    jsonb_build_object('receipt_review_status', pay.receipt_review_status),
    jsonb_build_object('receipt_review_status', _status, 'note', _note));
END;
$$;
REVOKE ALL ON FUNCTION public.review_student_receipt(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_student_receipt(UUID, TEXT, TEXT) TO authenticated;

-- ── 5. Payment issue reports ──
CREATE TABLE IF NOT EXISTS public.payment_issues (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('not_received', 'wrong_amount', 'other')),
  message TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 10 AND 1000),
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Resolved')),
  response TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_issues_one_open_per_payment ON public.payment_issues (payment_id) WHERE status = 'Open';
CREATE INDEX IF NOT EXISTS payment_issues_user_idx ON public.payment_issues (user_id);

ALTER TABLE public.payment_issues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Students view own payment issues" ON public.payment_issues;
CREATE POLICY "Students view own payment issues" ON public.payment_issues FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Staff view payment issues" ON public.payment_issues;
CREATE POLICY "Staff view payment issues" ON public.payment_issues FOR SELECT USING (public.is_admin(auth.uid()));
-- No insert/update policies: reports and responses go through the functions below.

CREATE OR REPLACE FUNCTION public.report_payment_issue(_payment_id UUID, _kind TEXT, _message TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay public.payments%ROWTYPE;
  new_id UUID;
BEGIN
  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND OR pay.user_id <> auth.uid() THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF pay.status = 'Cancelled' THEN RAISE EXCEPTION 'This payment was cancelled'; END IF;
  IF _kind NOT IN ('not_received', 'wrong_amount', 'other') THEN RAISE EXCEPTION 'Choose what the problem is'; END IF;
  IF char_length(btrim(COALESCE(_message, ''))) < 10 OR char_length(_message) > 1000 THEN
    RAISE EXCEPTION 'Describe the problem in 10 to 1000 characters';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_issues WHERE payment_id = _payment_id AND status = 'Open') THEN
    RAISE EXCEPTION 'You already have an open report for this payment';
  END IF;

  INSERT INTO public.payment_issues (payment_id, user_id, kind, message)
  VALUES (_payment_id, auth.uid(), _kind, btrim(_message))
  RETURNING id INTO new_id;

  PERFORM public.notify_admins('Payment Problem Reported',
    public.display_name(auth.uid()) || ' reported a problem with a payment of ₱' || to_char(pay.amount, 'FM999,999,990.00') || ' (' ||
      CASE _kind WHEN 'not_received' THEN 'not received' WHEN 'wrong_amount' THEN 'wrong amount' ELSE 'other' END || ').',
    'warning', 'payment', '/admin?section=disbursement', 'payment_issues', new_id);
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.report_payment_issue(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_payment_issue(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_payment_issue(_issue_id UUID, _response TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  iss public.payment_issues%ROWTYPE;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT * INTO iss FROM public.payment_issues WHERE id = _issue_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Report not found'; END IF;
  IF iss.status = 'Resolved' THEN RAISE EXCEPTION 'This report is already resolved'; END IF;
  IF btrim(COALESCE(_response, '')) = '' THEN RAISE EXCEPTION 'Write a response for the student'; END IF;

  UPDATE public.payment_issues
     SET status = 'Resolved', response = btrim(_response), resolved_at = now(), resolved_by = auth.uid()
   WHERE id = _issue_id;

  PERFORM public.notify(iss.user_id, 'Payment Problem Update', btrim(_response),
    'info', 'payment', '/student-dashboard?section=disbursement', 'payment_issues', iss.id);
  PERFORM public.write_audit('resolve_payment_issue', 'payment_issues', iss.id,
    jsonb_build_object('status', 'Open'), jsonb_build_object('status', 'Resolved', 'response', _response));
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_payment_issue(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_payment_issue(UUID, TEXT) TO authenticated;

-- ── 6. Claim instructions (settings) ──
INSERT INTO public.system_settings (key, value, description) VALUES
  ('payment_pickup_location', '""', 'Where students collect Cash or Cheque payments'),
  ('payment_pickup_instructions', '"Please bring a valid ID."', 'What students should bring / do to claim a payment')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.validate_payment_text_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.key IN ('payment_pickup_location', 'payment_pickup_instructions') THEN
    IF jsonb_typeof(NEW.value) <> 'string' OR char_length(NEW.value #>> '{}') > 500 THEN
      RAISE EXCEPTION 'Claim details must be text of up to 500 characters';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_validate_payment_text_settings ON public.system_settings;
CREATE TRIGGER tr_validate_payment_text_settings
  BEFORE INSERT OR UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public.validate_payment_text_settings();

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════
-- 026_student_profile
-- ════════════════════════════════════════════════════════════════════
-- Student profile hardening. Run after 025. Safe to re-run.
--   * students could edit ANY column of their own profile (average_grade, is_active, ID numbers, email):
--     a trigger now limits what a student can change, validates formats, and locks identity fields
--     while a scholarship is active
--   * the average grade is verified: students submit a grade with their grade report, staff verify it
--   * new profile fields: street address, province, ZIP, guardian details
--   * profile photos move to a private bucket (2 MB, JPG/PNG/WebP) with per-user storage policies
--   * privacy: students can ask for their account and data to be erased; staff respond
--   * profiles.email follows the auth email when a student changes it

-- ── 1. Columns ──
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS street_address TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS province TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS zip_code TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS guardian_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS guardian_relationship TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS guardian_phone TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS grade_verified_at TIMESTAMPTZ;   -- NULL = self-declared at registration
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS grade_term TEXT;

-- ── 2. What a student may change on their own profile ──
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only self-edits are restricted (admins act through their own functions / policies), and updates
  -- fired from another trigger (e.g. the auth email sync) are not.
  IF pg_trigger_depth() > 1 OR auth.uid() IS NULL OR auth.uid() <> OLD.id THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR (NEW.email IS DISTINCT FROM OLD.email AND OLD.email IS NOT NULL)
     OR NEW.grade_verified_at IS DISTINCT FROM OLD.grade_verified_at
     OR NEW.grade_term IS DISTINCT FROM OLD.grade_term THEN
    RAISE EXCEPTION 'That part of your profile can only be changed by the office';
  END IF;

  -- The grade may be declared once (at registration); after that it changes only through a verified update.
  IF NEW.average_grade IS DISTINCT FROM OLD.average_grade AND OLD.average_grade IS NOT NULL THEN
    RAISE EXCEPTION 'Your average grade is verified by the office. Submit a grade update with your grade report.';
  END IF;

  -- ID numbers feed duplicate detection, so they are fixed once you have applied.
  IF (NEW.student_id_number IS DISTINCT FROM OLD.student_id_number OR NEW.government_id IS DISTINCT FROM OLD.government_id)
     AND EXISTS (SELECT 1 FROM public.applications WHERE user_id = OLD.id AND status <> 'Withdrawn') THEN
    RAISE EXCEPTION 'Your ID numbers are locked once you have applied. Contact the office to correct them.';
  END IF;

  -- Identity and school details are locked while this year's scholarship is approved.
  IF public.documents_locked(OLD.id)
     AND ROW(NEW.first_name, NEW.middle_name, NEW.last_name, NEW.sex, NEW.dob, NEW.school_name, NEW.course, NEW.year_level)
         IS DISTINCT FROM
         ROW(OLD.first_name, OLD.middle_name, OLD.last_name, OLD.sex, OLD.dob, OLD.school_name, OLD.course, OLD.year_level) THEN
    RAISE EXCEPTION 'Your name, birth date, school, course and year level are locked while your scholarship is active. Contact the office to change them.';
  END IF;

  -- Formats (checked when the value changes, so old rows with legacy values can still be edited elsewhere).
  IF NEW.phone IS DISTINCT FROM OLD.phone AND btrim(COALESCE(NEW.phone, '')) <> '' AND NEW.phone !~ '^(09|\+639)[0-9]{9}$' THEN
    RAISE EXCEPTION 'Use a valid PH mobile number (09XXXXXXXXX or +639XXXXXXXXX)';
  END IF;
  IF NEW.guardian_phone IS DISTINCT FROM OLD.guardian_phone AND btrim(COALESCE(NEW.guardian_phone, '')) <> '' AND NEW.guardian_phone !~ '^(09|\+639)[0-9]{9}$' THEN
    RAISE EXCEPTION 'Use a valid PH mobile number for your guardian (09XXXXXXXXX or +639XXXXXXXXX)';
  END IF;
  IF NEW.zip_code IS DISTINCT FROM OLD.zip_code AND btrim(COALESCE(NEW.zip_code, '')) <> '' AND NEW.zip_code !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'ZIP code must be 4 digits';
  END IF;
  IF NEW.year_level IS DISTINCT FROM OLD.year_level AND NEW.year_level IS NOT NULL
     AND NEW.year_level NOT IN ('Grade 11', 'Grade 12', '1st Year', '2nd Year', '3rd Year', '4th Year') THEN
    RAISE EXCEPTION 'Choose a year level from the list';
  END IF;
  IF (NEW.first_name IS DISTINCT FROM OLD.first_name AND btrim(COALESCE(NEW.first_name, '')) = '')
     OR (NEW.last_name IS DISTINCT FROM OLD.last_name AND btrim(COALESCE(NEW.last_name, '')) = '') THEN
    RAISE EXCEPTION 'First and last name cannot be blank';
  END IF;
  IF NEW.dob IS DISTINCT FROM OLD.dob AND NEW.dob IS NOT NULL AND (NEW.dob > CURRENT_DATE OR NEW.dob < DATE '1900-01-01') THEN
    RAISE EXCEPTION 'Enter a valid date of birth';
  END IF;
  IF NEW.profile_picture_url IS DISTINCT FROM OLD.profile_picture_url AND NEW.profile_picture_url IS NOT NULL
     AND NEW.profile_picture_url !~ '^https?://'
     AND split_part(NEW.profile_picture_url, '/', 1) <> OLD.id::text THEN
    RAISE EXCEPTION 'Invalid photo location';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_guard_profile_update ON public.profiles;
CREATE TRIGGER tr_guard_profile_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_update();

-- ── 3. profiles.email follows the auth email ──
CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_profile_email ON auth.users;
CREATE TRIGGER tr_sync_profile_email
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.sync_profile_email();

-- ── 4. Profile photos: private bucket, limits, per-user policies ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('profile-pictures', 'profile-pictures', false, 2 * 1024 * 1024, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "pp_owner_select" ON storage.objects;
CREATE POLICY "pp_owner_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'profile-pictures' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "pp_owner_insert" ON storage.objects;
CREATE POLICY "pp_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'profile-pictures' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "pp_owner_update" ON storage.objects;
CREATE POLICY "pp_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'profile-pictures' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "pp_owner_delete" ON storage.objects;
CREATE POLICY "pp_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'profile-pictures' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "pp_staff_select" ON storage.objects;
CREATE POLICY "pp_staff_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'profile-pictures' AND public.is_admin(auth.uid()));

-- Stored value is now the object path (it used to be a public URL): convert what can be converted safely.
UPDATE public.profiles
   SET profile_picture_url = substring(profile_picture_url from '/profile-pictures/([^?]+)$')
 WHERE profile_picture_url LIKE 'http%' AND profile_picture_url LIKE '%/profile-pictures/%' AND position('%' in profile_picture_url) = 0;

-- ── 5. Verified grades ──
CREATE TABLE IF NOT EXISTS public.grade_updates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grade NUMERIC NOT NULL CHECK (grade >= 0 AND grade <= 100),
  term TEXT NOT NULL CHECK (char_length(btrim(term)) BETWEEN 3 AND 60),
  file_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Verified', 'Rejected')),
  review_note TEXT,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS grade_updates_one_pending_per_user ON public.grade_updates (user_id) WHERE status = 'Pending';
CREATE INDEX IF NOT EXISTS grade_updates_user_idx ON public.grade_updates (user_id);

ALTER TABLE public.grade_updates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Students view own grade updates" ON public.grade_updates;
CREATE POLICY "Students view own grade updates" ON public.grade_updates FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Staff view grade updates" ON public.grade_updates;
CREATE POLICY "Staff view grade updates" ON public.grade_updates FOR SELECT USING (public.is_admin(auth.uid()));
-- Writes go through the functions below.

CREATE OR REPLACE FUNCTION public.submit_grade_update(_grade NUMERIC, _term TEXT, _path TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  obj_size BIGINT;
  obj_mime TEXT;
  max_mb NUMERIC := public.setting_number('max_upload_mb', 5);
  new_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please log in again'; END IF;
  IF _grade IS NULL OR _grade < 0 OR _grade > 100 THEN RAISE EXCEPTION 'Enter your average grade as a number from 0 to 100'; END IF;
  IF char_length(btrim(COALESCE(_term, ''))) < 3 OR char_length(_term) > 60 THEN RAISE EXCEPTION 'Enter the term the grade is for'; END IF;
  IF _path IS NULL OR _path NOT LIKE (auth.uid()::text || '/grades/%') THEN RAISE EXCEPTION 'Attach your grade report'; END IF;
  IF EXISTS (SELECT 1 FROM public.grade_updates WHERE user_id = auth.uid() AND status = 'Pending') THEN
    RAISE EXCEPTION 'You already have a grade update waiting for review';
  END IF;

  SELECT (metadata->>'size')::bigint, metadata->>'mimetype' INTO obj_size, obj_mime
    FROM storage.objects WHERE bucket_id = 'documents' AND name = _path;
  IF NOT FOUND THEN RAISE EXCEPTION 'The uploaded file could not be found. Please try again.'; END IF;
  IF obj_mime IS NULL OR obj_mime NOT IN ('application/pdf', 'image/jpeg', 'image/png') THEN
    RAISE EXCEPTION 'Only PDF, JPG and PNG files are allowed';
  END IF;
  IF obj_size IS NULL OR obj_size <= 0 THEN RAISE EXCEPTION 'The file is empty'; END IF;
  IF obj_size > max_mb * 1024 * 1024 THEN RAISE EXCEPTION 'File is too large (max % MB)', trim_scale(max_mb); END IF;

  INSERT INTO public.grade_updates (user_id, grade, term, file_path)
  VALUES (auth.uid(), _grade, btrim(_term), _path)
  RETURNING id INTO new_id;

  PERFORM public.notify_admins('Grade Update Submitted',
    public.display_name(auth.uid()) || ' submitted an average grade of ' || trim_scale(_grade) || ' for ' || btrim(_term) || '.',
    'info', 'verification', '/admin?section=students', 'grade_updates', new_id);
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_grade_update(NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_grade_update(NUMERIC, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_grade_update(_id UUID, _status TEXT, _note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g public.grade_updates%ROWTYPE;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _status NOT IN ('Verified', 'Rejected') THEN RAISE EXCEPTION 'Choose Verified or Rejected'; END IF;
  SELECT * INTO g FROM public.grade_updates WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Grade update not found'; END IF;
  IF g.status <> 'Pending' THEN RAISE EXCEPTION 'This grade update was already reviewed'; END IF;
  IF _status = 'Rejected' AND btrim(COALESCE(_note, '')) = '' THEN RAISE EXCEPTION 'Add a reason so the student knows what to fix'; END IF;

  UPDATE public.grade_updates
     SET status = _status, review_note = CASE WHEN _status = 'Rejected' THEN btrim(_note) ELSE NULL END,
         reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = _id;

  IF _status = 'Verified' THEN
    UPDATE public.profiles SET average_grade = g.grade, grade_verified_at = now(), grade_term = g.term WHERE id = g.user_id;
    PERFORM public.notify(g.user_id, 'Grade Verified', 'Your average grade of ' || trim_scale(g.grade) || ' for ' || g.term || ' was verified.',
      'success', 'verification', '/student-dashboard?section=profile', 'grade_updates', g.id);
  ELSE
    PERFORM public.notify(g.user_id, 'Grade Update Needs Attention', 'Your grade update was not accepted. Reason: ' || btrim(_note) || ' Please submit it again.',
      'warning', 'verification', '/student-dashboard?section=profile', 'grade_updates', g.id);
  END IF;
  PERFORM public.write_audit(CASE WHEN _status = 'Verified' THEN 'verify_grade' ELSE 'reject_grade' END, 'grade_updates', g.id,
    jsonb_build_object('status', 'Pending'), jsonb_build_object('status', _status, 'grade', g.grade, 'note', _note));
END;
$$;
REVOKE ALL ON FUNCTION public.review_grade_update(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_grade_update(UUID, TEXT, TEXT) TO authenticated;

-- Grade reports live in the students' own folder and, like receipts, stay uploadable / undeletable
-- after approval (a renewal needs a fresh one).
DROP POLICY IF EXISTS "documents_owner_insert" ON storage.objects;
CREATE POLICY "documents_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND ((storage.foldername(name))[2] IN ('receipts', 'grades') OR NOT public.documents_locked(auth.uid()))
  );
DROP POLICY IF EXISTS "documents_owner_delete" ON storage.objects;
CREATE POLICY "documents_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND COALESCE((storage.foldername(name))[2], '') NOT IN ('receipts', 'grades')
    AND NOT public.documents_locked(auth.uid())
  );

-- ── 6. Privacy: erasure requests ──
CREATE TABLE IF NOT EXISTS public.data_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'deletion' CHECK (kind IN ('deletion')),
  reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 1000),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed', 'Declined')),
  response TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  handled_at TIMESTAMPTZ,
  handled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS data_requests_one_pending_per_user ON public.data_requests (user_id, kind) WHERE status = 'Pending';

ALTER TABLE public.data_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Students view own data requests" ON public.data_requests;
CREATE POLICY "Students view own data requests" ON public.data_requests FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Staff view data requests" ON public.data_requests;
CREATE POLICY "Staff view data requests" ON public.data_requests FOR SELECT USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.request_account_deletion(_reason TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please log in again'; END IF;
  IF EXISTS (SELECT 1 FROM public.data_requests WHERE user_id = auth.uid() AND kind = 'deletion' AND status = 'Pending') THEN
    RAISE EXCEPTION 'You already have a deletion request waiting for the office';
  END IF;
  INSERT INTO public.data_requests (user_id, kind, reason)
  VALUES (auth.uid(), 'deletion', NULLIF(btrim(COALESCE(_reason, '')), ''))
  RETURNING id INTO new_id;
  PERFORM public.notify_admins('Account Deletion Requested', public.display_name(auth.uid()) || ' asked for their account and data to be deleted.',
    'warning', 'account', '/admin?section=students', 'data_requests', new_id);
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_account_deletion(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_data_request(_id UUID, _status TEXT, _response TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.data_requests%ROWTYPE;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _status NOT IN ('Completed', 'Declined') THEN RAISE EXCEPTION 'Choose Completed or Declined'; END IF;
  SELECT * INTO r FROM public.data_requests WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status <> 'Pending' THEN RAISE EXCEPTION 'This request was already handled'; END IF;
  IF btrim(COALESCE(_response, '')) = '' THEN RAISE EXCEPTION 'Write a response for the student'; END IF;

  UPDATE public.data_requests SET status = _status, response = btrim(_response), handled_at = now(), handled_by = auth.uid() WHERE id = _id;
  PERFORM public.notify(r.user_id, CASE WHEN _status = 'Completed' THEN 'Deletion Request Completed' ELSE 'Deletion Request Declined' END,
    btrim(_response), CASE WHEN _status = 'Completed' THEN 'success' ELSE 'info' END, 'account', '/student-dashboard?section=profile', 'data_requests', r.id);
  PERFORM public.write_audit('handle_data_request', 'data_requests', r.id,
    jsonb_build_object('status', 'Pending'), jsonb_build_object('status', _status, 'response', _response));
END;
$$;
REVOKE ALL ON FUNCTION public.handle_data_request(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_data_request(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════
-- 027_notification_settings
-- ════════════════════════════════════════════════════════════════════
-- Notification settings. Run after 026. Safe to re-run.
--   * master switches per user: email and in-app (per-category switches still apply on top)
--   * turning in-app off no longer also kills the email: a notification that is off in-app but on for email
--     is stored "muted" (hidden from the inbox, marked read) so the email webhook still fires; a
--     notification that is off in both places is dropped
--   * a rate-limited "send me a test notification"

-- ── 1. Master switches ──
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  in_app_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own settings" ON public.user_settings;
CREATE POLICY "Users manage own settings" ON public.user_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── 2. Muted notifications ──
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.notifications_respect_prefs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  in_app_off BOOLEAN;
  email_off BOOLEAN;
BEGIN
  -- Account and system notices are always delivered.
  IF NEW.category NOT IN ('application', 'verification', 'payment', 'program') THEN
    RETURN NEW;
  END IF;

  in_app_off :=
    EXISTS (SELECT 1 FROM public.user_settings WHERE user_id = NEW.user_id AND in_app_enabled = false)
    OR EXISTS (SELECT 1 FROM public.notification_preferences WHERE user_id = NEW.user_id AND category = NEW.category AND in_app = false);

  email_off :=
    NOT public.setting_bool('email_notifications', true)
    OR EXISTS (SELECT 1 FROM public.user_settings WHERE user_id = NEW.user_id AND email_enabled = false)
    OR EXISTS (SELECT 1 FROM public.notification_preferences WHERE user_id = NEW.user_id AND category = NEW.category AND email = false);

  IF in_app_off AND email_off THEN
    RETURN NULL;                       -- nothing to show and nothing to send
  ELSIF in_app_off THEN
    NEW.muted := true;                 -- keep the row so the email webhook still fires, but hide it
    NEW.read := true;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 3. Test notification (once per 10 minutes) ──
CREATE OR REPLACE FUNCTION public.send_test_notification()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bucket TEXT := 'test:' || floor(extract(epoch FROM now()) / 600)::bigint::text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please log in again'; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications WHERE user_id = auth.uid() AND dedupe_key = bucket) THEN
    RAISE EXCEPTION 'You already sent a test a moment ago. Try again in a few minutes.';
  END IF;
  PERFORM public.notify(auth.uid(), 'Test notification',
    'This is a test from your Settings. If you can read this in your inbox, email notifications are working.',
    'info', 'system', NULL, NULL, NULL, bucket);
END;
$$;
REVOKE ALL ON FUNCTION public.send_test_notification() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_test_notification() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════
-- 028_notifications_overhaul
-- ════════════════════════════════════════════════════════════════════
-- Notifications overhaul. Run after 027. Safe to re-run.
--   * students are told when a scheduled payment's amount / date / method changes, and when they withdraw
--   * smarter, eligibility-aware reminders: deadline (7 and 2 days), applications/renewals opening,
--     missing documents, incomplete profile, grade report, receipts (also rejected ones, weekly)
--   * announcements: staff send a message to a chosen audience
--   * retention: old read / muted notifications are purged
--   * the daily job records each run and its errors, and staff can see (and trigger) it

-- ── 1. Payment edits ──
CREATE OR REPLACE FUNCTION public.notify_payment_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parts TEXT[] := '{}';
BEGIN
  -- Status changes have their own notifications; only open payments can still be edited.
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.status NOT IN ('Pending', 'Processing') THEN RETURN NEW; END IF;
  -- The student choosing their own method is not news to them.
  IF auth.uid() = NEW.user_id THEN RETURN NEW; END IF;

  IF NEW.amount IS DISTINCT FROM OLD.amount THEN
    parts := parts || ('amount ₱' || to_char(OLD.amount, 'FM999,999,999,990.00') || ' → ₱' || to_char(NEW.amount, 'FM999,999,999,990.00'));
  END IF;
  IF NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date THEN
    parts := parts || ('date ' || COALESCE(OLD.scheduled_date::text, 'not set') || ' → ' || COALESCE(NEW.scheduled_date::text, 'not set'));
  END IF;
  IF NEW.method IS DISTINCT FROM OLD.method THEN
    parts := parts || ('method ' || COALESCE(OLD.method, 'not set') || ' → ' || COALESCE(NEW.method, 'not set'));
  END IF;
  IF cardinality(parts) = 0 THEN RETURN NEW; END IF;

  PERFORM public.notify(NEW.user_id, 'Payment Updated', 'Your scheduled payment was updated: ' || array_to_string(parts, '; ') || '.',
    'info', 'payment', '/student-dashboard?section=disbursement', 'payments', NEW.id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_notify_payment_changes ON public.payments;
CREATE TRIGGER tr_notify_payment_changes
  AFTER UPDATE OF amount, scheduled_date, method ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.notify_payment_changes();

-- ── 2. Application decisions, now including withdrawal ──
CREATE OR REPLACE FUNCTION public.notify_application_decision()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sch TEXT;
  remarks TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  SELECT name INTO sch FROM public.scholarships WHERE id = NEW.scholarship_id;
  sch := COALESCE(sch, 'the scholarship');
  remarks := CASE WHEN COALESCE(btrim(NEW.notes), '') <> '' THEN ' Remarks: ' || NEW.notes ELSE '' END;

  IF NEW.status = 'Approved' THEN
    PERFORM public.notify(NEW.user_id, 'Application Approved', 'Your application for ' || sch || ' has been approved.' || remarks,
      'success', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Rejected' THEN
    PERFORM public.notify(NEW.user_id, 'Application Rejected', 'Your application for ' || sch || ' was not approved this time.' || remarks,
      'error', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Waitlisted' THEN
    PERFORM public.notify(NEW.user_id, 'Application Waitlisted', 'Your application for ' || sch || ' has been placed on the waitlist. We will notify you if a slot opens.' || remarks,
      'warning', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Pending' AND OLD.status = 'Rejected' THEN
    PERFORM public.notify(NEW.user_id, 'Application Reopened', 'Your application for ' || sch || ' has been reopened for review.' || remarks,
      'info', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Withdrawn' THEN
    PERFORM public.notify(NEW.user_id, 'Application Withdrawn', 'You withdrew your application for ' || sch || '. Your documents are kept, and you can apply again while applications are open.',
      'info', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

-- ── 3. Who can apply where (used by reminders) ──
CREATE OR REPLACE FUNCTION public.student_eligible_for(_user UUID, _scholarship UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
      JOIN public.scholarships s ON s.id = _scholarship
     WHERE p.id = _user AND p.is_active
       AND (COALESCE(s.min_grade, 0) = 0 OR COALESCE(p.average_grade, -1) >= s.min_grade)
       AND (public.setting_number('min_grade_requirement', 0) = 0 OR COALESCE(p.average_grade, -1) >= public.setting_number('min_grade_requirement', 0))
       AND (s.year_levels IS NULL OR cardinality(s.year_levels) = 0 OR p.year_level = ANY (s.year_levels))
       AND (btrim(COALESCE(s.municipality, '')) = '' OR lower(btrim(COALESCE(p.municipality, ''))) = lower(btrim(s.municipality)))
  );
$$;

-- Students who have not applied this year (a withdrawn application doesn't count).
CREATE OR REPLACE FUNCTION public.has_application_this_year(_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.applications
     WHERE user_id = _user AND status <> 'Withdrawn'
       AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM now())
  );
$$;

-- ── 4. Reminders ──
CREATE OR REPLACE FUNCTION public.send_deadline_reminders()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sch RECORD;
  st UUID;
BEGIN
  FOR sch IN
    SELECT s.id, s.name, s.deadline, (s.deadline - CURRENT_DATE) AS days
      FROM public.scholarships s
     WHERE s.is_active AND s.deadline IS NOT NULL AND (s.deadline - CURRENT_DATE) IN (7, 2)
       AND (s.open_date IS NULL OR s.open_date <= CURRENT_DATE)
       AND (s.slots = 0 OR (SELECT COUNT(*) FROM public.applications a WHERE a.scholarship_id = s.id AND a.status = 'Approved') < s.slots)
  LOOP
    FOR st IN
      SELECT ur.user_id FROM public.user_roles ur
       WHERE ur.role::text = 'student'
         AND public.student_eligible_for(ur.user_id, sch.id)
         AND NOT public.has_application_this_year(ur.user_id)
    LOOP
      PERFORM public.notify(st, 'Deadline approaching: ' || sch.name,
        'Applications close on ' || to_char(sch.deadline, 'FMMonth DD, YYYY') || ' (' || sch.days || ' day' || CASE WHEN sch.days = 1 THEN '' ELSE 's' END || ' left). Apply before then.',
        'warning', 'program', '/student-dashboard?section=application&apply=' || sch.id::text, 'scholarships', sch.id,
        'deadline-' || sch.id::text || '-' || sch.deadline::text || '-' || sch.days::text);
    END LOOP;
  END LOOP;
END;
$$;

-- Applications / renewals opening (the global window, and each program's own opening date).
CREATE OR REPLACE FUNCTION public.send_opening_reminders()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  st UUID;
  sch RECORD;
  today TEXT := to_char(CURRENT_DATE, 'YYYY-MM-DD');
  scholar BOOLEAN;
BEGIN
  IF public.setting_text('application_open_date', '') = today AND public.setting_bool('applications_open', true) THEN
    FOR st IN
      SELECT ur.user_id FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
       WHERE ur.role::text = 'student' AND p.is_active AND NOT public.has_application_this_year(ur.user_id)
    LOOP
      scholar := EXISTS (SELECT 1 FROM public.applications WHERE user_id = st AND status = 'Approved');
      IF scholar AND public.setting_bool('renewal_enabled', true) THEN
        PERFORM public.notify(st, 'Renewals are open', 'You can renew your scholarship now. Update your grade report and documents, then apply.',
          'info', 'program', '/student-dashboard?section=application', NULL, NULL, 'window-open-' || today);
      ELSIF NOT scholar THEN
        PERFORM public.notify(st, 'Applications are open', 'Scholarship applications are now open. Check your documents and apply.',
          'info', 'program', '/student-dashboard?section=application', NULL, NULL, 'window-open-' || today);
      END IF;
    END LOOP;
  END IF;

  FOR sch IN SELECT id, name FROM public.scholarships WHERE is_active AND open_date = CURRENT_DATE LOOP
    FOR st IN
      SELECT ur.user_id FROM public.user_roles ur
       WHERE ur.role::text = 'student' AND public.student_eligible_for(ur.user_id, sch.id) AND NOT public.has_application_this_year(ur.user_id)
    LOOP
      PERFORM public.notify(st, 'Now open: ' || sch.name, 'Applications for ' || sch.name || ' are open. You meet its requirements.',
        'info', 'program', '/student-dashboard?section=application&apply=' || sch.id::text, 'scholarships', sch.id, 'program-open-' || sch.id::text);
    END LOOP;
  END LOOP;
END;
$$;

-- Applicants still missing (or holding rejected) required documents: once a week.
CREATE OR REPLACE FUNCTION public.send_document_reminders()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a RECORD;
  req JSONB;
  missing TEXT;
  week TEXT := floor(extract(epoch FROM now()) / 604800)::bigint::text;
BEGIN
  SELECT value INTO req FROM public.system_settings WHERE key = 'required_documents';
  IF req IS NULL OR jsonb_typeof(req) <> 'array' THEN RETURN; END IF;

  FOR a IN
    SELECT id, user_id FROM public.applications
     WHERE status = 'Pending' AND created_at < now() - interval '2 days'
       AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM now())
  LOOP
    SELECT string_agg(d, ', ') INTO missing
      FROM jsonb_array_elements_text(req) AS d
     WHERE NOT EXISTS (
       SELECT 1 FROM public.documents doc
        WHERE doc.user_id = a.user_id AND doc.document_type = d AND doc.status <> 'Rejected'
          AND (doc.application_id = a.id OR doc.application_id IS NULL)
     );
    IF missing IS NOT NULL THEN
      PERFORM public.notify(a.user_id, 'Documents still needed', 'Your application can''t be approved until these are uploaded: ' || missing || '.',
        'warning', 'application', '/student-dashboard?section=documents', 'applications', a.id, 'docs-' || a.id::text || '-' || week);
    END IF;
  END LOOP;
END;
$$;

-- Incomplete profiles (every two weeks) and stale grade reports for scholars (monthly).
CREATE OR REPLACE FUNCTION public.send_profile_reminders()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p RECORD;
  fortnight TEXT := floor(extract(epoch FROM now()) / 1209600)::bigint::text;
  month TEXT := floor(extract(epoch FROM now()) / 2592000)::bigint::text;
BEGIN
  FOR p IN
    SELECT pr.id FROM public.profiles pr JOIN public.user_roles ur ON ur.user_id = pr.id
     WHERE ur.role::text = 'student' AND pr.is_active AND pr.created_at < now() - interval '3 days'
       AND (btrim(COALESCE(pr.first_name, '')) = '' OR btrim(COALESCE(pr.last_name, '')) = '' OR btrim(COALESCE(pr.phone, '')) = ''
            OR btrim(COALESCE(pr.school_name, '')) = '' OR btrim(COALESCE(pr.course, '')) = '' OR btrim(COALESCE(pr.year_level, '')) = ''
            OR pr.average_grade IS NULL)
  LOOP
    PERFORM public.notify(p.id, 'Complete your profile', 'A few details are missing from your profile. The office needs them to review an application.',
      'info', 'application', '/student-dashboard?section=profile', NULL, NULL, 'profile-' || p.id::text || '-' || fortnight);
  END LOOP;

  FOR p IN
    SELECT pr.id FROM public.profiles pr
     WHERE pr.is_active
       AND EXISTS (SELECT 1 FROM public.applications a WHERE a.user_id = pr.id AND a.status = 'Approved')
       AND (pr.grade_verified_at IS NULL OR pr.grade_verified_at < now() - interval '180 days')
       AND NOT EXISTS (SELECT 1 FROM public.grade_updates g WHERE g.user_id = pr.id AND g.status = 'Pending')
  LOOP
    PERFORM public.notify(p.id, 'Submit your latest grades', 'Your verified grade is out of date. Upload your latest grade report in your profile to keep your scholarship and renewals on track.',
      'warning', 'verification', '/student-dashboard?section=profile', NULL, NULL, 'grade-' || p.id::text || '-' || month);
  END LOOP;
END;
$$;

-- Disbursed payments with no receipt, or a rejected one: weekly, for five weeks.
CREATE OR REPLACE FUNCTION public.send_receipt_reminders()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p RECORD;
  week TEXT := floor(extract(epoch FROM now()) / 604800)::bigint::text;
BEGIN
  FOR p IN
    SELECT id, user_id, amount, receipt_review_status FROM public.payments
     WHERE status = 'Disbursed' AND disbursed_at < now() - interval '3 days' AND disbursed_at > now() - interval '35 days'
       AND (student_receipt_at IS NULL OR receipt_review_status = 'Rejected')
  LOOP
    PERFORM public.notify(p.user_id,
      CASE WHEN p.receipt_review_status = 'Rejected' THEN 'Please resend your receipt' ELSE 'Please submit your receipt' END,
      'Your payment of ₱' || to_char(p.amount, 'FM999,999,999,990.00') || CASE WHEN p.receipt_review_status = 'Rejected'
        THEN ' still needs a receipt the office can accept.' ELSE ' was disbursed. Please upload your signed receipt or confirm you received it.' END,
      'warning', 'payment', '/student-dashboard?section=disbursement', 'payments', p.id, 'receipt-reminder-' || p.id::text || '-' || week);
  END LOOP;
END;
$$;

-- ── 5. Retention ──
CREATE OR REPLACE FUNCTION public.purge_old_notifications()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.notifications
   WHERE (read AND created_at < now() - interval '90 days')
      OR (muted AND created_at < now() - interval '30 days')
      OR created_at < now() - interval '365 days';
END;
$$;

-- ── 6. The daily job: every part runs on its own, and the run is recorded ──
CREATE TABLE IF NOT EXISTS public.job_runs (
  job TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ,
  last_ok_at TIMESTAMPTZ,
  last_error TEXT,
  runs BIGINT NOT NULL DEFAULT 0
);
ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;   -- read through notification_jobs_status() only

CREATE OR REPLACE FUNCTION public.send_scheduled_notifications()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  err TEXT;
BEGIN
  BEGIN PERFORM public.send_deadline_reminders(); EXCEPTION WHEN others THEN err := concat_ws('; ', err, 'deadline: ' || SQLERRM); END;
  BEGIN PERFORM public.send_opening_reminders();  EXCEPTION WHEN others THEN err := concat_ws('; ', err, 'opening: ' || SQLERRM); END;
  BEGIN PERFORM public.send_document_reminders(); EXCEPTION WHEN others THEN err := concat_ws('; ', err, 'documents: ' || SQLERRM); END;
  BEGIN PERFORM public.send_profile_reminders();  EXCEPTION WHEN others THEN err := concat_ws('; ', err, 'profile: ' || SQLERRM); END;
  BEGIN PERFORM public.send_receipt_reminders();  EXCEPTION WHEN others THEN err := concat_ws('; ', err, 'receipts: ' || SQLERRM); END;
  BEGIN PERFORM public.send_payment_reminders();  EXCEPTION WHEN others THEN err := concat_ws('; ', err, 'payments: ' || SQLERRM); END;
  BEGIN PERFORM public.purge_old_notifications(); EXCEPTION WHEN others THEN err := concat_ws('; ', err, 'cleanup: ' || SQLERRM); END;

  INSERT INTO public.job_runs (job, last_run_at, last_ok_at, last_error, runs)
  VALUES ('notifications', now(), CASE WHEN err IS NULL THEN now() END, err, 1)
  ON CONFLICT (job) DO UPDATE
    SET last_run_at = now(),
        last_ok_at = CASE WHEN err IS NULL THEN now() ELSE public.job_runs.last_ok_at END,
        last_error = err,
        runs = public.job_runs.runs + 1;
END;
$$;
REVOKE ALL ON FUNCTION public.send_scheduled_notifications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_deadline_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_opening_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_document_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_profile_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_receipt_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_old_notifications() FROM PUBLIC;

-- Try to schedule it daily at 09:00 Manila time (01:00 UTC). If pg_cron isn't available the status
-- function below says so, and the schedule can be added by hand:
--   SELECT cron.schedule('sbsj-reminders', '0 1 * * *', 'SELECT public.send_scheduled_notifications()');
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('sbsj-reminders', '0 1 * * *', 'SELECT public.send_scheduled_notifications()');
EXCEPTION WHEN others THEN
  RAISE NOTICE 'pg_cron not available (%). Schedule public.send_scheduled_notifications() manually.', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION public.notification_jobs_status()
RETURNS TABLE (cron_available BOOLEAN, scheduled BOOLEAN, schedule TEXT, last_run_at TIMESTAMPTZ, last_ok_at TIMESTAMPTZ, last_error TEXT, runs BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sched TEXT;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  cron_available := to_regclass('cron.job') IS NOT NULL;
  scheduled := false;
  IF cron_available THEN
    EXECUTE 'SELECT schedule FROM cron.job WHERE jobname = $1 LIMIT 1' INTO sched USING 'sbsj-reminders';
    scheduled := sched IS NOT NULL;
  END IF;
  schedule := sched;
  SELECT j.last_run_at, j.last_ok_at, j.last_error, j.runs INTO last_run_at, last_ok_at, last_error, runs
    FROM public.job_runs j WHERE j.job = 'notifications';
  runs := COALESCE(runs, 0);
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.notification_jobs_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notification_jobs_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.run_notification_jobs_now()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  PERFORM public.send_scheduled_notifications();
END;
$$;
REVOKE ALL ON FUNCTION public.run_notification_jobs_now() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_notification_jobs_now() TO authenticated;

-- ── 7. Announcements ──
CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 120),
  message TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 3 AND 1000),
  audience TEXT NOT NULL CHECK (audience IN ('all', 'scholars', 'applicants', 'no_application')),
  link TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff view announcements" ON public.announcements;
CREATE POLICY "Staff view announcements" ON public.announcements FOR SELECT USING (public.is_admin(auth.uid()));

-- audience: all = active students; scholars = ever approved; applicants = pending / waitlisted this year;
--           no_application = haven't applied this year
CREATE OR REPLACE FUNCTION public.send_announcement(_title TEXT, _message TEXT, _audience TEXT, _link TEXT DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ann UUID;
  st UUID;
  n INTEGER := 0;
  lnk TEXT := NULLIF(btrim(COALESCE(_link, '')), '');
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _audience NOT IN ('all', 'scholars', 'applicants', 'no_application') THEN RAISE EXCEPTION 'Choose who should receive this'; END IF;
  IF char_length(btrim(COALESCE(_title, ''))) < 3 OR char_length(_title) > 120 THEN RAISE EXCEPTION 'The title must be 3 to 120 characters'; END IF;
  IF char_length(btrim(COALESCE(_message, ''))) < 3 OR char_length(_message) > 1000 THEN RAISE EXCEPTION 'The message must be 3 to 1000 characters'; END IF;
  IF lnk IS NOT NULL AND lnk !~ '^/[A-Za-z0-9/_?&=.#-]*$' THEN RAISE EXCEPTION 'The link must be a page on this site, like /student-dashboard?section=documents'; END IF;

  INSERT INTO public.announcements (title, message, audience, link, created_by)
  VALUES (btrim(_title), btrim(_message), _audience, lnk, auth.uid())
  RETURNING id INTO ann;

  FOR st IN
    SELECT ur.user_id FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role::text = 'student' AND p.is_active
       AND CASE _audience
             WHEN 'all' THEN true
             WHEN 'scholars' THEN EXISTS (SELECT 1 FROM public.applications a WHERE a.user_id = ur.user_id AND a.status = 'Approved')
             WHEN 'applicants' THEN EXISTS (SELECT 1 FROM public.applications a WHERE a.user_id = ur.user_id AND a.status IN ('Pending', 'Waitlisted')
                                             AND EXTRACT(YEAR FROM a.created_at) = EXTRACT(YEAR FROM now()))
             ELSE NOT public.has_application_this_year(ur.user_id)
           END
  LOOP
    PERFORM public.notify(st, btrim(_title), btrim(_message), 'info', 'program', lnk, 'announcements', ann, 'announce-' || ann::text);
    n := n + 1;
  END LOOP;

  UPDATE public.announcements SET recipient_count = n WHERE id = ann;
  PERFORM public.write_audit('send_announcement', 'announcements', ann, NULL,
    jsonb_build_object('audience', _audience, 'recipients', n, 'title', btrim(_title)));
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.send_announcement(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_announcement(TEXT, TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════
-- 029_public_stats
-- ════════════════════════════════════════════════════════════════════
-- Public, aggregate-only numbers for the landing page. No personal data leaves the database.
CREATE OR REPLACE FUNCTION public.public_stats()
RETURNS TABLE (scholars INTEGER, active_programs INTEGER, total_disbursed NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(DISTINCT user_id)::int FROM public.applications WHERE status = 'Approved'),
    (SELECT COUNT(*)::int FROM public.scholarships WHERE is_active),
    (SELECT COALESCE(SUM(amount), 0) FROM public.payments WHERE status = 'Disbursed');
$$;
GRANT EXECUTE ON FUNCTION public.public_stats() TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 030_bugfixes
-- ════════════════════════════════════════════════════════════════════
-- Bug fixes found by review. Run after 029. Safe to re-run.
--
--   1. notify_admins() / notify_students() only matched role = 'admin' literally, so accounts with
--      'super_admin', 'finance_admin' or 'reviewer' (all treated as staff everywhere else via
--      is_admin()/has_role('admin', ...)) never received a single admin notification — new
--      applications, uploaded documents, payment problems, grade submissions, deletion requests,
--      receipts, unpaid approvals. A school whose only account is a super_admin got none of these.
--   2. A program's own minimum grade (scholarships.min_grade) ignored renewal_min_grade: a renewing
--      scholar was held to the program's normal minimum instead of the (often different) renewal
--      minimum, inconsistent with the global minimum check, which already applies renewal_min_grade.

-- ── 1. notify_admins / notify_students: match the same staff roles as is_admin() ──
CREATE OR REPLACE FUNCTION public.notify_admins(
  _title TEXT, _message TEXT, _type TEXT DEFAULT 'info', _category TEXT DEFAULT 'system',
  _link TEXT DEFAULT NULL, _entity_type TEXT DEFAULT NULL, _entity_id UUID DEFAULT NULL, _dedupe TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_id UUID;
BEGIN
  FOR admin_id IN SELECT user_id FROM public.user_roles WHERE public.is_admin(user_id) LOOP
    PERFORM public.notify(admin_id, _title, _message, _type, _category, _link, _entity_type, _entity_id, _dedupe);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_students(
  _title TEXT, _message TEXT, _type TEXT DEFAULT 'info', _category TEXT DEFAULT 'system',
  _link TEXT DEFAULT NULL, _entity_type TEXT DEFAULT NULL, _entity_id UUID DEFAULT NULL, _dedupe TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  student_id UUID;
BEGIN
  FOR student_id IN
    SELECT ur.user_id FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
     WHERE NOT public.is_admin(ur.user_id) AND p.is_active
  LOOP
    PERFORM public.notify(student_id, _title, _message, _type, _category, _link, _entity_type, _entity_id, _dedupe);
  END LOOP;
END;
$$;

-- ── 2. A program's minimum grade, like the global one, is relaxed to renewal_min_grade for a renewal ──
CREATE OR REPLACE FUNCTION public.enforce_scholarship_open()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.scholarships%ROWTYPE;
  prof public.profiles%ROWTYPE;
  approved_count INTEGER;
  required_grade NUMERIC;
BEGIN
  IF NEW.scholarship_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO s FROM public.scholarships WHERE id = NEW.scholarship_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scholarship program not found';
  END IF;
  IF NOT s.is_active THEN
    RAISE EXCEPTION '% is not accepting applications', s.name;
  END IF;
  IF s.open_date IS NOT NULL AND s.open_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Applications for % open on %', s.name, to_char(s.open_date, 'FMMonth DD, YYYY');
  END IF;
  IF s.deadline IS NOT NULL AND s.deadline < CURRENT_DATE THEN
    RAISE EXCEPTION 'The deadline for % has passed (%)', s.name, s.deadline;
  END IF;
  IF s.slots > 0 THEN
    SELECT COUNT(*) INTO approved_count FROM public.applications
     WHERE scholarship_id = s.id AND status = 'Approved';
    IF approved_count >= s.slots THEN
      RAISE EXCEPTION 'All % slots for % are already filled', s.slots, s.name;
    END IF;
  END IF;

  -- The program's own eligibility rules (for signed-in students; not seed / service-role inserts).
  IF auth.uid() IS NOT NULL THEN
    SELECT * INTO prof FROM public.profiles WHERE id = NEW.user_id;

    IF s.min_grade IS NOT NULL AND s.min_grade > 0 THEN
      required_grade := s.min_grade;
      -- A renewing scholar (an earlier approval exists) is held to the renewal minimum instead,
      -- same as the global minimum check in enforce_application_settings.
      IF public.setting_bool('renewal_enabled', true)
         AND EXISTS (SELECT 1 FROM public.applications WHERE user_id = NEW.user_id AND status = 'Approved') THEN
        required_grade := public.setting_number('renewal_min_grade', required_grade);
      END IF;
      IF required_grade > 0 THEN
        IF prof.average_grade IS NULL THEN
          RAISE EXCEPTION 'Add your average grade to your profile before applying to % (minimum: %)', s.name, required_grade;
        END IF;
        IF prof.average_grade < required_grade THEN
          RAISE EXCEPTION 'Your average grade (%) is below the % required for %', prof.average_grade, required_grade, s.name;
        END IF;
      END IF;
    END IF;
    IF s.year_levels IS NOT NULL AND cardinality(s.year_levels) > 0
       AND (prof.year_level IS NULL OR NOT (prof.year_level = ANY (s.year_levels))) THEN
      RAISE EXCEPTION '% is open to % students only', s.name, array_to_string(s.year_levels, ', ');
    END IF;
    IF btrim(COALESCE(s.municipality, '')) <> ''
       AND lower(btrim(COALESCE(prof.municipality, ''))) <> lower(btrim(s.municipality)) THEN
      RAISE EXCEPTION '% is for residents of % only', s.name, s.municipality;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════
-- 031_bugfixes_2
-- ════════════════════════════════════════════════════════════════════
-- More bug fixes, found by an independent multi-agent review of the whole branch. Run after 030.
-- Safe to re-run.
--
--   1. apply_scholarship_award() only checked the budget on the transition INTO 'Approved'. Editing
--      amount_approved on an application that is already Approved (the admin PUT route allows this on
--      its own, with no other bound) skipped the check entirely, silently letting the amount go over
--      the program's total_budget.
--   2. notify_application_decision() only announced a reopen for Rejected -> Pending. A Waitlisted ->
--      Pending change (the database allows it; today's UI doesn't offer the button, but a future admin
--      feature or a direct update could still make it) sent no notification.
--   3. facebook_url has client-side format validation (must be blank or start with http(s)://) but no
--      matching database check, unlike every other setting — a write that skips the client (SQL editor,
--      a future API route, a scripted RPC) could store an arbitrary value that is later rendered as an
--      href on the public site.

-- ── 1. Re-check the budget whenever amount_approved changes, not just on entering Approved ──
CREATE OR REPLACE FUNCTION public.apply_scholarship_award()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.scholarships%ROWTYPE;
  committed NUMERIC;
BEGIN
  -- Runs on entering Approved, and again on any later edit to amount_approved while still Approved.
  IF NEW.status <> 'Approved'
     OR (OLD.status = 'Approved' AND NEW.amount_approved IS NOT DISTINCT FROM OLD.amount_approved) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO s FROM public.scholarships WHERE id = NEW.scholarship_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF OLD.status <> 'Approved' AND NEW.amount_approved IS NULL AND COALESCE(s.amount, 0) > 0 THEN
    NEW.amount_approved := s.amount;
  END IF;

  IF COALESCE(s.total_budget, 0) > 0 THEN
    -- Exclude this row itself: on a fresh approval it isn't in the table as Approved yet; on a later
    -- edit it already is, and would otherwise be double-counted against its own new amount.
    committed := public.scholarship_committed(s.id)
      - CASE WHEN OLD.status = 'Approved' THEN COALESCE(OLD.amount_approved, s.amount, 0) ELSE 0 END;
    IF committed + COALESCE(NEW.amount_approved, 0) > s.total_budget THEN
      RAISE EXCEPTION 'This would exceed the budget for % (% of % already committed)', s.name, committed, s.total_budget;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_apply_scholarship_award ON public.applications;
CREATE TRIGGER tr_apply_scholarship_award
  BEFORE UPDATE OF status, amount_approved ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.apply_scholarship_award();

-- ── 2. Notify on any reopen back to Pending, not just from Rejected ──
CREATE OR REPLACE FUNCTION public.notify_application_decision()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sch TEXT;
  remarks TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  SELECT name INTO sch FROM public.scholarships WHERE id = NEW.scholarship_id;
  sch := COALESCE(sch, 'the scholarship');
  remarks := CASE WHEN COALESCE(btrim(NEW.notes), '') <> '' THEN ' Remarks: ' || NEW.notes ELSE '' END;

  IF NEW.status = 'Approved' THEN
    PERFORM public.notify(NEW.user_id, 'Application Approved', 'Your application for ' || sch || ' has been approved.' || remarks,
      'success', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Rejected' THEN
    PERFORM public.notify(NEW.user_id, 'Application Rejected', 'Your application for ' || sch || ' was not approved this time.' || remarks,
      'error', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Waitlisted' THEN
    PERFORM public.notify(NEW.user_id, 'Application Waitlisted', 'Your application for ' || sch || ' has been placed on the waitlist. We will notify you if a slot opens.' || remarks,
      'warning', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Pending' AND OLD.status IN ('Rejected', 'Waitlisted') THEN
    PERFORM public.notify(NEW.user_id, 'Application Reopened', 'Your application for ' || sch || ' has been reopened for review.' || remarks,
      'info', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Withdrawn' THEN
    PERFORM public.notify(NEW.user_id, 'Application Withdrawn', 'You withdrew your application for ' || sch || '. Your documents are kept, and you can apply again while applications are open.',
      'info', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

-- ── 3. facebook_url: same rule as the client (blank, or a full http(s) link) ──
CREATE OR REPLACE FUNCTION public.validate_system_setting_ext()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  n NUMERIC;
  s TEXT;
BEGIN
  CASE NEW.key
    WHEN 'required_documents' THEN
      IF jsonb_typeof(NEW.value) <> 'array' OR jsonb_array_length(NEW.value) > 12 THEN
        RAISE EXCEPTION 'Required documents must be a list of at most 12 items';
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(NEW.value) e
        WHERE jsonb_typeof(e) <> 'string' OR btrim(e #>> '{}') = '' OR length(e #>> '{}') > 60
      ) THEN
        RAISE EXCEPTION 'Each required document needs a name of up to 60 characters';
      END IF;
      IF (SELECT COUNT(DISTINCT lower(btrim(x))) FROM jsonb_array_elements_text(NEW.value) x) <> jsonb_array_length(NEW.value) THEN
        RAISE EXCEPTION 'Required documents must not repeat';
      END IF;
    WHEN 'default_payment_method' THEN
      IF (NEW.value #>> '{}') NOT IN ('Cash', 'Cheque') THEN
        RAISE EXCEPTION 'Default payment method must be Cash or Cheque';
      END IF;
    WHEN 'default_payment_lead_days' THEN
      IF jsonb_typeof(NEW.value) <> 'number' THEN RAISE EXCEPTION 'Lead days must be a number'; END IF;
      n := (NEW.value #>> '{}')::numeric;
      IF n < 0 OR n > 365 OR n <> trunc(n) THEN RAISE EXCEPTION 'Lead days must be a whole number from 0 to 365'; END IF;
    WHEN 'renewal_enabled' THEN
      IF jsonb_typeof(NEW.value) <> 'boolean' THEN RAISE EXCEPTION 'renewal_enabled must be on or off'; END IF;
    WHEN 'renewal_min_grade' THEN
      IF jsonb_typeof(NEW.value) <> 'number' THEN RAISE EXCEPTION 'Renewal grade must be a number'; END IF;
      n := (NEW.value #>> '{}')::numeric;
      IF n < 0 OR n > 100 THEN RAISE EXCEPTION 'Renewal grade must be between 0 and 100'; END IF;
    WHEN 'max_renewals' THEN
      IF jsonb_typeof(NEW.value) <> 'number' THEN RAISE EXCEPTION 'Max renewals must be a number'; END IF;
      n := (NEW.value #>> '{}')::numeric;
      IF n < 0 OR n > 10 OR n <> trunc(n) THEN RAISE EXCEPTION 'Max renewals must be a whole number from 0 to 10'; END IF;
    WHEN 'facebook_url' THEN
      IF jsonb_typeof(NEW.value) <> 'string' THEN RAISE EXCEPTION 'Facebook link must be text'; END IF;
      s := btrim(NEW.value #>> '{}');
      IF s <> '' AND s !~* '^https?://\S+$' THEN
        RAISE EXCEPTION 'Enter a full link starting with https://';
      END IF;
      IF length(s) > 300 THEN RAISE EXCEPTION 'Facebook link is too long'; END IF;
    ELSE
      NULL;
  END CASE;
  RETURN NEW;
END;
$$;

-- ── 4. A student can no longer blank out their own student ID once it is set ──
-- government_id was removed from the app, so student_id_number is now the sole input to the
-- duplicate-scholar check in scholar_verifications. guard_profile_update() already locks this field
-- entirely once the student has applied; this closes the earlier window (before ever applying) where
-- they could clear it via an ordinary profile edit. Setting it for the first time is still allowed.
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR auth.uid() IS NULL OR auth.uid() <> OLD.id THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR (NEW.email IS DISTINCT FROM OLD.email AND OLD.email IS NOT NULL)
     OR NEW.grade_verified_at IS DISTINCT FROM OLD.grade_verified_at
     OR NEW.grade_term IS DISTINCT FROM OLD.grade_term THEN
    RAISE EXCEPTION 'That part of your profile can only be changed by the office';
  END IF;

  IF NEW.average_grade IS DISTINCT FROM OLD.average_grade AND OLD.average_grade IS NOT NULL THEN
    RAISE EXCEPTION 'Your average grade is verified by the office. Submit a grade update with your grade report.';
  END IF;

  IF (NEW.student_id_number IS DISTINCT FROM OLD.student_id_number OR NEW.government_id IS DISTINCT FROM OLD.government_id)
     AND EXISTS (SELECT 1 FROM public.applications WHERE user_id = OLD.id AND status <> 'Withdrawn') THEN
    RAISE EXCEPTION 'Your ID numbers are locked once you have applied. Contact the office to correct them.';
  END IF;
  IF OLD.student_id_number IS NOT NULL AND NEW.student_id_number IS NULL THEN
    RAISE EXCEPTION 'Your student ID number can only be cleared by the office';
  END IF;

  IF public.documents_locked(OLD.id)
     AND ROW(NEW.first_name, NEW.middle_name, NEW.last_name, NEW.sex, NEW.dob, NEW.school_name, NEW.course, NEW.year_level)
         IS DISTINCT FROM
         ROW(OLD.first_name, OLD.middle_name, OLD.last_name, OLD.sex, OLD.dob, OLD.school_name, OLD.course, OLD.year_level) THEN
    RAISE EXCEPTION 'Your name, birth date, school, course and year level are locked while your scholarship is active. Contact the office to change them.';
  END IF;

  IF NEW.phone IS DISTINCT FROM OLD.phone AND btrim(COALESCE(NEW.phone, '')) <> '' AND NEW.phone !~ '^(09|\+639)[0-9]{9}$' THEN
    RAISE EXCEPTION 'Use a valid PH mobile number (09XXXXXXXXX or +639XXXXXXXXX)';
  END IF;
  IF NEW.guardian_phone IS DISTINCT FROM OLD.guardian_phone AND btrim(COALESCE(NEW.guardian_phone, '')) <> '' AND NEW.guardian_phone !~ '^(09|\+639)[0-9]{9}$' THEN
    RAISE EXCEPTION 'Use a valid PH mobile number for your guardian (09XXXXXXXXX or +639XXXXXXXXX)';
  END IF;
  IF NEW.zip_code IS DISTINCT FROM OLD.zip_code AND btrim(COALESCE(NEW.zip_code, '')) <> '' AND NEW.zip_code !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'ZIP code must be 4 digits';
  END IF;
  IF NEW.year_level IS DISTINCT FROM OLD.year_level AND NEW.year_level IS NOT NULL
     AND NEW.year_level NOT IN ('Grade 11', 'Grade 12', '1st Year', '2nd Year', '3rd Year', '4th Year') THEN
    RAISE EXCEPTION 'Choose a year level from the list';
  END IF;
  IF (NEW.first_name IS DISTINCT FROM OLD.first_name AND btrim(COALESCE(NEW.first_name, '')) = '')
     OR (NEW.last_name IS DISTINCT FROM OLD.last_name AND btrim(COALESCE(NEW.last_name, '')) = '') THEN
    RAISE EXCEPTION 'First and last name cannot be blank';
  END IF;
  IF NEW.dob IS DISTINCT FROM OLD.dob AND NEW.dob IS NOT NULL AND (NEW.dob > CURRENT_DATE OR NEW.dob < DATE '1900-01-01') THEN
    RAISE EXCEPTION 'Enter a valid date of birth';
  END IF;
  IF NEW.profile_picture_url IS DISTINCT FROM OLD.profile_picture_url AND NEW.profile_picture_url IS NOT NULL
     AND NEW.profile_picture_url !~ '^https?://'
     AND split_part(NEW.profile_picture_url, '/', 1) <> OLD.id::text THEN
    RAISE EXCEPTION 'Invalid photo location';
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════
-- 032_enforce_2fa_in_rls
-- ════════════════════════════════════════════════════════════════════
-- Close the two-factor bypass: the AAL2 check previously lived only in Next.js middleware and four
-- API routes. Everything else (NotificationInbox, ProfileSection, AccountSettings, the admin panels,
-- and any other component calling supabase.from(...) directly) talks straight to PostgREST, which
-- never looked at the session's authentication assurance level. A stolen or replayed password-only
-- (AAL1) session cookie for an account with a verified authenticator could read and write that
-- person's own data through those direct calls, bypassing the 2FA gate entirely.
--
-- public.mfa_ok(_user) is added to every "own row" policy below. It is a no-op (always true) for the
-- large majority of accounts that have never enrolled a second factor, so this changes nothing for
-- them. For an account with a VERIFIED factor, it additionally requires the current request's JWT to
-- carry aal2 — i.e. the second step must have been completed in this session.
--
-- Run after 031. Safe to re-run. Test with a real 2FA-enrolled account before relying on this: it
-- reads Supabase Auth's internal auth.mfa_factors table and the auth.jwt() claims, both standard but
-- unverified against a live project in this environment.

CREATE OR REPLACE FUNCTION public.mfa_ok(_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    NOT EXISTS (SELECT 1 FROM auth.mfa_factors WHERE user_id = _user AND status = 'verified')
    OR COALESCE((auth.jwt() ->> 'aal') = 'aal2', false);
$$;
GRANT EXECUTE ON FUNCTION public.mfa_ok(UUID) TO authenticated;

-- ── profiles ──
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id AND public.mfa_ok(id));
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id AND public.mfa_ok(id));
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id AND public.mfa_ok(id));

-- ── applications ──
DROP POLICY IF EXISTS "Users can view own applications" ON public.applications;
CREATE POLICY "Users can view own applications" ON public.applications
  FOR SELECT USING (auth.uid() = user_id AND public.mfa_ok(user_id));
DROP POLICY IF EXISTS "Users can insert own applications" ON public.applications;
CREATE POLICY "Users can insert own applications" ON public.applications
  FOR INSERT WITH CHECK (auth.uid() = user_id AND public.mfa_ok(user_id));
DROP POLICY IF EXISTS "Users can update own open applications" ON public.applications;
CREATE POLICY "Users can update own open applications" ON public.applications
  FOR UPDATE
  USING (auth.uid() = user_id AND status IN ('Pending', 'Waitlisted') AND public.mfa_ok(user_id))
  WITH CHECK (auth.uid() = user_id AND status IN ('Pending', 'Waitlisted', 'Withdrawn') AND public.mfa_ok(user_id));

-- ── documents ──
DROP POLICY IF EXISTS "Users can view own documents" ON public.documents;
CREATE POLICY "Users can view own documents" ON public.documents
  FOR SELECT USING (auth.uid() = user_id AND public.mfa_ok(user_id));
DROP POLICY IF EXISTS "Users can insert own documents" ON public.documents;
CREATE POLICY "Users can insert own documents" ON public.documents
  FOR INSERT WITH CHECK (auth.uid() = user_id AND public.mfa_ok(user_id));
DROP POLICY IF EXISTS "Users can delete own documents" ON public.documents;
CREATE POLICY "Users can delete own documents" ON public.documents
  FOR DELETE USING (
    auth.uid() = user_id
    AND public.mfa_ok(user_id)
    AND NOT public.documents_locked(user_id)
    AND (
      application_id IS NULL
      OR status = 'Rejected'
      OR EXISTS (
        SELECT 1 FROM public.documents n
         WHERE n.user_id = documents.user_id
           AND n.document_type = documents.document_type
           AND n.uploaded_at > documents.uploaded_at
      )
    )
  );

-- ── payments (read-only for the owner; writes go through SECURITY DEFINER functions) ──
DROP POLICY IF EXISTS "Users can view own payments" ON public.payments;
CREATE POLICY "Users can view own payments" ON public.payments
  FOR SELECT USING (auth.uid() = user_id AND public.mfa_ok(user_id));

-- ── notifications ──
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id AND public.mfa_ok(user_id));
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id AND public.mfa_ok(user_id));
DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
CREATE POLICY "Users can delete own notifications" ON public.notifications
  FOR DELETE USING (auth.uid() = user_id AND public.mfa_ok(user_id));

-- ── notification_preferences / user_settings ──
DROP POLICY IF EXISTS "Users manage own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users manage own notification preferences" ON public.notification_preferences
  FOR ALL USING (auth.uid() = user_id AND public.mfa_ok(user_id))
  WITH CHECK (auth.uid() = user_id AND public.mfa_ok(user_id));

DROP POLICY IF EXISTS "Users manage own settings" ON public.user_settings;
CREATE POLICY "Users manage own settings" ON public.user_settings
  FOR ALL USING (auth.uid() = user_id AND public.mfa_ok(user_id))
  WITH CHECK (auth.uid() = user_id AND public.mfa_ok(user_id));

-- ── grade_updates / data_requests / payment_issues (read-only for the owner) ──
DROP POLICY IF EXISTS "Students view own grade updates" ON public.grade_updates;
CREATE POLICY "Students view own grade updates" ON public.grade_updates
  FOR SELECT USING (auth.uid() = user_id AND public.mfa_ok(user_id));

DROP POLICY IF EXISTS "Students view own data requests" ON public.data_requests;
CREATE POLICY "Students view own data requests" ON public.data_requests
  FOR SELECT USING (auth.uid() = user_id AND public.mfa_ok(user_id));

DROP POLICY IF EXISTS "Students view own payment issues" ON public.payment_issues;
CREATE POLICY "Students view own payment issues" ON public.payment_issues
  FOR SELECT USING (auth.uid() = user_id AND public.mfa_ok(user_id));

-- ── scholar_verifications (identity/verification data) ──
DROP POLICY IF EXISTS "Users can view own verifications" ON public.scholar_verifications;
CREATE POLICY "Users can view own verifications" ON public.scholar_verifications
  FOR SELECT USING (auth.uid() = user_id AND public.mfa_ok(user_id));

NOTIFY pgrst, 'reload schema';

