-- One-time release schedule.
--
--   * scholarships.release_schedule: 'one_time' joins 'yearly', 'semester' and 'monthly'. The whole award
--     is paid in one payment, recorded under the 'Yearly' term like a once-a-year program.
--   * A one-time grant can't be renewed: a student who was approved for the program once (in any year)
--     can't apply to it again, and a second application can't be approved.
--
-- Independent of 068. Run in the Supabase SQL Editor after 067. Safe to re-run.

BEGIN;

-- ── 1. Allowed schedules ──
ALTER TABLE public.scholarships DROP CONSTRAINT IF EXISTS scholarships_release_schedule_check;
ALTER TABLE public.scholarships ADD CONSTRAINT scholarships_release_schedule_check
  CHECK (release_schedule IN ('one_time', 'yearly', 'semester', 'monthly'));

-- ── 2. Payment rules (064, with one-time paying like yearly) ──
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
      RAISE EXCEPTION 'This would bring payments to ₱% of the ₱% award (₱% left)',
        to_char(paid + NEW.amount, 'FM999,999,999,990.00'), to_char(award, 'FM999,999,999,990.00'),
        to_char(GREATEST(award - paid, 0), 'FM999,999,999,990.00');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 3. A one-time grant is received once ──
CREATE OR REPLACE FUNCTION public.enforce_one_time_program()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.status <> 'Approved' OR OLD.status = 'Approved') THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.scholarships WHERE id = NEW.scholarship_id AND release_schedule = 'one_time') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.applications a
              WHERE a.user_id = NEW.user_id AND a.scholarship_id = NEW.scholarship_id
                AND a.status = 'Approved' AND a.id <> NEW.id) THEN
    RAISE EXCEPTION '%', CASE WHEN TG_OP = 'INSERT'
      THEN 'This is a one-time grant and you have already received it'
      ELSE 'This student already received this one-time grant, so it can''t be approved again' END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_one_time_program() FROM PUBLIC;

DROP TRIGGER IF EXISTS tr_enforce_one_time_program ON public.applications;
CREATE TRIGGER tr_enforce_one_time_program
  BEFORE INSERT OR UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_one_time_program();

COMMIT;

NOTIFY pgrst, 'reload schema';
