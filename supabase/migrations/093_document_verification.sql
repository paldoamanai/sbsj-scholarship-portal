-- Document verification, kept light: checks FLAG documents for a reviewer, they never block verifying one.
--
--   1. Upload checks (done in the student's browser, saved with the document): a file fingerprint
--      (SHA-256), a "looks alike" image fingerprint, photo quality (blurry, dark, glare, too small) and
--      what the file says about itself (editing software, a designed or edited PDF, a screenshot).
--   2. Matches: document_matches_for_user() finds the same file, or a near-identical image, used for a
--      different document type by the same student, or by another student.
--   3. Reviewer records: "original seen" (at a home visit or payout) and "fabricated document".
--
-- Run in the Supabase SQL Editor AFTER 088 (which removed the earlier document checks).
-- Safe to re-run.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.guard_document_checks()') IS NOT NULL THEN
    RAISE EXCEPTION 'Run 088_remove_document_checks.sql first: the earlier document checks (087) are still installed';
  END IF;
END $$;

-- ── 1. Columns on documents ──
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS file_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS image_hash TEXT,
  ADD COLUMN IF NOT EXISTS upload_check JSONB,
  ADD COLUMN IF NOT EXISTS check_flags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS original_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_seen_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_seen_note TEXT,
  ADD COLUMN IF NOT EXISTS fabricated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fabricated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fabricated_note TEXT;

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_fingerprints_shape;
ALTER TABLE public.documents ADD CONSTRAINT documents_fingerprints_shape CHECK (
  (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$')
  AND (image_hash IS NULL OR image_hash ~ '^[0-9a-f]{64}$')
  AND cardinality(check_flags) <= 20
  AND (upload_check IS NULL OR pg_column_size(upload_check) < 8000)
);
CREATE INDEX IF NOT EXISTS documents_file_sha256 ON public.documents (file_sha256) WHERE file_sha256 IS NOT NULL;

-- Students fill in the upload checks; everything a reviewer records is staff-only.
CREATE OR REPLACE FUNCTION public.guard_document_verification()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_staff(auth.uid()) THEN
    -- A document that is reopened or verified is no longer marked fabricated.
    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'Disapproved' THEN
      NEW.fabricated_at := NULL; NEW.fabricated_by := NULL; NEW.fabricated_note := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.original_seen_at := NULL; NEW.original_seen_by := NULL; NEW.original_seen_note := NULL;
    NEW.fabricated_at := NULL; NEW.fabricated_by := NULL; NEW.fabricated_note := NULL;
    RETURN NEW;
  END IF;
  IF ROW(NEW.file_sha256, NEW.image_hash, NEW.upload_check, NEW.check_flags, NEW.original_seen_at, NEW.original_seen_by,
         NEW.original_seen_note, NEW.fabricated_at,
         NEW.fabricated_by, NEW.fabricated_note)
     IS DISTINCT FROM
     ROW(OLD.file_sha256, OLD.image_hash, OLD.upload_check, OLD.check_flags, OLD.original_seen_at, OLD.original_seen_by,
         OLD.original_seen_note, OLD.fabricated_at,
         OLD.fabricated_by, OLD.fabricated_note) THEN
    RAISE EXCEPTION 'Only the office can change a document''s checks';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_guard_document_verification ON public.documents;
CREATE TRIGGER tr_guard_document_verification BEFORE INSERT OR UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_document_verification();

-- ── 2. Matches ──
-- Same file (identical SHA-256, or images at most 8 of 256 bits apart) or a near-identical image (at most
-- 40 bits apart; different documents differ in about 128). A student's own copies of the same document type
-- (one per application) are normal and left out.
CREATE OR REPLACE FUNCTION public.document_matches_for_user(_user UUID)
RETURNS TABLE (doc_id UUID, match_id UUID, match_user UUID, match_name TEXT, match_type TEXT, match_status TEXT, same_file BOOLEAN, distance INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH mine AS (
    SELECT id, user_id, document_type, file_sha256, image_hash FROM public.documents
     WHERE user_id = _user AND (file_sha256 IS NOT NULL OR image_hash IS NOT NULL)
  ), pairs AS (
    SELECT d.id AS doc_id, m.id AS match_id, m.user_id AS match_user, m.document_type AS match_type, m.status AS match_status,
           CASE WHEN d.image_hash IS NOT NULL AND m.image_hash IS NOT NULL
                THEN bit_count(('x' || d.image_hash)::bit(256) # ('x' || m.image_hash)::bit(256))::int END AS dist,
           (d.file_sha256 IS NOT NULL AND d.file_sha256 = m.file_sha256) AS same_sha
      FROM mine d
      JOIN public.documents m ON m.id <> d.id
       AND NOT (m.user_id = d.user_id AND m.document_type = d.document_type)
       AND ((d.file_sha256 IS NOT NULL AND m.file_sha256 = d.file_sha256) OR (d.image_hash IS NOT NULL AND m.image_hash IS NOT NULL))
  )
  SELECT p.doc_id, p.match_id, p.match_user,
         NULLIF(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''), p.match_type, p.match_status,
         p.same_sha OR COALESCE(p.dist, 999) <= 8, COALESCE(p.dist, 0)
    FROM pairs p LEFT JOIN public.profiles pr ON pr.id = p.match_user
   WHERE (public.is_staff(auth.uid()) AND public.office_ok_person(_user))
     AND (p.same_sha OR p.dist <= 40)
   ORDER BY p.same_sha DESC, p.dist
   LIMIT 200;
$$;
REVOKE ALL ON FUNCTION public.document_matches_for_user(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_matches_for_user(UUID) TO authenticated;

-- ── 3. Reviewer records ──
CREATE OR REPLACE FUNCTION public.doc_for_reviewer(_id UUID)
RETURNS public.documents LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.documents%ROWTYPE;
BEGIN
  IF NOT public.staff_may(auth.uid(), 'review') THEN RAISE EXCEPTION 'Only admins and reviewers can do this' USING ERRCODE = '42501'; END IF;
  SELECT * INTO d FROM public.documents WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found'; END IF;
  IF NOT public.office_ok_person(d.user_id) THEN RAISE EXCEPTION 'This document belongs to another office''s applicant' USING ERRCODE = '42501'; END IF;
  RETURN d;
END;
$$;
REVOKE ALL ON FUNCTION public.doc_for_reviewer(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_document_original_seen(_id UUID, _seen BOOLEAN, _note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.doc_for_reviewer(_id);
  UPDATE public.documents
     SET original_seen_at = CASE WHEN _seen THEN now() END,
         original_seen_by = CASE WHEN _seen THEN auth.uid() END,
         original_seen_note = CASE WHEN _seen THEN NULLIF(btrim(COALESCE(_note, '')), '') END
   WHERE id = _id;
  PERFORM public.audit_staff_change(CASE WHEN _seen THEN 'document_original_seen' ELSE 'document_original_unseen' END,
    'documents', _id, NULL, jsonb_build_object('note', NULLIF(btrim(COALESCE(_note, '')), '')));
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_document_fabricated(_id UUID, _note TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(btrim(_note), '') = '' THEN RAISE EXCEPTION 'Say what was wrong with the document'; END IF;
  PERFORM public.doc_for_reviewer(_id);
  UPDATE public.documents
     SET status = 'Disapproved', review_note = 'Fabricated or altered document: ' || btrim(_note),
         fabricated_at = now(), fabricated_by = auth.uid(), fabricated_note = btrim(_note)
   WHERE id = _id;
  -- The status change above clears the fabricated mark only when the status is not Disapproved, so it stays.
  PERFORM public.audit_staff_change('mark_document_fabricated', 'documents', _id, NULL, jsonb_build_object('note', btrim(_note)));
END;
$$;

REVOKE ALL ON FUNCTION public.set_document_original_seen(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_document_fabricated(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_document_original_seen(UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_document_fabricated(UUID, TEXT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
