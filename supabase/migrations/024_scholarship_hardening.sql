-- Scholarship programs: real award amounts and budgets, per-program eligibility rules, an opening
-- date, safe edits, and a public listing that shows availability without exposing the budget.
-- Run after 023. Safe to re-run.

-- ── 1. Columns and constraints ──
ALTER TABLE public.scholarships ADD COLUMN IF NOT EXISTS open_date DATE;
ALTER TABLE public.scholarships ADD COLUMN IF NOT EXISTS min_grade NUMERIC;         -- NULL = only the global minimum applies
ALTER TABLE public.scholarships ADD COLUMN IF NOT EXISTS year_levels TEXT[];        -- NULL / empty = any year level
ALTER TABLE public.scholarships ADD COLUMN IF NOT EXISTS municipality TEXT;         -- NULL / empty = any residence

ALTER TABLE public.scholarships DROP CONSTRAINT IF EXISTS scholarships_budget_nonneg;
ALTER TABLE public.scholarships ADD CONSTRAINT scholarships_budget_nonneg CHECK (total_budget IS NULL OR total_budget >= 0);
ALTER TABLE public.scholarships DROP CONSTRAINT IF EXISTS scholarships_min_grade_range;
ALTER TABLE public.scholarships ADD CONSTRAINT scholarships_min_grade_range CHECK (min_grade IS NULL OR (min_grade >= 0 AND min_grade <= 100));
ALTER TABLE public.scholarships DROP CONSTRAINT IF EXISTS scholarships_window;
ALTER TABLE public.scholarships ADD CONSTRAINT scholarships_window CHECK (open_date IS NULL OR deadline IS NULL OR open_date <= deadline);

-- ── 2. Money committed to a program = approved awards (the program amount where none was set) ──
CREATE OR REPLACE FUNCTION public.scholarship_committed(_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(COALESCE(a.amount_approved, s.amount, 0)), 0)
    FROM public.applications a
    JOIN public.scholarships s ON s.id = a.scholarship_id
   WHERE a.scholarship_id = _id AND a.status = 'Approved';
$$;

-- ── 3. Safe edits by admins ──
CREATE OR REPLACE FUNCTION public.validate_scholarship_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  approved INTEGER;
  committed NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;   -- seed / service role

  NEW.name := btrim(NEW.name);
  IF NEW.name = '' THEN RAISE EXCEPTION 'Name is required'; END IF;

  IF NEW.deadline IS NOT NULL AND NEW.deadline < CURRENT_DATE
     AND (TG_OP = 'INSERT' OR NEW.deadline IS DISTINCT FROM OLD.deadline) THEN
    RAISE EXCEPTION 'The deadline cannot be in the past';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.slots > 0 AND NEW.slots IS DISTINCT FROM OLD.slots THEN
      SELECT COUNT(*) INTO approved FROM public.applications WHERE scholarship_id = NEW.id AND status = 'Approved';
      IF NEW.slots < approved THEN
        RAISE EXCEPTION 'Slots cannot be lower than the % scholar(s) already approved', approved;
      END IF;
    END IF;
    IF NEW.total_budget > 0 AND NEW.total_budget IS DISTINCT FROM OLD.total_budget THEN
      committed := public.scholarship_committed(NEW.id);
      IF NEW.total_budget < committed THEN
        RAISE EXCEPTION 'The budget cannot be lower than the % already committed to approved scholars', committed;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_validate_scholarship_change ON public.scholarships;
CREATE TRIGGER tr_validate_scholarship_change
  BEFORE INSERT OR UPDATE ON public.scholarships
  FOR EACH ROW EXECUTE FUNCTION public.validate_scholarship_change();

-- ── 4. Applying: opening date and the program's own eligibility rules ──
CREATE OR REPLACE FUNCTION public.enforce_scholarship_open()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.scholarships%ROWTYPE;
  prof public.profiles%ROWTYPE;
  approved_count INTEGER;
BEGIN
  IF NEW.scholarship_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO s FROM public.scholarships WHERE id = NEW.scholarship_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scholarship program not found';
  END IF;
  IF NOT s.is_active THEN
    RAISE EXCEPTION '% is not accepting applications', s.name;
  END IF;
  IF s.open_date IS NOT NULL AND s.open_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Applications for % open on %', s.name, to_char(s.open_date, 'FMMonth DD, YYYY');
  END IF;
  IF s.deadline IS NOT NULL AND s.deadline < CURRENT_DATE THEN
    RAISE EXCEPTION 'The deadline for % has passed (%)', s.name, s.deadline;
  END IF;
  IF s.slots > 0 THEN
    SELECT COUNT(*) INTO approved_count FROM public.applications
     WHERE scholarship_id = s.id AND status = 'Approved';
    IF approved_count >= s.slots THEN
      RAISE EXCEPTION 'All % slots for % are already filled', s.slots, s.name;
    END IF;
  END IF;

  -- The program's own eligibility rules (for signed-in students; not seed / service-role inserts).
  IF auth.uid() IS NOT NULL THEN
    SELECT * INTO prof FROM public.profiles WHERE id = NEW.user_id;

    IF s.min_grade IS NOT NULL AND s.min_grade > 0 THEN
      IF prof.average_grade IS NULL THEN
        RAISE EXCEPTION 'Add your average grade to your profile before applying to % (minimum: %)', s.name, s.min_grade;
      END IF;
      IF prof.average_grade < s.min_grade THEN
        RAISE EXCEPTION 'Your average grade (%) is below the % required for %', prof.average_grade, s.min_grade, s.name;
      END IF;
    END IF;
    IF s.year_levels IS NOT NULL AND cardinality(s.year_levels) > 0
       AND (prof.year_level IS NULL OR NOT (prof.year_level = ANY (s.year_levels))) THEN
      RAISE EXCEPTION '% is open to % students only', s.name, array_to_string(s.year_levels, ', ');
    END IF;
    IF btrim(COALESCE(s.municipality, '')) <> ''
       AND lower(btrim(COALESCE(prof.municipality, ''))) <> lower(btrim(s.municipality)) THEN
      RAISE EXCEPTION '% is for residents of % only', s.name, s.municipality;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 5. Approving: award the program amount and respect the budget ──
CREATE OR REPLACE FUNCTION public.apply_scholarship_award()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.scholarships%ROWTYPE;
  committed NUMERIC;
BEGIN
  IF NEW.status <> 'Approved' OR OLD.status = 'Approved' THEN RETURN NEW; END IF;

  SELECT * INTO s FROM public.scholarships WHERE id = NEW.scholarship_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.amount_approved IS NULL AND COALESCE(s.amount, 0) > 0 THEN
    NEW.amount_approved := s.amount;
  END IF;

  IF COALESCE(s.total_budget, 0) > 0 THEN
    committed := public.scholarship_committed(s.id);   -- this application isn't Approved yet, so it isn't counted
    IF committed + COALESCE(NEW.amount_approved, 0) > s.total_budget THEN
      RAISE EXCEPTION 'Approving this would exceed the budget for % (% of % already committed)', s.name, committed, s.total_budget;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_apply_scholarship_award ON public.applications;
CREATE TRIGGER tr_apply_scholarship_award
  BEFORE UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.apply_scholarship_award();

-- ── 6. Public listing: availability without exposing the budget ──
CREATE OR REPLACE FUNCTION public.scholarships_public()
RETURNS TABLE (
  id UUID, name TEXT, description TEXT, amount NUMERIC, slots INTEGER, slots_left INTEGER,
  deadline DATE, open_date DATE, eligibility TEXT, min_grade NUMERIC, year_levels TEXT[],
  municipality TEXT, created_at TIMESTAMPTZ, availability TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.name, s.description, s.amount, s.slots,
         CASE WHEN s.slots > 0 THEN GREATEST(s.slots - a.cnt, 0) END,
         s.deadline, s.open_date, s.eligibility, s.min_grade, s.year_levels, s.municipality, s.created_at,
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

-- The public (signed-out) role no longer reads the budget column directly.
REVOKE SELECT ON public.scholarships FROM anon;
GRANT SELECT (id, name, description, amount, slots, is_active, deadline, eligibility, created_at,
              open_date, min_grade, year_levels, municipality)
  ON public.scholarships TO anon;

NOTIFY pgrst, 'reload schema';
