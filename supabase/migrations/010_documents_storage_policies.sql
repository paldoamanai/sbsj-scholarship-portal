-- Storage policies for the private `documents` bucket.
--   * students read/write only inside their own folder  (<user_id>/...)
--   * admins can read every document (signed receipt / document links in the admin UI)
--   * admins can upload and remove disbursement receipts (receipts/...)

INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "documents_owner_select" ON storage.objects;
CREATE POLICY "documents_owner_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "documents_owner_insert" ON storage.objects;
CREATE POLICY "documents_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "documents_owner_update" ON storage.objects;
CREATE POLICY "documents_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "documents_staff_select" ON storage.objects;
CREATE POLICY "documents_staff_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'documents' AND public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "documents_finance_insert" ON storage.objects;
CREATE POLICY "documents_finance_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (public.has_role('admin', auth.uid()))
  );

DROP POLICY IF EXISTS "documents_finance_delete" ON storage.objects;
CREATE POLICY "documents_finance_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (public.has_role('admin', auth.uid()))
  );
