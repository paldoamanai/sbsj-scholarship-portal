-- Programs can be limited to residents of particular barangays of San Jose (e.g. only Labangan
-- Poblacion), not just a municipality. scholarships.barangays: NULL / empty = any barangay.
-- Students pick their barangay from the list in src/lib/barangays.ts; the comparison still ignores
-- case, punctuation and a "Brgy." / "Barangay" prefix, for profiles saved before the list existed.
--
-- Enforced when a signed-in student applies, when staff approve, and in program reminders.
-- Run after 045. Safe to re-run.

BEGIN;

ALTER TABLE public.scholarships ADD COLUMN IF NOT EXISTS barangays TEXT[];

CREATE OR REPLACE FUNCTION public.normalize_barangay(v TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
           btrim(regexp_replace(lower(COALESCE(v, '')), '[^[:alnum:]]+', ' ', 'g')),
           '^(brgy|bgy|barangay) ', '');
$$;

CREATE OR REPLACE FUNCTION public.in_barangays(_mine TEXT, _list TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _list IS NULL OR cardinality(_list) = 0
      OR (public.normalize_barangay(_mine) <> ''
          AND EXISTS (SELECT 1 FROM unnest(_list) b WHERE public.normalize_barangay(b) = public.normalize_barangay(_mine)));
$$;

-- ── Applying ──
-- tr_enforce_scholarship_open checks the other program rules; this runs right after it (name order).
CREATE OR REPLACE FUNCTION public.enforce_program_barangays()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.scholarships%ROWTYPE;
  mine TEXT;
BEGIN
  IF auth.uid() IS NULL OR NEW.scholarship_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO s FROM public.scholarships WHERE id = NEW.scholarship_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT barangay INTO mine FROM public.profiles WHERE id = NEW.user_id;
  IF NOT public.in_barangays(mine, s.barangays) THEN
    RAISE EXCEPTION '% is for residents of barangay % only', s.name, array_to_string(s.barangays, ', ');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_scholarship_open_barangays ON public.applications;
CREATE TRIGGER tr_enforce_scholarship_open_barangays
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_program_barangays();

-- ── Approval: checked against the current profile (updates with no signed-in user are not checked) ──
CREATE OR REPLACE FUNCTION public.require_program_barangays_on_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.scholarships%ROWTYPE;
  mine TEXT;
BEGIN
  IF NEW.status <> 'Approved' OR OLD.status = 'Approved' OR auth.uid() IS NULL OR NEW.scholarship_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO s FROM public.scholarships WHERE id = NEW.scholarship_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT barangay INTO mine FROM public.profiles WHERE id = NEW.user_id;
  IF NOT public.in_barangays(mine, s.barangays) THEN
    RAISE EXCEPTION 'The student does not meet this program''s requirements: resident of barangay % (lives in %)',
      array_to_string(s.barangays, ', '), COALESCE(NULLIF(btrim(mine), ''), 'not set');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_require_program_barangays_on_approval ON public.applications;
CREATE TRIGGER tr_require_program_barangays_on_approval
  BEFORE UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.require_program_barangays_on_approval();

-- ── Reminders: only students in the program's barangays ──
DO $$
DECLARE
  def TEXT;
  patched TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'student_eligible_for';
  IF def IS NULL OR position('in_barangays' IN def) > 0 THEN RETURN; END IF;
  patched := replace(def,
    'OR p.year_level = ANY (s.year_levels))',
    'OR p.year_level = ANY (s.year_levels))' || E'\n       AND public.in_barangays(p.barangay, s.barangays)');
  IF patched = def THEN
    RAISE EXCEPTION 'Could not find where to add the barangay rule in student_eligible_for; update it by hand';
  END IF;
  EXECUTE patched;
END $$;

-- ── Public program list: include the barangays ──
DROP FUNCTION IF EXISTS public.scholarships_public();
CREATE FUNCTION public.scholarships_public()
RETURNS TABLE (
  id UUID, name TEXT, description TEXT, amount NUMERIC, slots INTEGER, slots_left INTEGER,
  deadline DATE, open_date DATE, eligibility TEXT, min_grade NUMERIC, year_levels TEXT[],
  municipality TEXT, barangays TEXT[], created_at TIMESTAMPTZ, availability TEXT
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
         END
    FROM public.scholarships s
   CROSS JOIN LATERAL (
     SELECT COUNT(*)::int AS cnt FROM public.applications ap WHERE ap.scholarship_id = s.id AND ap.status = 'Approved'
   ) a
   WHERE s.is_active
   ORDER BY s.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.scholarships_public() TO anon, authenticated;
GRANT SELECT (barangays) ON public.scholarships TO anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
