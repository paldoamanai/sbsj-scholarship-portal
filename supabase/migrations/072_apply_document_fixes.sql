-- Applying: only the program's own documents decide (run after 071).
--
--   * A disapproved document blocked applying to every program, even one that doesn't ask for it, and
--     the application form never showed it. Now only the program's own documents count (the ones to
--     apply plus the follow-ups).
--   * A photos-only program refused a document the office had already verified as a PDF. Once an
--     approval locks it, the student could not replace it and could not apply. A verified document
--     now counts, photo or not.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

-- ── 1. Disapproved documents: only the program's own (035/063/071, edited from the live definition) ──
DO $$
DECLARE
  old_txt TEXT := 'AND d.status = ''Disapproved'' AND d.document_type NOT IN (''Letter of Intent'', ''MOA Agreement Letter'')';
  new_txt TEXT := 'AND d.status = ''Disapproved'' AND d.document_type NOT IN (''Letter of Intent'', ''MOA Agreement Letter'')
     AND public.program_approval_documents(NEW.scholarship_id) ? d.document_type';
  f RECORD;
  def TEXT;
BEGIN
  FOR f IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = 'require_accepted_documents'
  LOOP
    def := pg_get_functiondef(f.oid);
    IF position(new_txt IN def) = 0 THEN
      EXECUTE replace(def, old_txt, new_txt);
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'require_accepted_documents' AND position(new_txt IN p.prosrc) > 0
  ) THEN
    RAISE EXCEPTION 'Could not update require_accepted_documents (looking for: %); update it by hand', old_txt;
  END IF;
END $$;

-- ── 2. Photos-only programs: a verified document counts (070, plus the status) ──
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
       WHERE doc.user_id = _user AND doc.document_type = d
         AND public.in_document_set(doc.application_id, _user, _ay)
       ORDER BY doc.uploaded_at DESC
       LIMIT 1
    ) latest
   WHERE public.office_photos_only((SELECT office FROM public.scholarships WHERE id = _scholarship))
     AND latest.status IS DISTINCT FROM 'Verified'
     AND latest.mime_type NOT IN ('image/jpeg', 'image/png');
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
