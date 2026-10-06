-- Students may apply to, and be approved for, every open program. Each program (office) decides on its
-- own: an application is approved only if the student passes that program's requirements.
--
--   * the per-year application cap (max_scholarships_per_student) is no longer enforced; instead a
--     student may have one application per program per year (a withdrawn one frees that program again)
--   * approval re-checks the program's rules against the student's current profile: minimum grade
--     (the program's and the global one), year level and residency. Verified documents (023) and free
--     slots (008) were already required.
--   * a renewal is an application to a program the student was approved for in an earlier year, so
--     being approved for one program this year doesn't make the next application a "renewal"
--   * documents are shared by all of a student's applications for the year. They used to be attached to
--     the first application only, which made a second application fail the required-documents check.
--     Once approved, the (already verified) documents stay locked and keep serving later applications.
--   * if an earlier version of this migration was run, its one-approval-per-year triggers are removed
--
-- Run after 034. Safe to re-run.

BEGIN;

-- ── 1. Which documents count for an application ──
-- A document counts when it is still unattached, or is attached to any of the student's applications
-- from the same calendar year.
CREATE OR REPLACE FUNCTION public.in_document_set(_application_id UUID, _user UUID, _on TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _application_id IS NULL OR EXISTS (
    SELECT 1 FROM public.applications a
     WHERE a.id = _application_id
       AND a.user_id = _user
       AND EXTRACT(YEAR FROM a.created_at) = EXTRACT(YEAR FROM _on)
  );
$$;

-- ── 2. Insert rules: one application per program per year, shared documents ──
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

-- ── 3. A disapproved document must be replaced before applying (same shared set) ──
CREATE OR REPLACE FUNCTION public.require_accepted_documents()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bad TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  SELECT string_agg(DISTINCT d.document_type, ', ') INTO bad
    FROM public.documents d
   WHERE d.user_id = NEW.user_id AND d.status = 'Disapproved'
     AND public.in_document_set(d.application_id, NEW.user_id, now())
     AND NOT EXISTS (
       SELECT 1 FROM public.documents n
        WHERE n.user_id = d.user_id AND n.document_type = d.document_type AND n.uploaded_at > d.uploaded_at
          AND public.in_document_set(n.application_id, NEW.user_id, now())
     );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Replace the disapproved documents before applying: %', bad;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 4. Approval needs verified documents from the shared set ──
CREATE OR REPLACE FUNCTION public.require_verified_documents_before_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req JSONB;
  outstanding TEXT;
BEGIN
  IF NEW.status <> 'Approved' OR OLD.status = 'Approved' OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT value INTO req FROM public.system_settings WHERE key = 'required_documents';
  IF req IS NULL OR jsonb_typeof(req) <> 'array' THEN
    RETURN NEW;
  END IF;

  SELECT string_agg(
           d || CASE WHEN latest.status IS NULL THEN ' (missing)' ELSE ' (' || lower(latest.status) || ')' END,
           ', ')
    INTO outstanding
    FROM jsonb_array_elements_text(req) AS d
    LEFT JOIN LATERAL (
      SELECT doc.status
        FROM public.documents doc
       WHERE doc.user_id = NEW.user_id
         AND doc.document_type = d
         AND public.in_document_set(doc.application_id, NEW.user_id, NEW.created_at)
       ORDER BY doc.uploaded_at DESC
       LIMIT 1
    ) latest ON true
   WHERE latest.status IS DISTINCT FROM 'Verified';

  IF outstanding IS NOT NULL THEN
    RAISE EXCEPTION 'Verify all required documents before approving. Outstanding: %', outstanding;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 5. Program rules at insert: a renewal means the same program, approved in an earlier year ──
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
  required_grade NUMERIC;
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
      required_grade := s.min_grade;
      -- Renewing this program (approved for it in an earlier year): the renewal minimum applies,
      -- same as the global minimum check in enforce_application_settings.
      IF public.setting_bool('renewal_enabled', true)
         AND EXISTS (SELECT 1 FROM public.applications
                      WHERE user_id = NEW.user_id AND status = 'Approved' AND scholarship_id = s.id
                        AND EXTRACT(YEAR FROM created_at) < EXTRACT(YEAR FROM now())) THEN
        required_grade := public.setting_number('renewal_min_grade', required_grade);
      END IF;
      IF required_grade > 0 THEN
        IF prof.average_grade IS NULL THEN
          RAISE EXCEPTION 'Add your average grade to your profile before applying to % (minimum: %)', s.name, required_grade;
        END IF;
        IF prof.average_grade < required_grade THEN
          RAISE EXCEPTION 'Your average grade (%) is below the % required for %', prof.average_grade, required_grade, s.name;
        END IF;
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

-- ── 6. Approval: the student must still pass this program's requirements ──
-- Checked against the current profile, so a grade or year level that changed since applying counts.
-- Updates with no signed-in user (SQL editor / service role) are not checked.
CREATE OR REPLACE FUNCTION public.require_program_requirements_on_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.scholarships%ROWTYPE;
  prof public.profiles%ROWTYPE;
  renewal BOOLEAN;
  required_grade NUMERIC;
  failed TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF NEW.status <> 'Approved' OR OLD.status = 'Approved' OR auth.uid() IS NULL OR NEW.scholarship_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO s FROM public.scholarships WHERE id = NEW.scholarship_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT * INTO prof FROM public.profiles WHERE id = NEW.user_id;

  renewal := NEW.is_renewal AND public.setting_bool('renewal_enabled', true);
  required_grade := CASE WHEN renewal THEN public.setting_number('renewal_min_grade', 0)
                         ELSE GREATEST(COALESCE(s.min_grade, 0), public.setting_number('min_grade_requirement', 0)) END;
  IF required_grade > 0 THEN
    IF prof.average_grade IS NULL THEN
      failed := failed || ('average grade of at least ' || trim_scale(required_grade) || ' (none on the profile)');
    ELSIF prof.average_grade < required_grade THEN
      failed := failed || ('average grade of at least ' || trim_scale(required_grade) || ' (has ' || trim_scale(prof.average_grade) || ')');
    END IF;
  END IF;
  IF s.year_levels IS NOT NULL AND cardinality(s.year_levels) > 0
     AND (prof.year_level IS NULL OR NOT (prof.year_level = ANY (s.year_levels))) THEN
    failed := failed || ('year level ' || array_to_string(s.year_levels, ', ') || ' (is ' || COALESCE(prof.year_level, 'not set') || ')');
  END IF;
  IF btrim(COALESCE(s.municipality, '')) <> ''
     AND lower(btrim(COALESCE(prof.municipality, ''))) <> lower(btrim(s.municipality)) THEN
    failed := failed || ('resident of ' || btrim(s.municipality) || ' (lives in ' || COALESCE(NULLIF(btrim(prof.municipality), ''), 'not set') || ')');
  END IF;

  IF cardinality(failed) > 0 THEN
    RAISE EXCEPTION 'The student does not meet the requirements of %: %', s.name, array_to_string(failed, '; ');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_require_program_requirements_on_approval ON public.applications;
CREATE TRIGGER tr_require_program_requirements_on_approval
  BEFORE UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.require_program_requirements_on_approval();

-- From an earlier version of this migration: approval is no longer limited to one per year.
DROP TRIGGER IF EXISTS tr_enforce_single_approval ON public.applications;
DROP FUNCTION IF EXISTS public.enforce_single_approval();
DROP TRIGGER IF EXISTS tr_close_other_applications ON public.applications;
DROP FUNCTION IF EXISTS public.close_other_applications();

-- ── 7. Documents follow the application; on withdrawal they move to another open one, if any ──
CREATE OR REPLACE FUNCTION public.link_application_documents()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  heir UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.documents SET application_id = NEW.id
     WHERE user_id = NEW.user_id AND application_id IS NULL;
  ELSIF NEW.status = 'Withdrawn' AND OLD.status <> 'Withdrawn' THEN
    -- Keep them attached (so they can't be deleted from under it) to another open application this year.
    SELECT id INTO heir FROM public.applications
     WHERE user_id = NEW.user_id AND id <> NEW.id AND status IN ('Pending', 'Waitlisted', 'Approved')
       AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM NEW.created_at)
     ORDER BY created_at
     LIMIT 1;
    UPDATE public.documents SET application_id = heir WHERE application_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;

-- ── 8. Reminders ──
-- Per-program reminders skip students who already applied to that program this year.
CREATE OR REPLACE FUNCTION public.has_application_this_year(_user UUID, _scholarship UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.applications
     WHERE user_id = _user
       AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM now())
       AND scholarship_id = _scholarship AND status <> 'Withdrawn'
  );
$$;

-- Rebuilt from the live definitions (see 034), so only these expressions change.
DO $$
DECLARE
  f RECORD;
  def TEXT;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.proname IN ('send_deadline_reminders', 'send_opening_reminders', 'send_document_reminders')
  LOOP
    def := pg_get_functiondef(f.oid);
    -- Program loops: the 2-argument check (the global "applications open" loop keeps the 1-argument one).
    def := regexp_replace(def,
      '(student_eligible_for\(ur\.user_id, sch\.id\)\s+AND NOT public\.has_application_this_year\(ur\.user_id)\)',
      '\1, sch.id)', 'g');
    -- Missing-document reminders look at the shared document set.
    def := replace(def,
      '(doc.application_id = a.id OR doc.application_id IS NULL)',
      'public.in_document_set(doc.application_id, a.user_id, now())');
    EXECUTE def;
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
