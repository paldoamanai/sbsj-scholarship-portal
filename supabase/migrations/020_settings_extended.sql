-- Extended system settings:
--   * super_admin: counts as an admin everywhere; once a super_admin exists, only they can edit settings
--   * renewal rules (open/closed, minimum grade for renewals, max renewals) enforced on application insert
--   * required documents list, default payment method and default payment lead time
-- Run after 019. Safe to re-run.

-- ── 1. super_admin is a superset of admin (text compare: no dependency on the enum value existing) ──
CREATE OR REPLACE FUNCTION public.has_role(_role app_role, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND (role = _role OR (_role::text = 'admin' AND role::text = 'super_admin'))
  );
$$;

-- Settings can be edited by any admin until a super_admin exists; from then on, super admins only.
CREATE OR REPLACE FUNCTION public.can_manage_settings(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role::text = 'super_admin')
    OR (
      EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role::text = 'admin')
      AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role::text = 'super_admin')
    );
$$;

DROP POLICY IF EXISTS "Admins can manage settings" ON public.system_settings;
CREATE POLICY "Admins can manage settings" ON public.system_settings
  FOR ALL USING (public.can_manage_settings(auth.uid()))
  WITH CHECK (public.can_manage_settings(auth.uid()));

-- ── 2. Seed new settings ──
INSERT INTO public.system_settings (key, value, description) VALUES
  ('required_documents', '["Valid ID", "Grades", "Certificate of Registration", "Barangay Indigency", "Birth Certificate"]', 'Documents every applicant must upload'),
  ('default_payment_method', '"Cash"', 'Payment method preselected for new payments'),
  ('default_payment_lead_days', '7', 'New payments are scheduled this many days from today'),
  ('renewal_enabled', 'true', 'Previously approved scholars may apply again (renew)'),
  ('renewal_min_grade', '85', 'Minimum average grade for a renewal (0 = no minimum)'),
  ('max_renewals', '3', 'How many times a scholar can renew after the first approval')
ON CONFLICT (key) DO NOTHING;

-- ── 3. Validation for the new keys (runs alongside the 019 trigger) ──
CREATE OR REPLACE FUNCTION public.validate_system_setting_ext()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  n NUMERIC;
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
    ELSE
      NULL;
  END CASE;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_validate_system_setting_ext ON public.system_settings;
CREATE TRIGGER tr_validate_system_setting_ext
  BEFORE INSERT OR UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public.validate_system_setting_ext();

-- ── 4. Renewal rules on application insert ──
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS is_renewal BOOLEAN NOT NULL DEFAULT false;

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
  student_grade NUMERIC;
  year_count INTEGER;
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

  IF min_grade > 0 THEN
    SELECT average_grade INTO student_grade FROM public.profiles WHERE id = NEW.user_id;
    IF student_grade IS NULL THEN
      RAISE EXCEPTION 'Add your average grade to your profile before applying (minimum required: %)', min_grade;
    END IF;
    IF student_grade < min_grade THEN
      RAISE EXCEPTION 'Your average grade (%) is below the minimum of % required to apply', student_grade, min_grade;
    END IF;
  END IF;

  SELECT COUNT(*) INTO year_count FROM public.applications
   WHERE user_id = NEW.user_id
     AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM now());
  IF year_count >= max_apps THEN
    RAISE EXCEPTION 'You have reached the limit of % application(s) for this year', max_apps;
  END IF;

  NEW.academic_year := public.setting_text('academic_year', NULL);
  NEW.semester := public.setting_text('current_semester', NULL);
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
