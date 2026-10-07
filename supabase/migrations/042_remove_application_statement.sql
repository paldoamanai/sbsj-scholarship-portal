-- The application form no longer asks for a statement ("Why do you need this scholarship?"),
-- monthly household income or household size, and students can no longer edit a submitted
-- application. The insert trigger stops requiring a statement; existing values are kept.
--
-- Run after 041. Safe to re-run.

BEGIN;

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
  prior_approved INTEGER;
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

  -- One application per program per year. A withdrawn application frees the program again.
  IF EXISTS (
    SELECT 1 FROM public.applications
     WHERE user_id = NEW.user_id
       AND scholarship_id IS NOT DISTINCT FROM NEW.scholarship_id
       AND status <> 'Withdrawn'
       AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM now())
  ) THEN
    RAISE EXCEPTION 'You have already applied to this program this year';
  END IF;

  -- Renewals: a student approved for this same program in an earlier year is renewing it.
  -- prior_approved = renewals already used + 1, so allowing up to max_renewals means
  -- one original award plus max_renewals renewals.
  SELECT COUNT(*) INTO prior_approved FROM public.applications
   WHERE user_id = NEW.user_id AND status = 'Approved'
     AND scholarship_id IS NOT DISTINCT FROM NEW.scholarship_id
     AND EXTRACT(YEAR FROM created_at) < EXTRACT(YEAR FROM now());
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

  -- Checks for applications submitted by a signed-in student (not seed / service-role inserts).
  IF auth.uid() IS NOT NULL THEN
    IF NEW.certified_at IS NULL THEN
      RAISE EXCEPTION 'You must certify that the information you provided is true';
    END IF;

    -- Every required document must be on file for this year (unattached, or filed with another
    -- application from this year).
    SELECT value INTO required_docs FROM public.system_settings WHERE key = 'required_documents';
    IF required_docs IS NOT NULL AND jsonb_typeof(required_docs) = 'array' THEN
      SELECT string_agg(d, ', ') INTO missing
        FROM jsonb_array_elements_text(required_docs) AS d
       WHERE NOT EXISTS (
         SELECT 1 FROM public.documents doc
          WHERE doc.user_id = NEW.user_id AND doc.document_type = d
            AND public.in_document_set(doc.application_id, NEW.user_id, now())
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

COMMIT;
