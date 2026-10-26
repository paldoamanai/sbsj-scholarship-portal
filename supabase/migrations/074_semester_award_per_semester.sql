-- A semester program's award is per semester (run after 073).
--
-- Until now a semester program's award was the yearly total, half paid in each semester. Now the award
-- (scholarships.amount, and applications.amount_approved) is what each semester pays, so a ₱2,500 award
-- releases ₱2,500 in the 1st Semester and ₱2,500 in the 2nd: ₱5,000 for the year. Monthly, yearly and
-- one-time programs are unchanged.
--
--   * Payments: an application's payments can't add up to more than its award for the year (twice the
--     award for a semester program).
--   * Budget: a semester scholar commits twice the award against the program's budget.
--   * Disbursement status: a semester award is 'Disbursed' once both semesters are paid (or the year's total is).
--
-- Payments already made keep their amounts. Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

-- ── 1. All an award pays in a year ──
CREATE OR REPLACE FUNCTION public.yearly_award(_award NUMERIC, _schedule TEXT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(_award, 0) * CASE WHEN _schedule = 'semester' THEN 2 ELSE 1 END;
$$;

-- ── 2. Money committed to a program (055, per semester ×2) ──
CREATE OR REPLACE FUNCTION public.scholarship_committed(_id UUID, _ay TEXT)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(public.yearly_award(COALESCE(a.amount_approved, s.amount, 0), s.release_schedule)), 0)
    FROM public.applications a
    JOIN public.scholarships s ON s.id = a.scholarship_id
   WHERE a.scholarship_id = _id AND a.status = 'Approved' AND a.academic_year IS NOT DISTINCT FROM _ay;
$$;

-- ── 3. Budget check on approval (031 + 055, per semester ×2) ──
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
  -- Runs on entering Approved, and again on any later edit to amount_approved while still Approved.
  IF NEW.status <> 'Approved'
     OR (OLD.status = 'Approved' AND NEW.amount_approved IS NOT DISTINCT FROM OLD.amount_approved) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO s FROM public.scholarships WHERE id = NEW.scholarship_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF OLD.status <> 'Approved' AND NEW.amount_approved IS NULL AND COALESCE(s.amount, 0) > 0 THEN
    NEW.amount_approved := s.amount;
  END IF;

  IF COALESCE(s.total_budget, 0) > 0 THEN
    -- Exclude this row itself: on a fresh approval it isn't in the table as Approved yet; on a later
    -- edit it already is, and would otherwise be double-counted against its own new amount.
    committed := public.scholarship_committed(s.id, NEW.academic_year)
      - CASE WHEN OLD.status = 'Approved' THEN public.yearly_award(COALESCE(OLD.amount_approved, s.amount, 0), s.release_schedule) ELSE 0 END;
    IF committed + public.yearly_award(NEW.amount_approved, s.release_schedule) > s.total_budget THEN
      RAISE EXCEPTION 'This would exceed the budget for % (% of % already committed)', s.name, committed, s.total_budget;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 4. Payment rules (069, per semester ×2) ──
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
  one_time BOOLEAN;
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
  -- A one-time grant is paid the same way as a once-a-year award: one 'Yearly' payment.
  -- A semester program's award is per semester: the year pays it twice (074).
  IF sched = 'semester' THEN award := award * 2; END IF;
  one_time := sched = 'one_time';
  IF one_time THEN sched := 'yearly'; END IF;

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
        RAISE EXCEPTION '%', CASE WHEN one_time THEN 'This program pays once' ELSE 'This program pays once a year' END;
      END IF;
      IF EXISTS (SELECT 1 FROM public.payments p
                  WHERE p.application_id = NEW.application_id AND p.term = NEW.term
                    AND p.status <> 'Cancelled' AND p.id <> NEW.id) THEN
        RAISE EXCEPTION 'This scholar already has a % payment',
          CASE WHEN one_time THEN 'one-time' WHEN NEW.term = 'Yearly' THEN 'yearly' ELSE NEW.term END;
      END IF;
    END IF;
  END IF;

  IF award > 0 AND NEW.status <> 'Cancelled'
     AND (TG_OP = 'INSERT' OR NEW.amount IS DISTINCT FROM OLD.amount OR (OLD.status = 'Cancelled')) THEN
    SELECT COALESCE(SUM(p.amount), 0) INTO paid FROM public.payments p
     WHERE p.application_id = NEW.application_id AND p.status <> 'Cancelled' AND p.id <> NEW.id;
    IF paid + NEW.amount > award THEN
      RAISE EXCEPTION 'This would bring payments to ₱% of the ₱% award for the year (₱% left)',
        to_char(paid + NEW.amount, 'FM999,999,999,990.00'), to_char(award, 'FM999,999,999,990.00'),
        to_char(GREATEST(award - paid, 0), 'FM999,999,999,990.00');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 5. Application disbursement status (064, per semester ×2) ──
CREATE OR REPLACE FUNCTION public.application_disbursement_status(_app UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH a AS (
    SELECT ap.id, COALESCE(s.release_schedule, 'yearly') AS sched, COALESCE(s.release_months, 10) AS months,
           public.yearly_award(COALESCE(ap.amount_approved, s.amount, 0), s.release_schedule) AS award
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

COMMIT;

NOTIFY pgrst, 'reload schema';
