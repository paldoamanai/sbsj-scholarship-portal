-- Required documents per office (run after 066; independent of 068 and 069).
--
-- Programs under Barangay Affairs ask for their own documents, all as photos (JPG or PNG):
--   Letter of Intent (already filed with every application, 063), Student ID, Barangay Indigency,
--   Certificate of Registration and Grades.
-- Every other program (MSWDO, Sangguniang Bayan, municipality-wide) keeps the Settings → Required
-- Documents list. The list is kept in office_required_documents() below, mirrored in
-- src/lib/office-requirements.ts.
--
--   * Applying checks the program's own list, and for a photos-only office that the latest copy of
--     each document is a photo.
--   * Approving checks that the program's own documents are verified.
--   * Uploads accept a document on any office's list.
--   * A student already approved this academic year can still upload a document type they don't have
--     yet (or only have disapproved copies of), so they can apply to a program that asks for it. What
--     the approval relied on stays locked.
--   * Weekly reminders name each application's own missing documents.
--   * scholarships_public() includes the program's office, so students see which list applies.
--
-- Functions are edited from their live definitions, like 055 and 063. Run in the Supabase SQL Editor.
-- Safe to re-run.

BEGIN;

-- ── 1. Which documents a program asks for ──
CREATE OR REPLACE FUNCTION public.office_required_documents(_office TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE _office
    WHEN 'barangay_affairs' THEN '["Student ID", "Barangay Indigency", "Certificate of Registration", "Grades"]'::jsonb
    ELSE (SELECT CASE WHEN jsonb_typeof(value) = 'array' THEN value END
            FROM public.system_settings WHERE key = 'required_documents')
  END;
$$;

CREATE OR REPLACE FUNCTION public.office_photos_only(_office TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _office IS NOT DISTINCT FROM 'barangay_affairs';
$$;

CREATE OR REPLACE FUNCTION public.program_required_documents(_scholarship UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.office_required_documents((SELECT office FROM public.scholarships WHERE id = _scholarship));
$$;

-- Every document some program asks for: what a student may upload.
CREATE OR REPLACE FUNCTION public.all_required_documents()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(DISTINCT d), '[]'::jsonb)
    FROM (SELECT jsonb_array_elements_text(public.office_required_documents(o)) AS d
            FROM unnest(ARRAY[NULL, 'barangay_affairs', 'mswdo', 'sangguniang_bayan']) AS o) t;
$$;

-- A photos-only program's documents whose latest copy in this academic year isn't a photo, or NULL.
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
      SELECT doc.mime_type FROM public.documents doc
       WHERE doc.user_id = _user AND doc.document_type = d
         AND public.in_document_set(doc.application_id, _user, _ay)
       ORDER BY doc.uploaded_at DESC
       LIMIT 1
    ) latest
   WHERE public.office_photos_only((SELECT office FROM public.scholarships WHERE id = _scholarship))
     AND latest.mime_type NOT IN ('image/jpeg', 'image/png');
$$;

-- Once a scholarship is approved, documents stay as they were approved. A type with no copy yet, or
-- only disapproved ones, can still be uploaded.
CREATE OR REPLACE FUNCTION public.document_type_open(_user UUID, _type TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.documents doc
     WHERE doc.user_id = _user AND doc.document_type = _type AND doc.status <> 'Disapproved'
       AND public.in_document_set(doc.application_id, _user, public.current_academic_year())
  );
$$;

-- The same for a storage folder ("<id>/documents/<type folder>/..."), before the document row exists.
CREATE OR REPLACE FUNCTION public.document_folder_open(_user UUID, _folder TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.documents doc
     WHERE doc.user_id = _user AND doc.status <> 'Disapproved'
       AND split_part(coalesce(doc.storage_path, ''), '/', 2) = 'documents'
       AND split_part(doc.storage_path, '/', 3) = _folder
       AND public.in_document_set(doc.application_id, _user, public.current_academic_year())
  );
$$;

GRANT EXECUTE ON FUNCTION public.office_required_documents(TEXT), public.office_photos_only(TEXT),
  public.program_required_documents(UUID), public.all_required_documents() TO anon, authenticated;

-- ── 2. Use them in the document rules ──
DO $$
DECLARE
  edits TEXT[][] := ARRAY[
    -- Applying: the program's own list, as photos where the office asks for photos.
    ['enforce_application_settings',
     'SELECT value INTO required_docs FROM public.system_settings WHERE key = ''required_documents'';',
     'required_docs := public.program_required_documents(NEW.scholarship_id);'],
    ['enforce_application_settings',
     'RAISE EXCEPTION ''Upload all required documents before applying. Missing: %'', missing;',
     'RAISE EXCEPTION ''Upload all required documents before applying. Missing: %'', missing;
      END IF;
      missing := public.documents_not_photos(NEW.user_id, NEW.scholarship_id, public.current_academic_year());
      IF missing IS NOT NULL THEN
        RAISE EXCEPTION ''This program needs a photo (JPG or PNG) of each document. Upload a photo of: %'', missing;'],
    -- Approving: the program's own list.
    ['require_verified_documents_before_approval',
     'SELECT value INTO req FROM public.system_settings WHERE key = ''required_documents'';',
     'req := public.program_required_documents(NEW.scholarship_id);'],
    -- Uploading: a document on any office's list; new types past the approval lock.
    ['validate_document_insert',
     'SELECT value INTO req FROM public.system_settings WHERE key = ''required_documents'';',
     'req := public.all_required_documents();'],
    ['validate_document_insert',
     'IF public.documents_locked(NEW.user_id) AND NEW.document_type <> ''Letter of Intent'' THEN',
     'IF public.documents_locked(NEW.user_id) AND NEW.document_type <> ''Letter of Intent'' AND NOT public.document_type_open(NEW.user_id, NEW.document_type) THEN'],
    -- Reminders: each application's own list.
    ['send_document_reminders',
     'SELECT id, user_id FROM public.applications',
     'SELECT id, user_id, scholarship_id FROM public.applications'],
    ['send_document_reminders',
     'FROM jsonb_array_elements_text(req) AS d',
     'FROM jsonb_array_elements_text(COALESCE(public.program_required_documents(a.scholarship_id), ''[]''::jsonb)) AS d']
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

-- ── 3. Storage: past the approval lock, uploads into a document folder that is still open ──
DROP POLICY IF EXISTS "documents_owner_insert" ON storage.objects;
CREATE POLICY "documents_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND ((storage.foldername(name))[2] IN ('receipts', 'letters')
         OR NOT public.documents_locked(auth.uid())
         OR ((storage.foldername(name))[2] = 'documents'
             AND public.document_folder_open(auth.uid(), (storage.foldername(name))[3])))
  );

-- ── 4. Public program list: the program's office (064, plus office) ──
DROP FUNCTION IF EXISTS public.scholarships_public();
CREATE FUNCTION public.scholarships_public()
RETURNS TABLE (
  id UUID, name TEXT, description TEXT, amount NUMERIC, slots INTEGER, slots_left INTEGER,
  deadline DATE, open_date DATE, eligibility TEXT, min_grade NUMERIC, year_levels TEXT[],
  municipality TEXT, barangays TEXT[], created_at TIMESTAMPTZ, availability TEXT, release_schedule TEXT,
  release_months INTEGER, office TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.name, s.description, s.amount, s.slots,
         CASE WHEN s.slots > 0 THEN GREATEST(s.slots - a.cnt, 0) END,
         s.deadline, s.open_date, s.eligibility, s.min_grade, s.year_levels, s.municipality, s.barangays, s.created_at,
         CASE
           WHEN s.open_date IS NOT NULL AND s.open_date > CURRENT_DATE THEN 'upcoming'
           WHEN s.deadline IS NOT NULL AND s.deadline < CURRENT_DATE THEN 'closed'
           WHEN s.slots > 0 AND a.cnt >= s.slots THEN 'full'
           ELSE 'open'
         END,
         s.release_schedule, s.release_months, s.office
    FROM public.scholarships s
   CROSS JOIN LATERAL (
     SELECT COUNT(*)::int AS cnt FROM public.applications ap
      WHERE ap.scholarship_id = s.id AND ap.status = 'Approved' AND ap.academic_year = public.current_academic_year()
   ) a
   WHERE s.is_active
   ORDER BY s.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.scholarships_public() TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
