-- Make admin System Settings real:
--   * typed, validated settings (trigger) with updated_by / updated_at stamped by the database
--   * new settings: application window, maintenance mode, upload limit, contact info, program name
--   * application rules enforced in the database: maintenance, open/close window, minimum grade,
--     max applications per calendar year (replaces the hard 1-per-year unique index)
--   * applications remember the academic year / semester they were filed under
--   * payment methods: only enabled methods can be used (Cash / Cheque are the supported ones)

-- ── 0. Create the table if this database never had it (see schema.sql section 14) ──
CREATE TABLE IF NOT EXISTS public.system_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read settings" ON public.system_settings;
CREATE POLICY "Anyone can read settings" ON public.system_settings
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins can manage settings" ON public.system_settings;
CREATE POLICY "Admins can manage settings" ON public.system_settings
  FOR ALL USING (
    public.has_role('admin', auth.uid())
    OR public.has_role('super_admin', auth.uid())
  );

UPDATE public.system_settings SET description = 'Maximum applications per student per calendar year'
 WHERE key = 'max_scholarships_per_student';
UPDATE public.system_settings SET description = 'Enabled payment methods (Cash and/or Cheque)'
 WHERE key = 'payment_methods';

-- Numbers / booleans that were saved as strings by the old UI.
UPDATE public.system_settings SET value = to_jsonb((value #>> '{}')::numeric)
 WHERE key IN ('min_grade_requirement', 'max_scholarships_per_student', 'max_upload_mb')
   AND jsonb_typeof(value) = 'string' AND (value #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$';
UPDATE public.system_settings SET value = to_jsonb((value #>> '{}') = 'true')
 WHERE key IN ('email_notifications', 'applications_open', 'maintenance_mode')
   AND jsonb_typeof(value) = 'string';

-- Old seed listed methods the app never supported.
UPDATE public.system_settings SET value = '["Cash", "Cheque"]'
 WHERE key = 'payment_methods' AND value @> '"Bank Transfer"';

-- ── 2. Validation + audit stamping ──
CREATE OR REPLACE FUNCTION public.validate_system_setting()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  n NUMERIC;
  s TEXT;
BEGIN
  CASE NEW.key
    WHEN 'min_grade_requirement' THEN
      IF jsonb_typeof(NEW.value) <> 'number' THEN RAISE EXCEPTION 'Minimum grade must be a number'; END IF;
      n := (NEW.value #>> '{}')::numeric;
      IF n < 0 OR n > 100 THEN RAISE EXCEPTION 'Minimum grade must be between 0 and 100'; END IF;
    WHEN 'max_scholarships_per_student' THEN
      IF jsonb_typeof(NEW.value) <> 'number' THEN RAISE EXCEPTION 'Max applications must be a number'; END IF;
      n := (NEW.value #>> '{}')::numeric;
      IF n < 1 OR n > 20 OR n <> trunc(n) THEN RAISE EXCEPTION 'Max applications must be a whole number from 1 to 20'; END IF;
    WHEN 'max_upload_mb' THEN
      IF jsonb_typeof(NEW.value) <> 'number' THEN RAISE EXCEPTION 'Upload limit must be a number'; END IF;
      n := (NEW.value #>> '{}')::numeric;
      IF n < 1 OR n > 25 THEN RAISE EXCEPTION 'Upload limit must be between 1 and 25 MB'; END IF;
    WHEN 'academic_year' THEN
      s := NEW.value #>> '{}';
      IF jsonb_typeof(NEW.value) <> 'string' OR s !~ '^[0-9]{4}-[0-9]{4}$'
         OR substr(s, 6, 4)::int <> substr(s, 1, 4)::int + 1 THEN
        RAISE EXCEPTION 'Academic year must look like 2025-2026';
      END IF;
    WHEN 'current_semester' THEN
      IF (NEW.value #>> '{}') NOT IN ('1st Semester', '2nd Semester', 'Summer') THEN
        RAISE EXCEPTION 'Semester must be 1st Semester, 2nd Semester or Summer';
      END IF;
    WHEN 'payment_methods' THEN
      IF jsonb_typeof(NEW.value) <> 'array' OR jsonb_array_length(NEW.value) = 0 THEN
        RAISE EXCEPTION 'Enable at least one payment method';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(NEW.value) m WHERE m NOT IN ('Cash', 'Cheque')) THEN
        RAISE EXCEPTION 'Only Cash and Cheque are supported payment methods';
      END IF;
    WHEN 'email_notifications', 'applications_open', 'maintenance_mode' THEN
      IF jsonb_typeof(NEW.value) <> 'boolean' THEN RAISE EXCEPTION '% must be on or off', NEW.key; END IF;
    WHEN 'application_open_date', 'application_close_date' THEN
      s := NEW.value #>> '{}';
      IF jsonb_typeof(NEW.value) <> 'string' OR (s <> '' AND s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN
        RAISE EXCEPTION 'Dates must be blank or YYYY-MM-DD';
      END IF;
      IF s <> '' THEN PERFORM s::date; END IF;
    WHEN 'program_name', 'contact_email', 'contact_phone', 'contact_address', 'office_hours', 'maintenance_message' THEN
      IF jsonb_typeof(NEW.value) <> 'string' THEN RAISE EXCEPTION '% must be text', NEW.key; END IF;
      IF length(NEW.value #>> '{}') > 300 THEN RAISE EXCEPTION '% is too long', NEW.key; END IF;
      IF NEW.key IN ('program_name', 'contact_email') AND btrim(NEW.value #>> '{}') = '' THEN
        RAISE EXCEPTION '% cannot be blank', NEW.key;
      END IF;
    ELSE
      NULL;
  END CASE;

  -- open date must not be after close date
  IF NEW.key = 'application_open_date' AND (NEW.value #>> '{}') <> '' THEN
    SELECT value #>> '{}' INTO s FROM public.system_settings WHERE key = 'application_close_date';
    IF COALESCE(s, '') <> '' AND (NEW.value #>> '{}')::date > s::date THEN
      RAISE EXCEPTION 'The opening date cannot be after the closing date';
    END IF;
  END IF;

  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_validate_system_setting ON public.system_settings;
CREATE TRIGGER tr_validate_system_setting
  BEFORE INSERT OR UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public.validate_system_setting();

-- ── 3. Helpers ──
CREATE OR REPLACE FUNCTION public.setting_text(_key TEXT, _default TEXT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT value #>> '{}' FROM public.system_settings WHERE key = _key), _default);
$$;

CREATE OR REPLACE FUNCTION public.setting_number(_key TEXT, _default NUMERIC)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT (value #>> '{}')::numeric FROM public.system_settings WHERE key = _key AND jsonb_typeof(value) = 'number'), _default);
$$;

CREATE OR REPLACE FUNCTION public.setting_bool(_key TEXT, _default BOOLEAN)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT (value #>> '{}')::boolean FROM public.system_settings WHERE key = _key AND jsonb_typeof(value) = 'boolean'), _default);
$$;

-- ── 4. Application rules driven by settings ──
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS academic_year TEXT;
ALTER TABLE public.applications ADD COLUMN IF NOT EXISTS semester TEXT;

DROP INDEX IF EXISTS public.applications_one_per_year_per_user;

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

DROP TRIGGER IF EXISTS tr_enforce_application_settings ON public.applications;
CREATE TRIGGER tr_enforce_application_settings
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_application_settings();

-- ── 5. Payment methods must be enabled ──
CREATE OR REPLACE FUNCTION public.enforce_enabled_payment_method()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  enabled JSONB;
BEGIN
  IF NEW.status = 'Cancelled' THEN RETURN NEW; END IF;
  SELECT value INTO enabled FROM public.system_settings WHERE key = 'payment_methods';
  IF enabled IS NULL OR jsonb_typeof(enabled) <> 'array' THEN RETURN NEW; END IF;

  IF NEW.method IS NOT NULL AND (
       TG_OP = 'INSERT'
       OR NEW.method IS DISTINCT FROM OLD.method
       OR (NEW.status = 'Disbursed' AND OLD.status IS DISTINCT FROM 'Disbursed')
     ) AND NOT (enabled @> to_jsonb(NEW.method)) THEN
    RAISE EXCEPTION '% payments are turned off in System Settings', NEW.method;
  END IF;

  IF NEW.preferred_method IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.preferred_method IS DISTINCT FROM OLD.preferred_method)
     AND NOT (enabled @> to_jsonb(NEW.preferred_method)) THEN
    RAISE EXCEPTION '% payments are turned off right now', NEW.preferred_method;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_enabled_payment_method ON public.payments;
CREATE TRIGGER tr_enforce_enabled_payment_method
  BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_enabled_payment_method();
