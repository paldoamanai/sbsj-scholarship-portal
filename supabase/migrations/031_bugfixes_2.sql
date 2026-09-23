-- More bug fixes, found by an independent multi-agent review of the whole branch. Run after 030.
-- Safe to re-run.
--
--   1. apply_scholarship_award() only checked the budget on the transition INTO 'Approved'. Editing
--      amount_approved on an application that is already Approved (the admin PUT route allows this on
--      its own, with no other bound) skipped the check entirely, silently letting the amount go over
--      the program's total_budget.
--   2. notify_application_decision() only announced a reopen for Rejected -> Pending. A Waitlisted ->
--      Pending change (the database allows it; today's UI doesn't offer the button, but a future admin
--      feature or a direct update could still make it) sent no notification.
--   3. facebook_url has client-side format validation (must be blank or start with http(s)://) but no
--      matching database check, unlike every other setting — a write that skips the client (SQL editor,
--      a future API route, a scripted RPC) could store an arbitrary value that is later rendered as an
--      href on the public site.

-- ── 1. Re-check the budget whenever amount_approved changes, not just on entering Approved ──
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
    committed := public.scholarship_committed(s.id)
      - CASE WHEN OLD.status = 'Approved' THEN COALESCE(OLD.amount_approved, s.amount, 0) ELSE 0 END;
    IF committed + COALESCE(NEW.amount_approved, 0) > s.total_budget THEN
      RAISE EXCEPTION 'This would exceed the budget for % (% of % already committed)', s.name, committed, s.total_budget;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_apply_scholarship_award ON public.applications;
CREATE TRIGGER tr_apply_scholarship_award
  BEFORE UPDATE OF status, amount_approved ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.apply_scholarship_award();

-- ── 2. Notify on any reopen back to Pending, not just from Rejected ──
CREATE OR REPLACE FUNCTION public.notify_application_decision()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sch TEXT;
  remarks TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  SELECT name INTO sch FROM public.scholarships WHERE id = NEW.scholarship_id;
  sch := COALESCE(sch, 'the scholarship');
  remarks := CASE WHEN COALESCE(btrim(NEW.notes), '') <> '' THEN ' Remarks: ' || NEW.notes ELSE '' END;

  IF NEW.status = 'Approved' THEN
    PERFORM public.notify(NEW.user_id, 'Application Approved', 'Your application for ' || sch || ' has been approved.' || remarks,
      'success', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Rejected' THEN
    PERFORM public.notify(NEW.user_id, 'Application Rejected', 'Your application for ' || sch || ' was not approved this time.' || remarks,
      'error', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Waitlisted' THEN
    PERFORM public.notify(NEW.user_id, 'Application Waitlisted', 'Your application for ' || sch || ' has been placed on the waitlist. We will notify you if a slot opens.' || remarks,
      'warning', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Pending' AND OLD.status IN ('Rejected', 'Waitlisted') THEN
    PERFORM public.notify(NEW.user_id, 'Application Reopened', 'Your application for ' || sch || ' has been reopened for review.' || remarks,
      'info', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Withdrawn' THEN
    PERFORM public.notify(NEW.user_id, 'Application Withdrawn', 'You withdrew your application for ' || sch || '. Your documents are kept, and you can apply again while applications are open.',
      'info', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

-- ── 3. facebook_url: same rule as the client (blank, or a full http(s) link) ──
CREATE OR REPLACE FUNCTION public.validate_system_setting_ext()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  n NUMERIC;
  s TEXT;
BEGIN
  CASE NEW.key
    WHEN 'required_documents' THEN
      IF jsonb_typeof(NEW.value) <> 'array' OR jsonb_array_length(NEW.value) > 12 THEN
        RAISE EXCEPTION 'Required documents must be a list of at most 12 items';
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(NEW.value) e
        WHERE jsonb_typeof(e) <> 'string' OR btrim(e #>> '{}') = '' OR length(e #>> '{}') > 60
      ) THEN
        RAISE EXCEPTION 'Each required document needs a name of up to 60 characters';
      END IF;
      IF (SELECT COUNT(DISTINCT lower(btrim(x))) FROM jsonb_array_elements_text(NEW.value) x) <> jsonb_array_length(NEW.value) THEN
        RAISE EXCEPTION 'Required documents must not repeat';
      END IF;
    WHEN 'default_payment_method' THEN
      IF (NEW.value #>> '{}') NOT IN ('Cash', 'Cheque') THEN
        RAISE EXCEPTION 'Default payment method must be Cash or Cheque';
      END IF;
    WHEN 'default_payment_lead_days' THEN
      IF jsonb_typeof(NEW.value) <> 'number' THEN RAISE EXCEPTION 'Lead days must be a number'; END IF;
      n := (NEW.value #>> '{}')::numeric;
      IF n < 0 OR n > 365 OR n <> trunc(n) THEN RAISE EXCEPTION 'Lead days must be a whole number from 0 to 365'; END IF;
    WHEN 'renewal_enabled' THEN
      IF jsonb_typeof(NEW.value) <> 'boolean' THEN RAISE EXCEPTION 'renewal_enabled must be on or off'; END IF;
    WHEN 'renewal_min_grade' THEN
      IF jsonb_typeof(NEW.value) <> 'number' THEN RAISE EXCEPTION 'Renewal grade must be a number'; END IF;
      n := (NEW.value #>> '{}')::numeric;
      IF n < 0 OR n > 100 THEN RAISE EXCEPTION 'Renewal grade must be between 0 and 100'; END IF;
    WHEN 'max_renewals' THEN
      IF jsonb_typeof(NEW.value) <> 'number' THEN RAISE EXCEPTION 'Max renewals must be a number'; END IF;
      n := (NEW.value #>> '{}')::numeric;
      IF n < 0 OR n > 10 OR n <> trunc(n) THEN RAISE EXCEPTION 'Max renewals must be a whole number from 0 to 10'; END IF;
    WHEN 'facebook_url' THEN
      IF jsonb_typeof(NEW.value) <> 'string' THEN RAISE EXCEPTION 'Facebook link must be text'; END IF;
      s := btrim(NEW.value #>> '{}');
      IF s <> '' AND s !~* '^https?://\S+$' THEN
        RAISE EXCEPTION 'Enter a full link starting with https://';
      END IF;
      IF length(s) > 300 THEN RAISE EXCEPTION 'Facebook link is too long'; END IF;
    ELSE
      NULL;
  END CASE;
  RETURN NEW;
END;
$$;

-- ── 4. A student can no longer blank out their own student ID once it is set ──
-- government_id was removed from the app, so student_id_number is now the sole input to the
-- duplicate-scholar check in scholar_verifications. guard_profile_update() already locks this field
-- entirely once the student has applied; this closes the earlier window (before ever applying) where
-- they could clear it via an ordinary profile edit. Setting it for the first time is still allowed.
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR auth.uid() IS NULL OR auth.uid() <> OLD.id THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR (NEW.email IS DISTINCT FROM OLD.email AND OLD.email IS NOT NULL)
     OR NEW.grade_verified_at IS DISTINCT FROM OLD.grade_verified_at
     OR NEW.grade_term IS DISTINCT FROM OLD.grade_term THEN
    RAISE EXCEPTION 'That part of your profile can only be changed by the office';
  END IF;

  IF NEW.average_grade IS DISTINCT FROM OLD.average_grade AND OLD.average_grade IS NOT NULL THEN
    RAISE EXCEPTION 'Your average grade is verified by the office. Submit a grade update with your grade report.';
  END IF;

  IF (NEW.student_id_number IS DISTINCT FROM OLD.student_id_number OR NEW.government_id IS DISTINCT FROM OLD.government_id)
     AND EXISTS (SELECT 1 FROM public.applications WHERE user_id = OLD.id AND status <> 'Withdrawn') THEN
    RAISE EXCEPTION 'Your ID numbers are locked once you have applied. Contact the office to correct them.';
  END IF;
  IF OLD.student_id_number IS NOT NULL AND NEW.student_id_number IS NULL THEN
    RAISE EXCEPTION 'Your student ID number can only be cleared by the office';
  END IF;

  IF public.documents_locked(OLD.id)
     AND ROW(NEW.first_name, NEW.middle_name, NEW.last_name, NEW.sex, NEW.dob, NEW.school_name, NEW.course, NEW.year_level)
         IS DISTINCT FROM
         ROW(OLD.first_name, OLD.middle_name, OLD.last_name, OLD.sex, OLD.dob, OLD.school_name, OLD.course, OLD.year_level) THEN
    RAISE EXCEPTION 'Your name, birth date, school, course and year level are locked while your scholarship is active. Contact the office to change them.';
  END IF;

  IF NEW.phone IS DISTINCT FROM OLD.phone AND btrim(COALESCE(NEW.phone, '')) <> '' AND NEW.phone !~ '^(09|\+639)[0-9]{9}$' THEN
    RAISE EXCEPTION 'Use a valid PH mobile number (09XXXXXXXXX or +639XXXXXXXXX)';
  END IF;
  IF NEW.guardian_phone IS DISTINCT FROM OLD.guardian_phone AND btrim(COALESCE(NEW.guardian_phone, '')) <> '' AND NEW.guardian_phone !~ '^(09|\+639)[0-9]{9}$' THEN
    RAISE EXCEPTION 'Use a valid PH mobile number for your guardian (09XXXXXXXXX or +639XXXXXXXXX)';
  END IF;
  IF NEW.zip_code IS DISTINCT FROM OLD.zip_code AND btrim(COALESCE(NEW.zip_code, '')) <> '' AND NEW.zip_code !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION 'ZIP code must be 4 digits';
  END IF;
  IF NEW.year_level IS DISTINCT FROM OLD.year_level AND NEW.year_level IS NOT NULL
     AND NEW.year_level NOT IN ('Grade 11', 'Grade 12', '1st Year', '2nd Year', '3rd Year', '4th Year') THEN
    RAISE EXCEPTION 'Choose a year level from the list';
  END IF;
  IF (NEW.first_name IS DISTINCT FROM OLD.first_name AND btrim(COALESCE(NEW.first_name, '')) = '')
     OR (NEW.last_name IS DISTINCT FROM OLD.last_name AND btrim(COALESCE(NEW.last_name, '')) = '') THEN
    RAISE EXCEPTION 'First and last name cannot be blank';
  END IF;
  IF NEW.dob IS DISTINCT FROM OLD.dob AND NEW.dob IS NOT NULL AND (NEW.dob > CURRENT_DATE OR NEW.dob < DATE '1900-01-01') THEN
    RAISE EXCEPTION 'Enter a valid date of birth';
  END IF;
  IF NEW.profile_picture_url IS DISTINCT FROM OLD.profile_picture_url AND NEW.profile_picture_url IS NOT NULL
     AND NEW.profile_picture_url !~ '^https?://'
     AND split_part(NEW.profile_picture_url, '/', 1) <> OLD.id::text THEN
    RAISE EXCEPTION 'Invalid photo location';
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
