-- Persist registration details into public.profiles even when email confirmation
-- is on (no session yet). Also allow a user to insert their own profile if the
-- auth trigger did not create one.
--
-- Run in the Supabase SQL Editor or:
--   npx supabase db query --linked -f supabase/migrations/003_persist_signup_profiles.sql

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  dob_value date;
  grade_value numeric;
BEGIN
  BEGIN
    IF COALESCE(meta->>'dob', '') ~ '^\d{4}-\d{2}-\d{2}$' THEN
      dob_value := (meta->>'dob')::date;
    ELSE
      dob_value := NULL;
    END IF;
  EXCEPTION WHEN others THEN
    dob_value := NULL;
  END;

  BEGIN
    IF COALESCE(meta->>'average_grade', '') ~ '^[0-9]+(\.[0-9]+)?$' THEN
      grade_value := (meta->>'average_grade')::numeric;
    ELSE
      grade_value := NULL;
    END IF;
  EXCEPTION WHEN others THEN
    grade_value := NULL;
  END;

  INSERT INTO public.profiles (
    id, email, first_name, middle_name, last_name, sex, civil_status,
    nationality, dob, phone, barangay, municipality, school_name,
    course, year_level, average_grade
  )
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(meta->>'first_name', ''),
    NULLIF(meta->>'middle_name', ''),
    NULLIF(meta->>'last_name', ''),
    NULLIF(meta->>'sex', ''),
    NULLIF(meta->>'civil_status', ''),
    COALESCE(NULLIF(meta->>'nationality', ''), 'Filipino'),
    dob_value,
    NULLIF(meta->>'phone', ''),
    NULLIF(meta->>'barangay', ''),
    NULLIF(meta->>'municipality', ''),
    NULLIF(meta->>'school_name', ''),
    NULLIF(meta->>'course', ''),
    NULLIF(meta->>'year_level', ''),
    grade_value
  )
  ON CONFLICT (id) DO UPDATE SET
    email = COALESCE(EXCLUDED.email, public.profiles.email),
    first_name = COALESCE(EXCLUDED.first_name, public.profiles.first_name),
    middle_name = COALESCE(EXCLUDED.middle_name, public.profiles.middle_name),
    last_name = COALESCE(EXCLUDED.last_name, public.profiles.last_name),
    sex = COALESCE(EXCLUDED.sex, public.profiles.sex),
    civil_status = COALESCE(EXCLUDED.civil_status, public.profiles.civil_status),
    nationality = COALESCE(EXCLUDED.nationality, public.profiles.nationality),
    dob = COALESCE(EXCLUDED.dob, public.profiles.dob),
    phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
    barangay = COALESCE(EXCLUDED.barangay, public.profiles.barangay),
    municipality = COALESCE(EXCLUDED.municipality, public.profiles.municipality),
    school_name = COALESCE(EXCLUDED.school_name, public.profiles.school_name),
    course = COALESCE(EXCLUDED.course, public.profiles.course),
    year_level = COALESCE(EXCLUDED.year_level, public.profiles.year_level),
    average_grade = COALESCE(EXCLUDED.average_grade, public.profiles.average_grade);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'student')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Staff roles beyond 'admin' should also see the student directory.
CREATE OR REPLACE FUNCTION public.is_staff(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin', 'super_admin', 'finance_admin', 'reviewer')
  );
$$;

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT USING (public.is_staff(auth.uid()));

ALTER TABLE public.profiles REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
  END IF;
END $$;

-- Notify every staff user (admin/super_admin/finance_admin/reviewer) in-app
-- whenever a brand-new student profile is created, so the admin dashboard's
-- notification bell/feed actually has something to show for new registrations.
-- Fires only on true INSERT — the ON CONFLICT DO UPDATE path above (re-signup,
-- or the student dashboard's metadata backfill) does not re-fire this trigger.
CREATE OR REPLACE FUNCTION public.notify_staff_new_registration()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  staff_id UUID;
  student_name TEXT;
BEGIN
  student_name := NULLIF(TRIM(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '')), '');
  IF student_name IS NULL THEN
    student_name := COALESCE(NEW.email, 'A new student');
  END IF;

  FOR staff_id IN
    SELECT user_id FROM public.user_roles
    WHERE role IN ('admin', 'super_admin', 'finance_admin', 'reviewer')
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type)
    VALUES (staff_id, 'New Student Registered', student_name || ' just created an account.', 'info');
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_notify_staff_new_registration ON public.profiles;

CREATE TRIGGER tr_notify_staff_new_registration
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.notify_staff_new_registration();
