-- Documents belong to one application each, instead of being shared by the student's applications
-- for the academic year (run after 072).
--
--   * Applying: the documents uploaded in the application form (not filed with an application yet)
--     are checked, and the new application files the ones its program asks for.
--   * After applying: follow-ups and replacements are uploaded to that application, and approval
--     checks that application's own documents.
--   * Locking: an application's documents stop changing once it is decided, instead of every document
--     locking once any scholarship is approved. The letter of intent and MOA keep their own rules.
--   * A withdrawn application keeps its documents.
--   * Existing applications get their own copy of each shared document they counted on (same file,
--     same review status), so nothing already submitted or approved loses a document. A file can now
--     be shared by several copies, so it is only deleted from storage once no document uses it.
--
-- Functions are edited from their live definitions. Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

-- ── 1. The document rules, per application ──
DO $$
DECLARE
  edits TEXT[][] := ARRAY[
    -- Applying: what was uploaded in the form.
    ['enforce_application_settings',
     'public.in_document_set(doc.application_id, NEW.user_id, public.current_academic_year())',
     'doc.application_id IS NULL'],
    ['require_accepted_documents',
     'AND public.in_document_set(d.application_id, NEW.user_id, public.current_academic_year())',
     'AND d.application_id IS NULL'],
    ['require_accepted_documents',
     'AND public.in_document_set(n.application_id, NEW.user_id, public.current_academic_year())',
     'AND n.application_id IS NULL'],
    -- Approving: the application's own documents.
    ['require_verified_documents_before_approval',
     'AND public.in_document_set(doc.application_id, NEW.user_id, NEW.academic_year)',
     'AND doc.application_id = NEW.id'],
    -- The new application files what its program asks for; a withdrawn one keeps its documents.
    ['link_application_documents',
     'WHERE user_id = NEW.user_id AND application_id IS NULL;',
     'WHERE user_id = NEW.user_id AND application_id IS NULL
       AND public.program_approval_documents(NEW.scholarship_id) ? document_type;'],
    ['link_application_documents',
     'UPDATE public.documents SET application_id = heir WHERE application_id = NEW.id AND document_type NOT IN (''Letter of Intent'', ''MOA Agreement Letter'');',
     'NULL; -- Each application keeps its own documents (073).'],
    -- Uploading: only to an application still in review (letters and MOAs have their own checks).
    ['validate_document_insert',
     'IF public.documents_locked(NEW.user_id) AND NEW.document_type NOT IN (''Letter of Intent'', ''MOA Agreement Letter'') AND NOT public.document_type_open(NEW.user_id, NEW.document_type) THEN
    RAISE EXCEPTION ''Your documents are locked because your scholarship has been approved'';',
     'IF NEW.document_type NOT IN (''Letter of Intent'', ''MOA Agreement Letter'') AND NEW.application_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.applications WHERE id = NEW.application_id AND status IN (''Pending'', ''Waitlisted'')) THEN
    RAISE EXCEPTION ''That application has been decided, so its documents can no longer change'';']
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

-- Reminders: each application's own missing documents, once a week. Replaced whole rather than edited,
-- because the live definition differs from the one in this folder.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'send_document_reminders' AND p.pronargs = 0
                AND p.prorettype <> 'void'::regtype) THEN
    DROP FUNCTION public.send_document_reminders();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.send_document_reminders()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a RECORD;
  missing TEXT;
  week TEXT := floor(extract(epoch FROM now()) / 604800)::bigint::text;
BEGIN
  FOR a IN
    SELECT id, user_id, scholarship_id FROM public.applications
     WHERE status = 'Pending' AND created_at < now() - interval '2 days'
       AND academic_year = public.current_academic_year()
  LOOP
    SELECT string_agg(d, ', ') INTO missing
      FROM jsonb_array_elements_text(public.program_approval_documents(a.scholarship_id)) AS d
     WHERE NOT EXISTS (
       SELECT 1 FROM public.documents doc
        WHERE doc.application_id = a.id AND doc.document_type = d AND doc.status NOT IN ('Rejected', 'Disapproved')
     );
    IF missing IS NOT NULL THEN
      PERFORM public.notify(a.user_id, 'Documents still needed', 'Your application can''t be approved until these are uploaded: ' || missing || '.',
        'warning', 'application', '/student-dashboard?section=documents', 'applications', a.id, 'docs-' || a.id::text || '-' || week);
    END IF;
  END LOOP;
END;
$$;

-- Photos-only programs, at apply time: what was uploaded in the form (072, per application).
CREATE OR REPLACE FUNCTION public.documents_not_photos(_user UUID, _scholarship UUID, _ay TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT string_agg(d, ', ')
    FROM jsonb_array_elements_text(public.program_required_documents(_scholarship)) AS d
    CROSS JOIN LATERAL (
      SELECT doc.mime_type, doc.status FROM public.documents doc
       WHERE doc.user_id = _user AND doc.document_type = d AND doc.application_id IS NULL
       ORDER BY doc.uploaded_at DESC
       LIMIT 1
    ) latest
   WHERE public.office_photos_only((SELECT office FROM public.scholarships WHERE id = _scholarship))
     AND latest.status IS DISTINCT FROM 'Verified'
     AND latest.mime_type NOT IN ('image/jpeg', 'image/png');
$$;

-- ── 2. Each existing application gets its own copy of the shared documents it counted on ──
-- Copies aren't new uploads, so staff aren't notified about them.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_notify_document_uploaded' AND tgrelid = 'public.documents'::regclass) THEN
    ALTER TABLE public.documents DISABLE TRIGGER tr_notify_document_uploaded;
  END IF;
END $$;

INSERT INTO public.documents (user_id, application_id, document_type, file_url, storage_path, file_name, file_size,
                              mime_type, status, review_note, reviewed_by, reviewed_at, uploaded_at)
SELECT a.user_id, a.id, src.document_type, src.file_url, src.storage_path, src.file_name, src.file_size,
       src.mime_type, src.status, src.review_note, src.reviewed_by, src.reviewed_at, src.uploaded_at
  FROM public.applications a
 CROSS JOIN LATERAL jsonb_array_elements_text(public.program_approval_documents(a.scholarship_id)) AS t(doc_type)
 CROSS JOIN LATERAL (
   SELECT d.* FROM public.documents d
    WHERE d.user_id = a.user_id AND d.document_type = t.doc_type
      AND (d.application_id IS NULL OR d.application_id IN (
            SELECT o.id FROM public.applications o
             WHERE o.user_id = a.user_id AND o.academic_year IS NOT DISTINCT FROM a.academic_year))
    ORDER BY d.uploaded_at DESC
    LIMIT 1
 ) src
 WHERE a.status <> 'Withdrawn'
   AND NOT EXISTS (SELECT 1 FROM public.documents own
                    WHERE own.application_id = a.id AND own.document_type = t.doc_type);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_notify_document_uploaded' AND tgrelid = 'public.documents'::regclass) THEN
    ALTER TABLE public.documents ENABLE TRIGGER tr_notify_document_uploaded;
  END IF;
END $$;

-- ── 3. Deleting a document: unattached, or replaced / disapproved while its application is in review ──
-- (063's letter rule unchanged; the two-factor check is kept only if 032's public.mfa_ok() exists.)
DO $$
DECLARE
  mfa TEXT := CASE WHEN to_regprocedure('public.mfa_ok(uuid)') IS NOT NULL
                   THEN 'AND public.mfa_ok(user_id)' ELSE '' END;
BEGIN
  DROP POLICY IF EXISTS "Users can delete own documents" ON public.documents;
  EXECUTE format($p$
    CREATE POLICY "Users can delete own documents" ON public.documents
      FOR DELETE USING (
        auth.uid() = user_id
        %s
        AND CASE WHEN document_type = 'Letter of Intent' THEN EXISTS (
              SELECT 1 FROM public.documents n
               WHERE n.application_id = documents.application_id
                 AND n.document_type = 'Letter of Intent'
                 AND n.uploaded_at > documents.uploaded_at)
            ELSE application_id IS NULL
              OR (EXISTS (SELECT 1 FROM public.applications a
                           WHERE a.id = documents.application_id AND a.status IN ('Pending', 'Waitlisted'))
                  AND (status = 'Disapproved'
                       OR EXISTS (SELECT 1 FROM public.documents n
                                   WHERE n.application_id = documents.application_id
                                     AND n.document_type = documents.document_type
                                     AND n.uploaded_at > documents.uploaded_at)))
            END
      )
  $p$, mfa);
END $$;

-- ── 4. Storage: a student uploads into their own folder (the document rows decide what's allowed), and
-- a file goes only once no document uses it ──
DROP POLICY IF EXISTS "documents_owner_insert" ON storage.objects;
CREATE POLICY "documents_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "documents_owner_delete" ON storage.objects;
CREATE POLICY "documents_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND COALESCE((storage.foldername(name))[2], '') <> 'receipts'
    AND NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.storage_path = storage.objects.name)
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
