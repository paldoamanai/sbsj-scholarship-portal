-- A letter of intent with every application (run after 062).
--
-- Students attach a photo (JPG or PNG) of their letter of intent each time they apply. Unlike the
-- required documents, which are shared by all of a student's applications for the academic year,
-- each letter belongs to one application.
--
--   * applications.letter_of_intent_path: the photo's storage path, given when applying. Required for
--     applications a student submits (seed and service-role inserts are not checked).
--   * The application insert files the photo as a "Letter of Intent" document of that application, in
--     the same transaction: no application without its letter, and no stray letter either.
--   * The office verifies or disapproves it like any document. Approving needs it verified (older
--     applications, which have no letter, are not affected). A disapproved letter is replaced from the
--     application, and doesn't stop the student applying elsewhere.
--   * Letters can still be uploaded after a scholarship is approved (the document lock is for the
--     shared documents), stay with their application when it is withdrawn, and can't be deleted
--     while filed, only replaced.
--   * Files live under "<student id>/letters/".
--
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS letter_of_intent_path TEXT;

-- ── 1. Applying needs the photo ──
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

DROP TRIGGER IF EXISTS tr_check_letter_of_intent ON public.applications;
CREATE TRIGGER tr_check_letter_of_intent
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.check_letter_of_intent();

-- ── 2. ...and files it as the application's document ──
-- Runs as the student, so the document checks (size, type, maintenance) apply to it too.
CREATE OR REPLACE FUNCTION public.file_letter_of_intent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  obj_size BIGINT;
  obj_mime TEXT;
BEGIN
  IF coalesce(NEW.letter_of_intent_path, '') = '' THEN RETURN NULL; END IF;
  SELECT (metadata->>'size')::bigint, metadata->>'mimetype' INTO obj_size, obj_mime
    FROM storage.objects WHERE bucket_id = 'documents' AND name = NEW.letter_of_intent_path;
  INSERT INTO public.documents (user_id, application_id, document_type, file_url, storage_path, file_name, file_size, mime_type)
  VALUES (NEW.user_id, NEW.id, 'Letter of Intent', NEW.letter_of_intent_path, NEW.letter_of_intent_path,
          -- "<id>/letters/1712345678901-letter.jpg" → "letter.jpg"
          regexp_replace(regexp_replace(NEW.letter_of_intent_path, '^.*/', ''), '^\d+-', ''),
          obj_size, obj_mime);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_file_letter_of_intent ON public.applications;
CREATE TRIGGER tr_file_letter_of_intent
  AFTER INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.file_letter_of_intent();

-- ── 3. Rules for a letter document (filed when applying, or a replacement) ──
CREATE OR REPLACE FUNCTION public.check_letter_document()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  obj_mime TEXT;
BEGIN
  IF NEW.document_type <> 'Letter of Intent' OR auth.uid() IS NULL OR auth.uid() <> NEW.user_id THEN
    RETURN NEW;
  END IF;
  IF NEW.application_id IS NULL THEN
    RAISE EXCEPTION 'A letter of intent is filed with an application';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.applications
     WHERE id = NEW.application_id AND user_id = NEW.user_id AND status NOT IN ('Approved', 'Disapproved', 'Withdrawn')
  ) THEN
    RAISE EXCEPTION 'That application has been decided, so its letter of intent can no longer change';
  END IF;
  IF split_part(coalesce(NEW.storage_path, ''), '/', 2) <> 'letters' THEN
    RAISE EXCEPTION 'Invalid file location';
  END IF;
  SELECT metadata->>'mimetype' INTO obj_mime
    FROM storage.objects WHERE bucket_id = 'documents' AND name = NEW.storage_path;
  IF obj_mime IS NULL OR obj_mime NOT IN ('image/jpeg', 'image/png') THEN
    RAISE EXCEPTION 'The letter of intent must be a photo (JPG or PNG)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_check_letter_document ON public.documents;
CREATE TRIGGER tr_check_letter_document
  BEFORE INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.check_letter_document();

-- ── 4. Approving needs the letter verified ──
CREATE OR REPLACE FUNCTION public.require_verified_letter_of_intent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  latest TEXT;
BEGIN
  IF NEW.status <> 'Approved' OR OLD.status = 'Approved' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT status INTO latest FROM public.documents
   WHERE application_id = NEW.id AND document_type = 'Letter of Intent'
   ORDER BY uploaded_at DESC LIMIT 1;
  -- Applications from before letters were asked for have none.
  IF FOUND AND latest IS DISTINCT FROM 'Verified' THEN
    RAISE EXCEPTION 'Verify the letter of intent before approving (it is %)', lower(latest);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_require_verified_letter_of_intent ON public.applications;
CREATE TRIGGER tr_require_verified_letter_of_intent
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.require_verified_letter_of_intent();

-- ── 5. Shared-document rules leave letters out (edited from their live definitions, like 055) ──
DO $$
DECLARE
  edits TEXT[][] := ARRAY[
    -- Letters are accepted although they aren't a required document, and aren't locked by an approval.
    ['validate_document_insert',
     'IF public.documents_locked(NEW.user_id) THEN',
     'IF public.documents_locked(NEW.user_id) AND NEW.document_type <> ''Letter of Intent'' THEN'],
    ['validate_document_insert',
     'AND NOT (req ? NEW.document_type) THEN',
     'AND NOT (req ? NEW.document_type) AND NEW.document_type <> ''Letter of Intent'' THEN'],
    -- A disapproved letter is replaced from its own application; it doesn't block applying elsewhere.
    ['require_accepted_documents',
     'WHERE d.user_id = NEW.user_id AND d.status = ''Disapproved''',
     'WHERE d.user_id = NEW.user_id AND d.status = ''Disapproved'' AND d.document_type <> ''Letter of Intent'''],
    -- A withdrawn application keeps its letter; only the shared documents move to another application.
    ['link_application_documents',
     'UPDATE public.documents SET application_id = heir WHERE application_id = NEW.id;',
     'UPDATE public.documents SET application_id = heir WHERE application_id = NEW.id AND document_type <> ''Letter of Intent'';']
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
        -- On a re-run the text is already replaced; don't replace it twice.
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

-- ── 6. Deleting: a filed letter only once a newer one replaced it, for the same application ──
-- (From 034; the two-factor check is kept only if 032's public.mfa_ok() exists.)
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
            ELSE NOT public.documents_locked(user_id)
             AND (
               application_id IS NULL
               OR status = 'Disapproved'
               OR EXISTS (
                 SELECT 1 FROM public.documents n
                  WHERE n.user_id = documents.user_id
                    AND n.document_type = documents.document_type
                    AND n.uploaded_at > documents.uploaded_at
               )
             )
            END
      )
  $p$, mfa);
END $$;

-- ── 7. Storage: letters upload past the lock; a letter file goes only once nothing files it ──
DROP POLICY IF EXISTS "documents_owner_insert" ON storage.objects;
CREATE POLICY "documents_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND ((storage.foldername(name))[2] IN ('receipts', 'letters') OR NOT public.documents_locked(auth.uid()))
  );

DROP POLICY IF EXISTS "documents_owner_delete" ON storage.objects;
CREATE POLICY "documents_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND COALESCE((storage.foldername(name))[2], '') <> 'receipts'
    AND CASE WHEN (storage.foldername(name))[2] = 'letters'
             THEN NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.storage_path = storage.objects.name)
             ELSE NOT public.documents_locked(auth.uid()) END
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
