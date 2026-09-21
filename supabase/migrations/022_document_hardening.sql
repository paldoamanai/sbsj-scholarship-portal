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
