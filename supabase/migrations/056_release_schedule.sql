-- Programs pay out either once a year or per semester (1st and 2nd; Summer is never paid).
--
--   * scholarships.release_schedule: 'yearly' (default, how every program worked so far) or 'semester'.
--     The award (amount / amount_approved) is always the yearly total; a per-semester program pays
--     half of it each semester.
--   * payments.term: 'Yearly', '1st Semester' or '2nd Semester', and payments.academic_year (the
--     application's). One live (not cancelled) payment per application per term, and the payments of an
--     application can't add up to more than its award. Payments made before this migration keep a NULL
--     term and still count toward the award.
--   * applications.disbursement_status: a per-semester award is 'Partially Disbursed' after the 1st
--     semester and 'Disbursed' once both semesters are released.
--   * scholarships_public() includes release_schedule, so students see how a program pays.
--
-- The 2nd-semester grade check is a warning in the admin screens, not a rule here: the office can
-- release a payment anyway. Run after 055. Safe to re-run.

BEGIN;

-- ── 1. Columns ──
ALTER TABLE public.scholarships ADD COLUMN IF NOT EXISTS release_schedule TEXT NOT NULL DEFAULT 'yearly';
ALTER TABLE public.scholarships DROP CONSTRAINT IF EXISTS scholarships_release_schedule_check;
ALTER TABLE public.scholarships ADD CONSTRAINT scholarships_release_schedule_check CHECK (release_schedule IN ('yearly', 'semester'));

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS term TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS academic_year TEXT;
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_term_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_term_check CHECK (term IS NULL OR term IN ('Yearly', '1st Semester', '2nd Semester'));

-- Backfill only: disbursed payments are locked (guard_payments), and this isn't a change anyone made,
-- so no trigger should see it.
ALTER TABLE public.payments DISABLE TRIGGER USER;
UPDATE public.payments p SET academic_year = a.academic_year
  FROM public.applications a
 WHERE a.id = p.application_id AND p.academic_year IS NULL;
ALTER TABLE public.payments ENABLE TRIGGER USER;

ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_disbursement_status_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_disbursement_status_check
  CHECK (disbursement_status IN ('Pending', 'Processing', 'Partially Disbursed', 'Disbursed'));

CREATE UNIQUE INDEX IF NOT EXISTS payments_one_per_term
  ON public.payments (application_id, term) WHERE status <> 'Cancelled' AND term IS NOT NULL;

-- ── 2. Payment rules: term, one per term, not more than the award ──
CREATE OR REPLACE FUNCTION public.enforce_payment_term()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app public.applications%ROWTYPE;
  sched TEXT;
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
  SELECT COALESCE(s.release_schedule, 'yearly'), COALESCE(app.amount_approved, s.amount, 0)
    INTO sched, award
    FROM public.scholarships s WHERE s.id = app.scholarship_id;
  sched := COALESCE(sched, 'yearly');
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

DROP TRIGGER IF EXISTS tr_enforce_payment_term ON public.payments;
CREATE TRIGGER tr_enforce_payment_term
  BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_term();

-- ── 3. Application disbursement status ──
CREATE OR REPLACE FUNCTION public.application_disbursement_status(_app UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH a AS (
    SELECT ap.id, COALESCE(s.release_schedule, 'yearly') AS sched, COALESCE(ap.amount_approved, s.amount, 0) AS award
      FROM public.applications ap LEFT JOIN public.scholarships s ON s.id = ap.scholarship_id
     WHERE ap.id = _app
  ), p AS (
    SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'Disbursed'), 0) AS paid,
           COUNT(DISTINCT term) FILTER (WHERE status = 'Disbursed' AND term IN ('1st Semester', '2nd Semester')) AS sems,
           bool_or(status = 'Disbursed') AS any_paid,
           bool_or(status = 'Processing') AS any_processing
      FROM public.payments WHERE application_id = _app
  )
  SELECT CASE
    WHEN NOT COALESCE(p.any_paid, false) THEN CASE WHEN p.any_processing THEN 'Processing' ELSE 'Pending' END
    WHEN a.sched <> 'semester' OR p.sems >= 2 OR (a.award > 0 AND p.paid >= a.award) THEN 'Disbursed'
    ELSE 'Partially Disbursed'
  END
  FROM a, p;
$$;

CREATE OR REPLACE FUNCTION public.sync_application_disbursement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  aid UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN aid := OLD.application_id; ELSE aid := NEW.application_id; END IF;
  IF aid IS NULL THEN RETURN NULL; END IF;
  UPDATE public.applications SET disbursement_status = public.application_disbursement_status(aid) WHERE id = aid;
  RETURN NULL;
END;
$$;

-- ── 4. Public program list: how the program pays ──
DROP FUNCTION IF EXISTS public.scholarships_public();
CREATE FUNCTION public.scholarships_public()
RETURNS TABLE (
  id UUID, name TEXT, description TEXT, amount NUMERIC, slots INTEGER, slots_left INTEGER,
  deadline DATE, open_date DATE, eligibility TEXT, min_grade NUMERIC, year_levels TEXT[],
  municipality TEXT, barangays TEXT[], created_at TIMESTAMPTZ, availability TEXT, release_schedule TEXT
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
         s.release_schedule
    FROM public.scholarships s
   CROSS JOIN LATERAL (
     SELECT COUNT(*)::int AS cnt FROM public.applications ap
      WHERE ap.scholarship_id = s.id AND ap.status = 'Approved' AND ap.academic_year = public.current_academic_year()
   ) a
   WHERE s.is_active
   ORDER BY s.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.scholarships_public() TO anon, authenticated;
GRANT SELECT (release_schedule) ON public.scholarships TO anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
