-- Student application hardening.
--   * students could rewrite their own application row (notes, amount, disbursement status): now locked down
--   * a real "Withdrawn" status instead of deleting (there was never a DELETE policy, so "Cancel" did nothing)
--   * the application now carries a statement, household details, a certification and a snapshot of the
--     student's school details at the time of applying
--   * required documents are enforced on submit; documents are linked to the application they were filed with
-- Run after 020. Safe to re-run.

-- ── 1. Withdrawn status + new columns ──
ALTER TABLE public.applications DROP CONSTRAINT IF EXISTS applications_status_check;
ALTER TABLE public.applications ADD CONSTRAINT applications_status_check
  CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Waitlisted', 'Withdrawn'));

ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS statement TEXT;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS household_income NUMERIC;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS household_size INTEGER;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS certified_at TIMESTAMPTZ;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS school_name TEXT;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS course TEXT;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS year_level TEXT;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS average_grade NUMERIC;

-- ── 2. Students may only edit/withdraw their own open applications ──
DROP POLICY IF EXISTS "Users can update own pending applications" ON public.applications;
DROP POLICY IF EXISTS "Users can update own open applications" ON public.applications;
CREATE POLICY "Users can update own open applications" ON public.applications
  FOR UPDATE
  USING (auth.uid() = user_id AND status IN ('Pending', 'Waitlisted'))
  WITH CHECK (auth.uid() = user_id AND status IN ('Pending', 'Waitlisted', 'Withdrawn'));

-- ── 3. Column guard: an owner can change only their statement/household details, or withdraw ──
-- Updates by anyone other than the owner (admins, via their own RLS policy) and updates fired from
-- another trigger (payments -> disbursement sync) are not restricted here.
CREATE OR REPLACE FUNCTION public.protect_application_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR auth.uid() IS NULL OR auth.uid() <> OLD.user_id THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.scholarship_id IS DISTINCT FROM OLD.scholarship_id
     OR NEW.disbursement_status IS DISTINCT FROM OLD.disbursement_status
     OR NEW.amount_approved IS DISTINCT FROM OLD.amount_approved
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.academic_year IS DISTINCT FROM OLD.academic_year
     OR NEW.semester IS DISTINCT FROM OLD.semester
     OR NEW.is_renewal IS DISTINCT FROM OLD.is_renewal
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.certified_at IS DISTINCT FROM OLD.certified_at
     OR NEW.school_name IS DISTINCT FROM OLD.school_name
     OR NEW.course IS DISTINCT FROM OLD.course
     OR NEW.year_level IS DISTINCT FROM OLD.year_level
     OR NEW.average_grade IS DISTINCT FROM OLD.average_grade THEN
    RAISE EXCEPTION 'You can only edit your statement and household details on your own application';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (NEW.status = 'Withdrawn' AND OLD.status IN ('Pending', 'Waitlisted')) THEN
    RAISE EXCEPTION 'Only a pending or waitlisted application can be withdrawn';
  END IF;

  IF (NEW.statement IS DISTINCT FROM OLD.statement
      OR NEW.household_income IS DISTINCT FROM OLD.household_income
      OR NEW.household_size IS DISTINCT FROM OLD.household_size) THEN
    IF OLD.status <> 'Pending' THEN
      RAISE EXCEPTION 'Only a pending application can be edited';
    END IF;
    IF char_length(btrim(COALESCE(NEW.statement, ''))) < 50 OR char_length(NEW.statement) > 2000 THEN
      RAISE EXCEPTION 'Your statement must be between 50 and 2000 characters';
    END IF;
    IF NEW.household_income IS NOT NULL AND NEW.household_income < 0 THEN
      RAISE EXCEPTION 'Household income cannot be negative';
    END IF;
    IF NEW.household_size IS NOT NULL AND (NEW.household_size < 1 OR NEW.household_size > 30) THEN
      RAISE EXCEPTION 'Household size must be between 1 and 30';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_protect_application_columns ON public.applications;
CREATE TRIGGER tr_protect_application_columns
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.protect_application_columns();

-- ── 4. Insert rules: withdrawn applications don't count, required documents, statement, snapshot ──
CREATE OR REPLACE FUNCTION public.enforce_application_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  open_d TEXT := public.setting_text('application_open_date', '');
  close_d TEXT := public.setting_text('application_close_date', '');
  min_grade NUMERIC := public.setting_number('min_grade_requirement', 0);
  max_apps INTEGER := public.setting_number('max_scholarships_per_student', 1)::integer;
  prior_approved INTEGER;
  year_count INTEGER;
  required_docs JSONB;
  missing TEXT;
  prof public.profiles%ROWTYPE;
BEGIN
  IF public.setting_bool('maintenance_mode', false) THEN
    RAISE EXCEPTION '%', public.setting_text('maintenance_message', 'The portal is temporarily unavailable for submissions.');
  END IF;
  IF NOT public.setting_bool('applications_open', true) THEN
    RAISE EXCEPTION 'Applications are currently closed';
  END IF;
  IF open_d <> '' AND CURRENT_DATE < open_d::date THEN
    RAISE EXCEPTION 'Applications open on %', to_char(open_d::date, 'FMMonth DD, YYYY');
  END IF;
  IF close_d <> '' AND CURRENT_DATE > close_d::date THEN
    RAISE EXCEPTION 'The application period ended on %', to_char(close_d::date, 'FMMonth DD, YYYY');
  END IF;

  -- Renewals: a student with an earlier approved application is renewing.
  -- prior_approved = renewals already used + 1, so allowing up to max_renewals means
  -- one original award plus max_renewals renewals.
  SELECT COUNT(*) INTO prior_approved FROM public.applications
   WHERE user_id = NEW.user_id AND status = 'Approved';
  IF prior_approved > 0 THEN
    IF NOT public.setting_bool('renewal_enabled', true) THEN
      RAISE EXCEPTION 'Scholarship renewals are not open right now';
    END IF;
    IF prior_approved > public.setting_number('max_renewals', 3) THEN
      RAISE EXCEPTION 'You have reached the maximum of % renewal(s)', public.setting_number('max_renewals', 3)::integer;
    END IF;
    min_grade := public.setting_number('renewal_min_grade', min_grade);
    NEW.is_renewal := true;
  END IF;

  SELECT * INTO prof FROM public.profiles WHERE id = NEW.user_id;

  IF min_grade > 0 THEN
    IF prof.average_grade IS NULL THEN
      RAISE EXCEPTION 'Add your average grade to your profile before applying (minimum required: %)', min_grade;
    END IF;
    IF prof.average_grade < min_grade THEN
      RAISE EXCEPTION 'Your average grade (%) is below the minimum of % required to apply', prof.average_grade, min_grade;
    END IF;
  END IF;

  -- A withdrawn application frees the slot again.
  SELECT COUNT(*) INTO year_count FROM public.applications
   WHERE user_id = NEW.user_id
     AND status <> 'Withdrawn'
     AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM now());
  IF year_count >= max_apps THEN
    RAISE EXCEPTION 'You have reached the limit of % application(s) for this year', max_apps;
  END IF;

  -- Checks for applications submitted by a signed-in student (not seed / service-role inserts).
  IF auth.uid() IS NOT NULL THEN
    IF char_length(btrim(COALESCE(NEW.statement, ''))) < 50 OR char_length(NEW.statement) > 2000 THEN
      RAISE EXCEPTION 'Your statement must be between 50 and 2000 characters';
    END IF;
    IF NEW.household_income IS NOT NULL AND NEW.household_income < 0 THEN
      RAISE EXCEPTION 'Household income cannot be negative';
    END IF;
    IF NEW.household_size IS NOT NULL AND (NEW.household_size < 1 OR NEW.household_size > 30) THEN
      RAISE EXCEPTION 'Household size must be between 1 and 30';
    END IF;
    IF NEW.certified_at IS NULL THEN
      RAISE EXCEPTION 'You must certify that the information you provided is true';
    END IF;

    -- Every required document must be on file and not yet attached to another application.
    SELECT value INTO required_docs FROM public.system_settings WHERE key = 'required_documents';
    IF required_docs IS NOT NULL AND jsonb_typeof(required_docs) = 'array' THEN
      SELECT string_agg(d, ', ') INTO missing
        FROM jsonb_array_elements_text(required_docs) AS d
       WHERE NOT EXISTS (
         SELECT 1 FROM public.documents doc
          WHERE doc.user_id = NEW.user_id AND doc.application_id IS NULL AND doc.document_type = d
       );
      IF missing IS NOT NULL THEN
        RAISE EXCEPTION 'Upload all required documents before applying. Missing: %', missing;
      END IF;
    END IF;
  END IF;

  -- Server-set values the student can't spoof.
  IF NEW.certified_at IS NOT NULL THEN NEW.certified_at := now(); END IF;
  NEW.school_name := prof.school_name;
  NEW.course := prof.course;
  NEW.year_level := prof.year_level;
  NEW.average_grade := prof.average_grade;
  NEW.academic_year := public.setting_text('academic_year', NULL);
  NEW.semester := public.setting_text('current_semester', NULL);
  RETURN NEW;
END;
$$;

-- ── 5. Documents follow the application: attached on submit, released again on withdrawal ──
CREATE OR REPLACE FUNCTION public.link_application_documents()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.documents SET application_id = NEW.id
     WHERE user_id = NEW.user_id AND application_id IS NULL;
  ELSIF NEW.status = 'Withdrawn' AND OLD.status <> 'Withdrawn' THEN
    UPDATE public.documents SET application_id = NULL WHERE application_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_link_application_documents ON public.applications;
CREATE TRIGGER tr_link_application_documents
  AFTER INSERT OR UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.link_application_documents();

NOTIFY pgrst, 'reload schema';
