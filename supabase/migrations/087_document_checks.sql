-- Document checks (run after 086): flags that point reviewers at uploads worth a closer look.
-- None of these reject a document on their own; staff still decide.
--
--   * documents get:
--       checks          what the student's browser found at upload, from the original file (before a big
--                       photo is shrunk, which drops its metadata): image quality, editing software,
--                       AI labels, camera data, photo location. Set once, by the owner.
--       scan            what a reviewer's browser found reading the stored file: the text on it compared
--                       with the profile, signatories, dates, layout against a genuine sample, location.
--       sha256, phash   fingerprints of the stored file (exact, and "looks alike") for duplicates
--       control_no      a control / registry number read from the document
--       ai_score        an AI-likelihood score from a paid detector, when one is set up
--       flags           everything above plus duplicates found here, kept up to date by triggers
--       needs_original  set automatically for serious flags (or by staff); such a document can't be
--                       Verified until staff record that they saw the original (original_seen_*)
--       review_flags    the flags the document had when it was last reviewed
--   * document_matches(): other students' documents with the same file, a near-identical image or the
--     same control number, and the student's own copies from an earlier school year.
--   * document_signatories: the barangay captains, registrars and other signatories staff keep current;
--     scans check that the name on a document is one of them.
--   * document_samples: one genuine sample per document type (and barangay or school), stored under
--     samples/ in the documents bucket; scans compare an upload's layout with it.
--   * application_source_checks: confirmations with the registrar, the barangay, PSA, or of the originals.
--   * document_audits + select_audit_sample(): pick a random share of approved scholars for a full check;
--     they are told to bring their originals.
--   * barred_students + set_student_barred(): accounts caught with fake documents can't apply again.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

-- ── 1. Columns ──
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS checks JSONB,
  ADD COLUMN IF NOT EXISTS scan JSONB,
  ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scanned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sha256 TEXT,
  ADD COLUMN IF NOT EXISTS phash TEXT,
  ADD COLUMN IF NOT EXISTS control_no TEXT,
  ADD COLUMN IF NOT EXISTS ai_score NUMERIC,
  ADD COLUMN IF NOT EXISTS ai_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS flags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS needs_original BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS original_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_seen_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_note TEXT,
  ADD COLUMN IF NOT EXISTS review_flags TEXT[];

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_checks_shape;
ALTER TABLE public.documents ADD CONSTRAINT documents_checks_shape CHECK (
  (checks IS NULL OR (jsonb_typeof(checks) = 'object' AND jsonb_typeof(coalesce(checks -> 'flags', '[]')) = 'array'
                      AND pg_column_size(checks) < 32768))
  AND (scan IS NULL OR (jsonb_typeof(scan) = 'object' AND jsonb_typeof(coalesce(scan -> 'flags', '[]')) = 'array'
                        AND pg_column_size(scan) < 65536))
  AND (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$')
  AND (phash IS NULL OR phash ~ '^[0-9a-f]{64}$')
  AND (control_no IS NULL OR char_length(control_no) BETWEEN 3 AND 40)
  AND (ai_score IS NULL OR ai_score BETWEEN 0 AND 1)
);

CREATE INDEX IF NOT EXISTS documents_sha256_idx ON public.documents (sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_control_no_idx ON public.documents (document_type, control_no) WHERE control_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_type_phash_idx ON public.documents (document_type) WHERE phash IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_flagged_idx ON public.documents (uploaded_at DESC) WHERE flags <> '{}';

-- ── 2. Rules ──
-- Flags serious enough that the original must be seen before the document is verified.
CREATE OR REPLACE FUNCTION public.doc_high_flags()
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['same_file', 'similar_image', 'duplicate_control_no', 'ai_label', 'ai_prompt', 'ai_detector_high',
               'editing_software', 'name_mismatch', 'signatory_outdated', 'future_date'];
$$;

-- A serious flag the document didn't have before. Only those turn needs_original back on, so a reviewer's
-- decision not to ask for the original (set_needs_original) stands until something new is found.
CREATE OR REPLACE FUNCTION public.doc_new_high_flag(_new TEXT[], _old TEXT[])
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT EXISTS (SELECT 1 FROM unnest(coalesce(_new, '{}')) f
                  WHERE f = ANY (public.doc_high_flags()) AND NOT f = ANY (coalesce(_old, '{}')));
$$;

-- Documents that must be new each school year: the same file again a year later is flagged.
CREATE OR REPLACE FUNCTION public.doc_fresh_types()
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['Barangay Indigency', 'Certificate of Registration', 'Grades', 'Latest Grades', 'Letter of Intent'];
$$;

-- Forms everyone fills in from the same template: alike by design, so not compared by image.
CREATE OR REPLACE FUNCTION public.doc_template_types()
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['MOA Agreement Letter', 'Simple Bio Data'];
$$;

-- Differing bits between two 256-bit "looks alike" fingerprints (64 hex characters).
CREATE OR REPLACE FUNCTION public.phash_distance(_a TEXT, _b TEXT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _a IS NULL OR _b IS NULL OR length(_a) <> 64 OR length(_b) <> 64 THEN NULL
              ELSE bit_count(('x' || _a)::bit(256) # ('x' || _b)::bit(256))::int END;
$$;

-- At most this many differing bits counts as "near-identical": a re-saved, recompressed or slightly blurred
-- copy (0-4 bits in tests), or the same image with a name changed (about 14). Two different certificates
-- from the same template differed by about 30, different documents by over 100.
CREATE OR REPLACE FUNCTION public.phash_similar_bits()
RETURNS INT LANGUAGE sql IMMUTABLE AS $$ SELECT 16; $$;

-- ── 3. Flags found by comparing with other documents ──
CREATE OR REPLACE FUNCTION public.document_server_flags(_d public.documents)
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN _d.sha256 IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.documents o WHERE o.sha256 = _d.sha256 AND o.user_id <> _d.user_id) THEN 'same_file' END,
    CASE WHEN _d.phash IS NOT NULL AND NOT (_d.document_type = ANY (public.doc_template_types())) AND EXISTS (
      SELECT 1 FROM public.documents o
       WHERE o.user_id <> _d.user_id AND o.document_type = _d.document_type AND o.phash IS NOT NULL
         AND o.sha256 IS DISTINCT FROM _d.sha256
         AND public.phash_distance(o.phash, _d.phash) <= public.phash_similar_bits()) THEN 'similar_image' END,
    CASE WHEN _d.document_type = ANY (public.doc_fresh_types()) AND (_d.sha256 IS NOT NULL OR _d.phash IS NOT NULL) AND EXISTS (
      SELECT 1 FROM public.documents o
       WHERE o.user_id = _d.user_id AND o.id <> _d.id AND o.document_type = _d.document_type
         AND public.academic_year_of(o.uploaded_at) < public.academic_year_of(_d.uploaded_at)
         AND (o.sha256 = _d.sha256 OR public.phash_distance(o.phash, _d.phash) <= public.phash_similar_bits())) THEN 'reused_earlier_year' END,
    CASE WHEN _d.control_no IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.documents o
       WHERE o.control_no = _d.control_no AND o.document_type = _d.document_type AND o.user_id <> _d.user_id) THEN 'duplicate_control_no' END
  ], NULL);
$$;

CREATE OR REPLACE FUNCTION public.document_all_flags(_d public.documents)
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(DISTINCT f ORDER BY f), '{}') FROM (
    SELECT jsonb_array_elements_text(coalesce(_d.checks -> 'flags', '[]')) AS f
    UNION SELECT jsonb_array_elements_text(coalesce(_d.scan -> 'flags', '[]'))
    UNION SELECT unnest(public.document_server_flags(_d))
    UNION SELECT 'ai_detector_high' WHERE _d.ai_score >= 0.8
    UNION SELECT 'ai_detector_medium' WHERE _d.ai_score >= 0.5 AND _d.ai_score < 0.8
  ) x WHERE f ~ '^[a-z_]{2,40}$';
$$;
-- Only the triggers and functions here use these (they would tell a caller whether a file exists elsewhere).
REVOKE ALL ON FUNCTION public.document_server_flags(public.documents), public.document_all_flags(public.documents)
  FROM PUBLIC, anon, authenticated;

-- ── 4. Triggers ──
-- Check results change only through the functions below (which set app.doc_checks), never by a direct
-- update. Students can't update documents at all; this keeps staff edits going through the audited path.
CREATE OR REPLACE FUNCTION public.guard_document_checks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR pg_trigger_depth() > 1 OR current_setting('app.doc_checks', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW.checks, NEW.scan, NEW.scanned_at, NEW.scanned_by, NEW.sha256, NEW.phash, NEW.control_no, NEW.ai_score,
         NEW.ai_checked_at, NEW.flags, NEW.needs_original, NEW.original_seen_at, NEW.original_seen_by, NEW.original_note,
         NEW.review_flags)
     IS DISTINCT FROM
     ROW(OLD.checks, OLD.scan, OLD.scanned_at, OLD.scanned_by, OLD.sha256, OLD.phash, OLD.control_no, OLD.ai_score,
         OLD.ai_checked_at, OLD.flags, OLD.needs_original, OLD.original_seen_at, OLD.original_seen_by, OLD.original_note,
         OLD.review_flags) THEN
    RAISE EXCEPTION 'Document checks can only be changed from the review panel';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_doc_checks_1_guard ON public.documents;
CREATE TRIGGER tr_doc_checks_1_guard
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_document_checks();

CREATE OR REPLACE FUNCTION public.set_document_flags()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- What a student sends at upload is their browser's report and nothing more.
    NEW.scan := NULL; NEW.scanned_at := NULL; NEW.scanned_by := NULL; NEW.control_no := NULL;
    NEW.ai_score := NULL; NEW.ai_checked_at := NULL; NEW.needs_original := false;
    NEW.original_seen_at := NULL; NEW.original_seen_by := NULL; NEW.original_note := NULL; NEW.review_flags := NULL;
  END IF;
  NEW.flags := public.document_all_flags(NEW);
  IF public.doc_new_high_flag(NEW.flags, CASE WHEN TG_OP = 'UPDATE' THEN OLD.flags END) THEN NEW.needs_original := true; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_doc_checks_2_flags ON public.documents;
CREATE TRIGGER tr_doc_checks_2_flags
  BEFORE INSERT OR UPDATE OF checks, scan, sha256, phash, control_no, ai_score ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.set_document_flags();

-- A new or changed fingerprint also flags the documents it matches (and a deleted one may clear them).
CREATE OR REPLACE FUNCTION public.refresh_matching_flags()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d public.documents := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  IF d.sha256 IS NULL AND d.phash IS NULL AND d.control_no IS NULL THEN RETURN NULL; END IF;
  UPDATE public.documents o
     SET flags = public.document_all_flags(o),
         needs_original = o.needs_original OR public.doc_new_high_flag(public.document_all_flags(o), o.flags)
   WHERE o.id <> d.id
     AND (o.sha256 = d.sha256
          OR (o.document_type = d.document_type AND o.phash IS NOT NULL
              AND public.phash_distance(o.phash, d.phash) <= public.phash_similar_bits())
          OR (o.document_type = d.document_type AND o.control_no = d.control_no))
     AND o.flags IS DISTINCT FROM public.document_all_flags(o);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS tr_doc_checks_3_matches ON public.documents;
CREATE TRIGGER tr_doc_checks_3_matches
  AFTER INSERT OR UPDATE OF sha256, phash, control_no ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.refresh_matching_flags();
DROP TRIGGER IF EXISTS tr_doc_checks_4_matches_gone ON public.documents;
CREATE TRIGGER tr_doc_checks_4_matches_gone
  AFTER DELETE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.refresh_matching_flags();

-- ── 5. Students: the upload report for a file they just uploaded ──
-- Used for the letter of intent, which the database files from the application; other uploads send it
-- with the insert. Only once, and only within a day of the upload.
CREATE OR REPLACE FUNCTION public.set_upload_checks(_path TEXT, _checks JSONB, _sha256 TEXT, _phash TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.doc_checks', '1', true);
  UPDATE public.documents
     SET checks = _checks, sha256 = _sha256, phash = _phash
   WHERE storage_path = _path AND user_id = auth.uid() AND checks IS NULL
     AND uploaded_at > now() - interval '1 day';
  PERFORM set_config('app.doc_checks', '', true);
END;
$$;
REVOKE ALL ON FUNCTION public.set_upload_checks(TEXT, JSONB, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_upload_checks(TEXT, JSONB, TEXT, TEXT) TO authenticated;

-- ── 6. Staff: results of reading the stored file ──
CREATE OR REPLACE FUNCTION public.doc_staff_target(_id UUID)
RETURNS public.documents
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d public.documents;
BEGIN
  IF NOT public.staff_may(auth.uid(), 'review') THEN RAISE EXCEPTION 'Only reviewers and admins can do this'; END IF;
  SELECT * INTO d FROM public.documents WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found'; END IF;
  IF NOT public.office_ok_person(d.user_id) THEN RAISE EXCEPTION 'This student is not one of your office''s applicants' USING ERRCODE = '42501'; END IF;
  RETURN d;
END;
$$;
REVOKE ALL ON FUNCTION public.doc_staff_target(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_document_scan(_id UUID, _scan JSONB, _sha256 TEXT, _phash TEXT, _control_no TEXT)
RETURNS TABLE (flags TEXT[], needs_original BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ctl TEXT := nullif(upper(regexp_replace(btrim(coalesce(_control_no, '')), '\s+', '', 'g')), '');
BEGIN
  PERFORM public.doc_staff_target(_id);
  PERFORM set_config('app.doc_checks', '1', true);
  RETURN QUERY
  UPDATE public.documents d
     SET scan = _scan, scanned_at = now(), scanned_by = auth.uid(),
         sha256 = coalesce(_sha256, d.sha256), phash = coalesce(_phash, d.phash),
         control_no = CASE WHEN char_length(_ctl) BETWEEN 3 AND 40 THEN _ctl END
   WHERE d.id = _id
  RETURNING d.flags, d.needs_original;
  PERFORM set_config('app.doc_checks', '', true);
END;
$$;
REVOKE ALL ON FUNCTION public.record_document_scan(UUID, JSONB, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_document_scan(UUID, JSONB, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_ai_score(_id UUID, _score NUMERIC)
RETURNS TABLE (flags TEXT[], needs_original BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.doc_staff_target(_id);
  IF _score IS NULL OR _score < 0 OR _score > 1 THEN RAISE EXCEPTION 'The score must be between 0 and 1'; END IF;
  PERFORM set_config('app.doc_checks', '1', true);
  RETURN QUERY
  UPDATE public.documents d SET ai_score = round(_score, 3), ai_checked_at = now()
   WHERE d.id = _id
  RETURNING d.flags, d.needs_original;
  PERFORM set_config('app.doc_checks', '', true);
END;
$$;
REVOKE ALL ON FUNCTION public.record_ai_score(UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_ai_score(UUID, NUMERIC) TO authenticated;

-- Staff saw (or un-saw) the original paper document.
CREATE OR REPLACE FUNCTION public.mark_original_seen(_id UUID, _seen BOOLEAN, _note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d public.documents := public.doc_staff_target(_id);
BEGIN
  PERFORM set_config('app.doc_checks', '1', true);
  UPDATE public.documents
     SET original_seen_at = CASE WHEN _seen THEN now() END,
         original_seen_by = CASE WHEN _seen THEN auth.uid() END,
         original_note = CASE WHEN _seen THEN nullif(left(btrim(coalesce(_note, '')), 500), '') END
   WHERE id = _id;
  PERFORM set_config('app.doc_checks', '', true);
  PERFORM public.audit_staff_change(CASE WHEN _seen THEN 'original_document_seen' ELSE 'original_document_unseen' END,
    'documents', _id, jsonb_build_object('original_seen_at', d.original_seen_at),
    jsonb_build_object('document_type', d.document_type, 'student', d.user_id, 'flags', d.flags, 'note', nullif(btrim(coalesce(_note, '')), '')));
END;
$$;
REVOKE ALL ON FUNCTION public.mark_original_seen(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_original_seen(UUID, BOOLEAN, TEXT) TO authenticated;

-- Staff ask for (or stop asking for) the original. Clearing it on a document with serious flags needs a reason.
CREATE OR REPLACE FUNCTION public.set_needs_original(_id UUID, _needs BOOLEAN, _reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d public.documents := public.doc_staff_target(_id);
BEGIN
  IF NOT _needs AND d.flags && public.doc_high_flags() AND btrim(coalesce(_reason, '')) = '' THEN
    RAISE EXCEPTION 'This document has serious flags: add a reason for not asking for the original';
  END IF;
  PERFORM set_config('app.doc_checks', '1', true);
  UPDATE public.documents SET needs_original = _needs WHERE id = _id;
  PERFORM set_config('app.doc_checks', '', true);
  PERFORM public.audit_staff_change(CASE WHEN _needs THEN 'require_original_document' ELSE 'waive_original_document' END,
    'documents', _id, jsonb_build_object('needs_original', d.needs_original),
    jsonb_build_object('needs_original', _needs, 'document_type', d.document_type, 'student', d.user_id, 'flags', d.flags,
                       'reason', nullif(btrim(coalesce(_reason, '')), '')));
END;
$$;
REVOKE ALL ON FUNCTION public.set_needs_original(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_needs_original(UUID, BOOLEAN, TEXT) TO authenticated;

-- ── 7. Reviewing: a document that needs its original can't be verified before it is seen ──
CREATE OR REPLACE FUNCTION public.review_document(_id UUID, _status TEXT, _note TEXT DEFAULT NULL)
RETURNS TABLE (status TEXT, review_note TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d public.documents;
BEGIN
  IF NOT public.staff_may(auth.uid(), 'review') THEN RAISE EXCEPTION 'Only reviewers and admins can do this'; END IF;
  IF _status NOT IN ('Verified', 'Disapproved', 'Pending') THEN RAISE EXCEPTION 'Choose Verified, Disapproved or Pending'; END IF;
  IF _status = 'Disapproved' AND btrim(COALESCE(_note, '')) = '' THEN RAISE EXCEPTION 'Add a reason so the student knows what to fix'; END IF;

  SELECT * INTO d FROM public.documents WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found'; END IF;
  IF _status = 'Verified' AND d.needs_original AND d.original_seen_at IS NULL THEN
    RAISE EXCEPTION 'This document was flagged: record that you have seen the original before verifying it';
  END IF;

  PERFORM set_config('app.doc_checks', '1', true);
  RETURN QUERY
  UPDATE public.documents x
     SET status = _status,
         review_note = CASE WHEN _status = 'Disapproved' THEN btrim(_note) ELSE NULL END,
         review_flags = CASE WHEN _status = 'Pending' THEN NULL ELSE x.flags END
   WHERE x.id = _id
  RETURNING x.status::text, x.review_note;
  PERFORM set_config('app.doc_checks', '', true);

  -- The usual review entry is written by the document's own trigger; this one records what was flagged.
  IF _status = 'Verified' AND d.flags <> '{}' THEN
    PERFORM public.audit_staff_change('verify_flagged_document', 'documents', _id, NULL,
      jsonb_build_object('document_type', d.document_type, 'student', d.user_id, 'flags', d.flags,
                         'original_seen_at', d.original_seen_at, 'ai_score', d.ai_score));
  END IF;
END;
$$;

-- ── 8. Matches with other documents (for the reviewer's side-by-side view) ──
CREATE OR REPLACE FUNCTION public.document_matches(_id UUID)
RETURNS TABLE (kind TEXT, other_id UUID, other_user UUID, student_name TEXT, document_type TEXT,
               uploaded_at TIMESTAMPTZ, distance INT, same_office BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d public.documents := public.doc_staff_target(_id);
BEGIN
  RETURN QUERY
  SELECT m.kind, o.id, o.user_id, public.display_name(o.user_id), o.document_type, o.uploaded_at,
         public.phash_distance(o.phash, d.phash), public.office_ok_person(o.user_id)
    FROM public.documents o
    CROSS JOIN LATERAL (SELECT CASE
      WHEN o.user_id <> d.user_id AND o.sha256 = d.sha256 THEN 'same_file'
      WHEN o.user_id <> d.user_id AND o.document_type = d.document_type AND o.control_no = d.control_no THEN 'same_control_no'
      WHEN o.user_id <> d.user_id AND o.document_type = d.document_type AND NOT (d.document_type = ANY (public.doc_template_types()))
           AND public.phash_distance(o.phash, d.phash) <= public.phash_similar_bits() THEN 'similar_image'
      WHEN o.user_id = d.user_id AND o.id <> d.id AND o.document_type = d.document_type
           AND public.academic_year_of(o.uploaded_at) < public.academic_year_of(d.uploaded_at)
           AND (o.sha256 = d.sha256 OR public.phash_distance(o.phash, d.phash) <= public.phash_similar_bits()) THEN 'earlier_year'
    END AS kind) m
   WHERE m.kind IS NOT NULL
   ORDER BY o.uploaded_at DESC
   LIMIT 20;
END;
$$;
REVOKE ALL ON FUNCTION public.document_matches(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_matches(UUID) TO authenticated;

-- ── 9. Signatories and genuine samples, kept by staff ──
CREATE TABLE IF NOT EXISTS public.document_signatories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type TEXT,                 -- NULL: any document
  place TEXT,                         -- barangay or school; NULL: anywhere
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 3 AND 120),
  position TEXT CHECK (position IS NULL OR char_length(position) <= 120),
  active BOOLEAN NOT NULL DEFAULT true, -- false: a former signatory (a document they "signed" recently is flagged)
  created_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.document_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type TEXT NOT NULL,
  place TEXT,
  label TEXT CHECK (label IS NULL OR char_length(label) <= 120),
  storage_path TEXT NOT NULL UNIQUE CHECK (storage_path LIKE 'samples/%'),
  mime_type TEXT,
  phash TEXT CHECK (phash IS NULL OR phash ~ '^[0-9a-f]{64}$'),
  layout JSONB,                       -- edge density on a 16 x 16 grid and the page's aspect ratio
  created_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 10. Confirmations with whoever issued a document ──
CREATE TABLE IF NOT EXISTS public.application_source_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('registrar', 'barangay', 'psa', 'original', 'other')),
  result TEXT NOT NULL CHECK (result IN ('Confirmed', 'Not confirmed', 'Waiting')),
  contact TEXT CHECK (contact IS NULL OR char_length(contact) <= 200),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  checked_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS application_source_checks_app_idx ON public.application_source_checks (application_id);

-- ── 11. Random audits ──
CREATE TABLE IF NOT EXISTS public.document_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Passed', 'Failed')),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  selected_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  UNIQUE (application_id, academic_year)
);

-- ── 12. Barred from applying ──
CREATE TABLE IF NOT EXISTS public.barred_students (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  barred_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  barred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 13. Policies ──
ALTER TABLE public.document_signatories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_source_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barred_students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read signatories" ON public.document_signatories;
CREATE POLICY "Staff read signatories" ON public.document_signatories FOR SELECT USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Reviewers keep signatories" ON public.document_signatories;
CREATE POLICY "Reviewers keep signatories" ON public.document_signatories FOR ALL
  USING (public.staff_may(auth.uid(), 'review')) WITH CHECK (public.staff_may(auth.uid(), 'review'));

DROP POLICY IF EXISTS "Staff read samples" ON public.document_samples;
CREATE POLICY "Staff read samples" ON public.document_samples FOR SELECT USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "Reviewers keep samples" ON public.document_samples;
CREATE POLICY "Reviewers keep samples" ON public.document_samples FOR ALL
  USING (public.staff_may(auth.uid(), 'review')) WITH CHECK (public.staff_may(auth.uid(), 'review'));

DROP POLICY IF EXISTS "Staff read source checks" ON public.application_source_checks;
CREATE POLICY "Staff read source checks" ON public.application_source_checks FOR SELECT
  USING (public.is_staff(auth.uid()) AND public.office_ok(public.application_office(application_id)));
DROP POLICY IF EXISTS "Reviewers add source checks" ON public.application_source_checks;
CREATE POLICY "Reviewers add source checks" ON public.application_source_checks FOR INSERT
  WITH CHECK (public.staff_may(auth.uid(), 'review') AND public.office_ok(public.application_office(application_id))
              AND checked_by = auth.uid());
DROP POLICY IF EXISTS "Reviewers remove their source checks" ON public.application_source_checks;
CREATE POLICY "Reviewers remove their source checks" ON public.application_source_checks FOR DELETE
  USING ((checked_by = auth.uid() AND public.staff_may(auth.uid(), 'review')) OR public.staff_may(auth.uid(), 'manage'));

DROP POLICY IF EXISTS "Staff read audits" ON public.document_audits;
CREATE POLICY "Staff read audits" ON public.document_audits FOR SELECT
  USING (public.is_staff(auth.uid()) AND public.office_ok(public.application_office(application_id)));

DROP POLICY IF EXISTS "Staff read barred students" ON public.barred_students;
CREATE POLICY "Staff read barred students" ON public.barred_students FOR SELECT
  USING (public.is_staff(auth.uid()) OR user_id = auth.uid());

-- Same two-factor / signed-out rule as every other table (075).
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['document_signatories', 'document_samples', 'application_source_checks', 'document_audits', 'barred_students'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Staff need two-factor" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Staff need two-factor" ON public.%I AS RESTRICTIVE FOR ALL USING ((SELECT public.staff_access_ok())) WITH CHECK ((SELECT public.staff_access_ok()))', t);
  END LOOP;
END $$;

-- Audit entries for staff changes to signatories, samples and source checks.
CREATE OR REPLACE FUNCTION public.audit_document_check_tables()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.audited_staff_change() THEN RETURN NULL; END IF;
  PERFORM public.audit_staff_change(
    lower(TG_OP) || '_' || TG_TABLE_NAME, TG_TABLE_NAME,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END);
  RETURN NULL;
END;
$$;
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['document_signatories', 'document_samples', 'application_source_checks'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_audit_%s ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER tr_audit_%s AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_document_check_tables()', t, t);
  END LOOP;
END $$;

-- Samples live under samples/ in the documents bucket: every staff member may read them (061 limited
-- office staff to their own students' folders), reviewers add and remove them.
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
  IF _parts[1] = 'samples' THEN RETURN public.is_staff(auth.uid()); END IF;
  -- Checked one step at a time: SQL doesn't promise to test the pattern before the cast.
  IF _parts[1] = 'receipts' THEN
    IF coalesce(_parts[2], '') !~ '^[0-9a-f-]{36}$' THEN RETURN false; END IF;
    RETURN public.office_ok(public.payment_office(_parts[2]::uuid));
  END IF;
  IF coalesce(_parts[1], '') !~ '^[0-9a-f-]{36}$' THEN RETURN false; END IF;
  RETURN public.office_ok_person(_parts[1]::uuid);
END;
$$;

DROP POLICY IF EXISTS "documents_samples_insert" ON storage.objects;
CREATE POLICY "documents_samples_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents' AND (storage.foldername(name))[1] = 'samples' AND public.staff_may(auth.uid(), 'review'));
DROP POLICY IF EXISTS "documents_samples_delete" ON storage.objects;
CREATE POLICY "documents_samples_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = 'samples' AND public.staff_may(auth.uid(), 'review'));

-- ── 14. Random audits: pick, then pass or fail ──
CREATE OR REPLACE FUNCTION public.select_audit_sample(_percent NUMERIC, _academic_year TEXT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _eligible INT;
  _n INT;
  _picked UUID[];
BEGIN
  IF NOT public.staff_may(auth.uid(), 'review') THEN RAISE EXCEPTION 'Only reviewers and admins can do this'; END IF;
  IF _percent IS NULL OR _percent <= 0 OR _percent > 100 THEN RAISE EXCEPTION 'Pick a share between 1 and 100 percent'; END IF;

  SELECT count(*) INTO _eligible FROM public.applications a
   WHERE a.status = 'Approved' AND a.academic_year = _academic_year AND public.office_ok(public.application_office(a.id));
  _n := ceil(_eligible * _percent / 100.0)::int
        - (SELECT count(*) FROM public.document_audits da WHERE da.academic_year = _academic_year
            AND public.office_ok(public.application_office(da.application_id)));
  IF _n <= 0 THEN RETURN 0; END IF;

  WITH chosen AS (
    INSERT INTO public.document_audits (application_id, academic_year)
    SELECT a.id, _academic_year FROM public.applications a
     WHERE a.status = 'Approved' AND a.academic_year = _academic_year
       AND public.office_ok(public.application_office(a.id))
       AND NOT EXISTS (SELECT 1 FROM public.document_audits da WHERE da.application_id = a.id AND da.academic_year = _academic_year)
     ORDER BY random()
     LIMIT _n
    RETURNING application_id
  )
  SELECT array_agg(application_id) INTO _picked FROM chosen;

  PERFORM public.notify(a.user_id, 'Your documents were picked for a check',
    'Your scholarship was picked at random for a document check, as some are every year. Please bring the original copies of the documents you uploaded to the scholarship office.',
    'info', 'application', '/student-dashboard?section=documents', 'applications', a.id)
    FROM public.applications a WHERE a.id = ANY (coalesce(_picked, '{}'));

  PERFORM public.audit_staff_change('select_audit_sample', 'applications', NULL, NULL,
    jsonb_build_object('academic_year', _academic_year, 'percent', _percent, 'applications', to_jsonb(coalesce(_picked, '{}'))));
  RETURN coalesce(cardinality(_picked), 0);
END;
$$;
REVOKE ALL ON FUNCTION public.select_audit_sample(NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.select_audit_sample(NUMERIC, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_document_audit(_id UUID, _status TEXT, _note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.document_audits;
BEGIN
  IF NOT public.staff_may(auth.uid(), 'review') THEN RAISE EXCEPTION 'Only reviewers and admins can do this'; END IF;
  IF _status NOT IN ('Open', 'Passed', 'Failed') THEN RAISE EXCEPTION 'Choose Open, Passed or Failed'; END IF;
  IF _status = 'Failed' AND btrim(coalesce(_note, '')) = '' THEN RAISE EXCEPTION 'Add what was wrong'; END IF;
  SELECT * INTO r FROM public.document_audits WHERE id = _id;
  IF NOT FOUND OR NOT public.office_ok(public.application_office(r.application_id)) THEN RAISE EXCEPTION 'Audit not found'; END IF;
  UPDATE public.document_audits
     SET status = _status, note = nullif(left(btrim(coalesce(_note, '')), 1000), ''),
         resolved_by = CASE WHEN _status = 'Open' THEN NULL ELSE auth.uid() END,
         resolved_at = CASE WHEN _status = 'Open' THEN NULL ELSE now() END
   WHERE id = _id;
  PERFORM public.audit_staff_change('resolve_document_audit', 'applications', r.application_id,
    jsonb_build_object('status', r.status), jsonb_build_object('status', _status, 'note', nullif(btrim(coalesce(_note, '')), '')));
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_document_audit(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_document_audit(UUID, TEXT, TEXT) TO authenticated;

-- ── 15. Barring a student from applying ──
CREATE OR REPLACE FUNCTION public.set_student_barred(_user UUID, _barred BOOLEAN, _reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _prev public.barred_students;
BEGIN
  IF NOT public.staff_may(auth.uid(), 'manage') THEN RAISE EXCEPTION 'Only admins can do this'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user AND role::text = 'student') THEN
    RAISE EXCEPTION 'Only student accounts can be barred';
  END IF;
  IF NOT public.office_ok_person(_user) THEN
    RAISE EXCEPTION 'This student has not applied to your office''s programs' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _prev FROM public.barred_students WHERE user_id = _user;
  IF _barred THEN
    IF char_length(btrim(coalesce(_reason, ''))) < 3 THEN RAISE EXCEPTION 'Add the reason'; END IF;
    INSERT INTO public.barred_students (user_id, reason) VALUES (_user, btrim(_reason))
      ON CONFLICT (user_id) DO UPDATE SET reason = EXCLUDED.reason, barred_by = auth.uid(), barred_at = now();
  ELSE
    DELETE FROM public.barred_students WHERE user_id = _user;
  END IF;
  PERFORM public.audit_staff_change(CASE WHEN _barred THEN 'bar_student' ELSE 'unbar_student' END, 'profiles', _user,
    to_jsonb(_prev), jsonb_build_object('barred', _barred, 'reason', nullif(btrim(coalesce(_reason, '')), '')));
END;
$$;
REVOKE ALL ON FUNCTION public.set_student_barred(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_student_barred(UUID, BOOLEAN, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.refuse_barred_applicant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.barred_students WHERE user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Your account can''t apply for scholarships. Please contact the scholarship office.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_refuse_barred_applicant ON public.applications;
CREATE TRIGGER tr_refuse_barred_applicant
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.refuse_barred_applicant();

COMMIT;

NOTIFY pgrst, 'reload schema';
