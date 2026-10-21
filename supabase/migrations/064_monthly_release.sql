-- Monthly release schedule (run after 063).
--
--   * scholarships.release_schedule: 'monthly' joins 'yearly' and 'semester'. A monthly program splits
--     the award (still the yearly total) into equal releases over scholarships.release_months months
--     (1 to 12, 10 by default).
--   * payments.term: 'Month 1' to 'Month 12' for monthly programs, one live payment per month, never
--     past the program's number of months. The payments of an application still can't add up to more
--     than its award.
--   * applications.disbursement_status: a monthly award is 'Partially Disbursed' until every month is
--     released (or the whole award is).
--   * A program's schedule and number of months can't change while this academic year has payments
--     for it: those payments would no longer fit.
--   * scholarships_public() includes release_months.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

-- ── 1. Columns ──
ALTER TABLE public.scholarships ADD COLUMN IF NOT EXISTS release_months INTEGER NOT NULL DEFAULT 10;
ALTER TABLE public.scholarships DROP CONSTRAINT IF EXISTS scholarships_release_months_check;
ALTER TABLE public.scholarships ADD CONSTRAINT scholarships_release_months_check CHECK (release_months BETWEEN 1 AND 12);
ALTER TABLE public.scholarships DROP CONSTRAINT IF EXISTS scholarships_release_schedule_check;
ALTER TABLE public.scholarships ADD CONSTRAINT scholarships_release_schedule_check CHECK (release_schedule IN ('yearly', 'semester', 'monthly'));

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_term_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_term_check
  CHECK (term IS NULL OR term IN ('Yearly', '1st Semester', '2nd Semester') OR term ~ '^Month ([1-9]|1[0-2])$');

-- ── 2. Payment rules (056, plus monthly) ──
CREATE OR REPLACE FUNCTION public.enforce_payment_term()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app public.applications%ROWTYPE;
  sched TEXT;
  months INTEGER;
  award NUMERIC;
  paid NUMERIC;
  sem TEXT;
BEGIN
  IF NEW.application_id IS NULL THEN RETURN NEW; END IF;
  -- Disbursed payments are locked by guard_payments().
  IF TG_OP = 'UPDATE' AND OLD.status = 'Disbursed' THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' AND auth.uid() = OLD.user_id
     AND (NEW.term IS DISTINCT FROM OLD.term OR NEW.academic_year IS DISTINCT FROM OLD.academic_year) THEN
    RAISE EXCEPTION 'Only the scholarship office can change which period a payment is for';
  END IF;

  SELECT * INTO app FROM public.applications WHERE id = NEW.application_id;
  SELECT COALESCE(s.release_schedule, 'yearly'), COALESCE(s.release_months, 10), COALESCE(app.amount_approved, s.amount, 0)
    INTO sched, months, award
    FROM public.scholarships s WHERE s.id = app.scholarship_id;
  sched := COALESCE(sched, 'yearly');
  months := COALESCE(months, 10);
  award := COALESCE(award, app.amount_approved, 0);

  IF TG_OP = 'INSERT' THEN
    NEW.academic_year := app.academic_year;
    IF NEW.term IS NULL THEN
      IF sched = 'semester' THEN
        sem := public.setting_text('current_semester', '');
        IF sem NOT IN ('1st Semester', '2nd Semester') THEN
          RAISE EXCEPTION 'Choose 1st or 2nd Semester for this payment';
        END IF;
        NEW.term := sem;
      ELSIF sched = 'monthly' THEN
        RAISE EXCEPTION 'Choose which month this payment is for';
      ELSE
        NEW.term := 'Yearly';
      END IF;
    END IF;
  ELSIF NEW.term IS NULL AND OLD.term IS NOT NULL THEN
    RAISE EXCEPTION 'Choose which period this payment is for';
  END IF;

  IF NEW.status <> 'Cancelled' AND (TG_OP = 'INSERT' OR NEW.term IS DISTINCT FROM OLD.term OR NEW.status IS DISTINCT FROM OLD.status) THEN
    IF NEW.term IS NOT NULL THEN
      IF sched = 'semester' AND NEW.term NOT IN ('1st Semester', '2nd Semester') THEN
        RAISE EXCEPTION 'This program pays per semester: choose 1st or 2nd Semester';
      END IF;
      IF sched = 'monthly' AND (NEW.term !~ '^Month ([1-9]|1[0-2])$' OR substring(NEW.term FROM 7)::int > months) THEN
        RAISE EXCEPTION 'This program pays monthly: choose a month from Month 1 to Month %', months;
      END IF;
      IF sched = 'yearly' AND NEW.term <> 'Yearly' THEN
        RAISE EXCEPTION 'This program pays once a year';
      END IF;
      IF EXISTS (SELECT 1 FROM public.payments p
                  WHERE p.application_id = NEW.application_id AND p.term = NEW.term
                    AND p.status <> 'Cancelled' AND p.id <> NEW.id) THEN
        RAISE EXCEPTION 'This scholar already has a % payment', CASE WHEN NEW.term = 'Yearly' THEN 'yearly' ELSE NEW.term END;
      END IF;
    END IF;
  END IF;

  IF award > 0 AND NEW.status <> 'Cancelled'
     AND (TG_OP = 'INSERT' OR NEW.amount IS DISTINCT FROM OLD.amount OR (OLD.status = 'Cancelled')) THEN
    SELECT COALESCE(SUM(p.amount), 0) INTO paid FROM public.payments p
     WHERE p.application_id = NEW.application_id AND p.status <> 'Cancelled' AND p.id <> NEW.id;
    IF paid + NEW.amount > award THEN
      RAISE EXCEPTION 'This would bring payments to ₱% of the ₱% award (₱% left)',
        to_char(paid + NEW.amount, 'FM999,999,999,990.00'), to_char(award, 'FM999,999,999,990.00'),
        to_char(GREATEST(award - paid, 0), 'FM999,999,999,990.00');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 3. Application disbursement status (056, plus monthly) ──
CREATE OR REPLACE FUNCTION public.application_disbursement_status(_app UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH a AS (
    SELECT ap.id, COALESCE(s.release_schedule, 'yearly') AS sched, COALESCE(s.release_months, 10) AS months,
           COALESCE(ap.amount_approved, s.amount, 0) AS award
      FROM public.applications ap LEFT JOIN public.scholarships s ON s.id = ap.scholarship_id
     WHERE ap.id = _app
  ), p AS (
    SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'Disbursed'), 0) AS paid,
           COUNT(DISTINCT term) FILTER (WHERE status = 'Disbursed' AND term IN ('1st Semester', '2nd Semester')) AS sems,
           COUNT(DISTINCT term) FILTER (WHERE status = 'Disbursed' AND term LIKE 'Month %') AS mons,
           bool_or(status = 'Disbursed') AS any_paid,
           bool_or(status = 'Processing') AS any_processing
      FROM public.payments WHERE application_id = _app
  )
  SELECT CASE
    WHEN NOT COALESCE(p.any_paid, false) THEN CASE WHEN p.any_processing THEN 'Processing' ELSE 'Pending' END
    WHEN a.award > 0 AND p.paid >= a.award THEN 'Disbursed'
    WHEN a.sched = 'semester' THEN CASE WHEN p.sems >= 2 THEN 'Disbursed' ELSE 'Partially Disbursed' END
    WHEN a.sched = 'monthly' THEN CASE WHEN p.mons >= a.months THEN 'Disbursed' ELSE 'Partially Disbursed' END
    ELSE 'Disbursed'
  END
  FROM a, p;
$$;

-- ── 4. A program's schedule stays put while this year has payments for it ──
CREATE OR REPLACE FUNCTION public.guard_release_schedule()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.release_schedule IS NOT DISTINCT FROM OLD.release_schedule
     AND (NEW.release_schedule <> 'monthly' OR NEW.release_months IS NOT DISTINCT FROM OLD.release_months) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.payments p JOIN public.applications a ON a.id = p.application_id
     WHERE a.scholarship_id = NEW.id AND p.status <> 'Cancelled'
       AND a.academic_year = public.current_academic_year()
  ) THEN
    RAISE EXCEPTION 'This program already has payments this academic year, so its release schedule can''t change until next year';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_guard_release_schedule ON public.scholarships;
CREATE TRIGGER tr_guard_release_schedule
  BEFORE UPDATE ON public.scholarships
  FOR EACH ROW EXECUTE FUNCTION public.guard_release_schedule();

-- ── 5. Public program list: how many months a monthly program pays ──
DROP FUNCTION IF EXISTS public.scholarships_public();
CREATE FUNCTION public.scholarships_public()
RETURNS TABLE (
  id UUID, name TEXT, description TEXT, amount NUMERIC, slots INTEGER, slots_left INTEGER,
  deadline DATE, open_date DATE, eligibility TEXT, min_grade NUMERIC, year_levels TEXT[],
  municipality TEXT, barangays TEXT[], created_at TIMESTAMPTZ, availability TEXT, release_schedule TEXT,
  release_months INTEGER
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
         s.release_schedule, s.release_months
    FROM public.scholarships s
   CROSS JOIN LATERAL (
     SELECT COUNT(*)::int AS cnt FROM public.applications ap
      WHERE ap.scholarship_id = s.id AND ap.status = 'Approved' AND ap.academic_year = public.current_academic_year()
   ) a
   WHERE s.is_active
   ORDER BY s.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.scholarships_public() TO anon, authenticated;
GRANT SELECT (release_months) ON public.scholarships TO anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
