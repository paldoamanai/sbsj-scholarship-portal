-- Removes document checks (087): flags, fingerprints, the needs-original gate, signatories, samples,
-- source checks, random audits and barred students. Restores review_document (050) and office_ok_file (061)
-- to what they were before 087.
--
-- Run in the Supabase SQL Editor. Safe to re-run, and safe if 087 never ran.

BEGIN;

-- ── 1. Triggers ──
DROP TRIGGER IF EXISTS tr_doc_checks_1_guard ON public.documents;
DROP TRIGGER IF EXISTS tr_doc_checks_2_flags ON public.documents;
DROP TRIGGER IF EXISTS tr_doc_checks_3_matches ON public.documents;
DROP TRIGGER IF EXISTS tr_doc_checks_4_matches_gone ON public.documents;
DROP TRIGGER IF EXISTS tr_refuse_barred_applicant ON public.applications;

-- ── 2. Storage policies for samples/ ──
DROP POLICY IF EXISTS "documents_samples_insert" ON storage.objects;
DROP POLICY IF EXISTS "documents_samples_delete" ON storage.objects;

-- ── 3. Restore functions 087 replaced ──
CREATE OR REPLACE FUNCTION public.review_document(_id UUID, _status TEXT, _note TEXT DEFAULT NULL)
RETURNS TABLE (status TEXT, review_note TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.staff_may(auth.uid(), 'review') THEN RAISE EXCEPTION 'Only reviewers and admins can do this'; END IF;
  IF _status NOT IN ('Verified', 'Disapproved', 'Pending') THEN RAISE EXCEPTION 'Choose Verified, Disapproved or Pending'; END IF;
  IF _status = 'Disapproved' AND btrim(COALESCE(_note, '')) = '' THEN RAISE EXCEPTION 'Add a reason so the student knows what to fix'; END IF;

  RETURN QUERY
  UPDATE public.documents d
     SET status = _status,
         review_note = CASE WHEN _status = 'Disapproved' THEN btrim(_note) ELSE NULL END
   WHERE d.id = _id
  RETURNING d.status::text, d.review_note;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.office_ok_file(_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _parts TEXT[] := string_to_array(_name, '/');
BEGIN
  IF public.staff_office(auth.uid()) IS NULL THEN RETURN true; END IF;
  -- Checked one step at a time: SQL doesn't promise to test the pattern before the cast.
  IF _parts[1] = 'receipts' THEN
    IF coalesce(_parts[2], '') !~ '^[0-9a-f-]{36}$' THEN RETURN false; END IF;
    RETURN public.office_ok(public.payment_office(_parts[2]::uuid));
  END IF;
  IF coalesce(_parts[1], '') !~ '^[0-9a-f-]{36}$' THEN RETURN false; END IF;
  RETURN public.office_ok_person(_parts[1]::uuid);
END;
$$;

-- ── 4. Tables (their policies and audit triggers go with them) ──
DROP TABLE IF EXISTS public.document_signatories;
DROP TABLE IF EXISTS public.document_samples;
DROP TABLE IF EXISTS public.application_source_checks;
DROP TABLE IF EXISTS public.document_audits;
DROP TABLE IF EXISTS public.barred_students;

-- ── 5. Functions 087 added ──
DROP FUNCTION IF EXISTS public.set_upload_checks(TEXT, JSONB, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.doc_staff_target(UUID);
DROP FUNCTION IF EXISTS public.record_document_scan(UUID, JSONB, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.record_ai_score(UUID, NUMERIC);
DROP FUNCTION IF EXISTS public.mark_original_seen(UUID, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.set_needs_original(UUID, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.document_matches(UUID);
DROP FUNCTION IF EXISTS public.select_audit_sample(NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.resolve_document_audit(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.set_student_barred(UUID, BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.refuse_barred_applicant();
DROP FUNCTION IF EXISTS public.audit_document_check_tables();
DROP FUNCTION IF EXISTS public.guard_document_checks();
DROP FUNCTION IF EXISTS public.set_document_flags();
DROP FUNCTION IF EXISTS public.refresh_matching_flags();
DROP FUNCTION IF EXISTS public.document_all_flags(public.documents);
DROP FUNCTION IF EXISTS public.document_server_flags(public.documents);
DROP FUNCTION IF EXISTS public.phash_similar_bits();
DROP FUNCTION IF EXISTS public.phash_distance(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.doc_template_types();
DROP FUNCTION IF EXISTS public.doc_fresh_types();
DROP FUNCTION IF EXISTS public.doc_new_high_flag(TEXT[], TEXT[]);
DROP FUNCTION IF EXISTS public.doc_high_flags();

-- ── 6. Columns on documents (their indexes and the shape check go with them) ──
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_checks_shape;
ALTER TABLE public.documents
  DROP COLUMN IF EXISTS checks,
  DROP COLUMN IF EXISTS scan,
  DROP COLUMN IF EXISTS scanned_at,
  DROP COLUMN IF EXISTS scanned_by,
  DROP COLUMN IF EXISTS sha256,
  DROP COLUMN IF EXISTS phash,
  DROP COLUMN IF EXISTS control_no,
  DROP COLUMN IF EXISTS ai_score,
  DROP COLUMN IF EXISTS ai_checked_at,
  DROP COLUMN IF EXISTS flags,
  DROP COLUMN IF EXISTS needs_original,
  DROP COLUMN IF EXISTS original_seen_at,
  DROP COLUMN IF EXISTS original_seen_by,
  DROP COLUMN IF EXISTS original_note,
  DROP COLUMN IF EXISTS review_flags;

-- ── 7. The camera-only photo setting ──
DELETE FROM public.system_settings WHERE key = 'camera_only_photos';

COMMIT;

NOTIFY pgrst, 'reload schema';
