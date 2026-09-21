-- Scholar verification was previously dead: nothing ever inserted into
-- public.scholar_verifications outside of supabase/seed.sql, so the admin
-- dashboard's Verification tab never showed real applicants.
--
-- This migration:
--   1. Teaches handle_new_user() to also copy student_id_number/government_id
--      from signup metadata into public.profiles (columns already exist —
--      see schema.sql section 16 — they were just never populated).
--   2. Adds a trigger that auto-creates a scholar_verifications row whenever
--      a student submits an application, pulling their ID numbers from
--      public.profiles. Runs as SECURITY DEFINER so it works regardless of
--      which client path inserted the application (the /api/applications
--      route or the register page's direct client-side insert), without
--      needing a separate RLS insert policy for students.
--
-- Run in the Supabase SQL Editor or:
--   npx supabase db query --linked -f supabase/migrations/005_scholar_verification_autocreate.sql

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
    course, year_level, average_grade, student_id_number, government_id
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
    grade_value,
    NULLIF(meta->>'student_id_number', ''),
    NULLIF(meta->>'government_id', '')
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
    average_grade = COALESCE(EXCLUDED.average_grade, public.profiles.average_grade),
    student_id_number = COALESCE(EXCLUDED.student_id_number, public.profiles.student_id_number),
    government_id = COALESCE(EXCLUDED.government_id, public.profiles.government_id);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'student')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_scholar_verification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  applicant public.profiles%ROWTYPE;
  prior_flag BOOLEAN;
BEGIN
  SELECT * INTO applicant FROM public.profiles WHERE id = NEW.user_id;

  -- Auto-detect a likely duplicate: same student already has another
  -- Verified/Flagged record under the same student_id_number.
  prior_flag := FALSE;
  IF applicant.student_id_number IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.scholar_verifications
      WHERE student_id_number = applicant.student_id_number
        AND user_id <> NEW.user_id
    ) INTO prior_flag;
  END IF;

  INSERT INTO public.scholar_verifications (
    application_id, user_id, student_id_number, government_id, verification_status
  )
  VALUES (
    NEW.id,
    NEW.user_id,
    applicant.student_id_number,
    applicant.government_id,
    CASE WHEN prior_flag THEN 'Flagged' ELSE 'Pending' END
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_create_scholar_verification ON public.applications;

CREATE TRIGGER tr_create_scholar_verification
  AFTER INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.create_scholar_verification();
