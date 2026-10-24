-- The student ID number is no longer collected, so it is removed from the database, along with the
-- government ID it used to sit beside (dropped from the app in 031).
--
--   * drops profiles.student_id_number / government_id and the same columns on scholar_verifications,
--     with the one-account-per-student-ID guard (039), student_id_available() and the trigger that
--     copied profile IDs into verification rows (006)
--   * handle_new_user() and guard_profile_update() no longer read the columns
--   * get_my_receipt_slip() no longer returns student_id
--   * the duplicate-applicant check now matches on full name (first + last, ignoring case and spaces)
--     plus date of birth, and tells the office when it flags someone, since the Verification section
--     that used to show flags is gone (033)
--
-- The stored ID numbers are deleted and can't be recovered. Run in the Supabase SQL Editor after 067,
-- and only once the app without the student ID is live. Safe to re-run.

BEGIN;

-- ── 1. Guards and helpers that only existed for the IDs ──
DROP TRIGGER IF EXISTS tr_guard_unique_student_id ON public.profiles;
DROP FUNCTION IF EXISTS public.guard_unique_student_id();
DROP FUNCTION IF EXISTS public.student_id_available(TEXT);
DROP TRIGGER IF EXISTS tr_sync_verification_ids ON public.profiles;
DROP FUNCTION IF EXISTS public.sync_verification_ids();
DROP INDEX IF EXISTS public.profiles_student_id_norm_idx;
DROP INDEX IF EXISTS public.scholar_verifications_student_id_idx;
DROP INDEX IF EXISTS public.scholar_verifications_gov_id_idx;

-- ── 2. Signup no longer copies the IDs into the profile ──
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

-- ── 3. Profile guard without the ID lock (031, otherwise unchanged) ──
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

-- ── 4. Receipt slip without the student ID (053, otherwise unchanged) ──
-- The returned columns change, so the function is dropped and created again.
DROP FUNCTION IF EXISTS public.get_my_receipt_slip(UUID);
CREATE FUNCTION public.get_my_receipt_slip(_payment_id UUID)
RETURNS TABLE (
  receipt_no TEXT,
  student_name TEXT,
  program TEXT,
  amount NUMERIC,
  method TEXT,
  reference TEXT,
  disbursed_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay public.payments%ROWTYPE;
BEGIN
  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND OR pay.user_id <> auth.uid() THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF pay.status <> 'Disbursed' OR pay.receipt_review_status IS DISTINCT FROM 'Accepted' THEN
    RAISE EXCEPTION 'Your slip can be downloaded once your receipt number has been confirmed';
  END IF;

  RETURN QUERY
  SELECT r.receipt_no,
         COALESCE(NULLIF(btrim(concat_ws(' ', pr.first_name, pr.middle_name, pr.last_name)), ''), public.display_name(pay.user_id)),
         COALESCE(s.name, 'Scholarship'),
         pay.amount,
         pay.method,
         pay.reference,
         pay.disbursed_at,
         pay.student_receipt_at
    FROM public.payment_receipt_numbers r
    LEFT JOIN public.profiles pr ON pr.id = pay.user_id
    LEFT JOIN public.applications a ON a.id = pay.application_id
    LEFT JOIN public.scholarships s ON s.id = a.scholarship_id
   WHERE r.payment_id = pay.id;

  IF NOT FOUND THEN RAISE EXCEPTION 'This payment was released before receipt numbers were issued, so there is no slip to download'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_receipt_slip(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_receipt_slip(UUID) TO authenticated;

-- ── 5. Duplicate-applicant check on name + date of birth ──
-- "Juan Dela Cruz" and "juan delacruz" match; the middle name is ignored because it is optional.
CREATE OR REPLACE FUNCTION public.person_key(_first TEXT, _last TEXT, _dob DATE)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN public.normalize_id(_first) IS NULL OR public.normalize_id(_last) IS NULL OR _dob IS NULL THEN NULL
              ELSE public.normalize_id(_first) || '|' || public.normalize_id(_last) || '|' || _dob::text END;
$$;

CREATE INDEX IF NOT EXISTS profiles_person_key_idx
  ON public.profiles (public.person_key(first_name, last_name, dob));

CREATE OR REPLACE FUNCTION public.create_scholar_verification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me TEXT;
  dup_count INTEGER := 0;
  has_approved BOOLEAN := FALSE;
  details TEXT;
BEGIN
  SELECT public.person_key(first_name, last_name, dob) INTO me FROM public.profiles WHERE id = NEW.user_id;

  -- Other accounts with the same name and birth date that have applied before.
  IF me IS NOT NULL THEN
    SELECT COUNT(DISTINCT p.id),
           COALESCE(bool_or(a.status = 'Approved'), FALSE)
      INTO dup_count, has_approved
      FROM public.profiles p
      JOIN public.applications a ON a.user_id = p.id
     WHERE p.id <> NEW.user_id
       AND public.person_key(p.first_name, p.last_name, p.dob) = me;
  END IF;

  IF dup_count > 0 THEN
    details := format('%s other account(s) have the same name and date of birth%s.',
      dup_count, CASE WHEN has_approved THEN ' (at least one already approved)' ELSE '' END);

    -- Flag the earlier, still-pending records too so a reviewer sees both sides.
    UPDATE public.scholar_verifications sv
       SET verification_status = 'Flagged',
           notes = COALESCE(sv.notes || E'\n', '') || 'Auto-flagged: another account has the same name and date of birth.'
      FROM public.profiles p
     WHERE p.id = sv.user_id
       AND sv.user_id <> NEW.user_id
       AND sv.verification_status = 'Pending'
       AND public.person_key(p.first_name, p.last_name, p.dob) = me;

    PERFORM public.notify_admins('Possible Duplicate Applicant',
      public.display_name(NEW.user_id) || ' has the same name and date of birth as ' || dup_count || ' other account(s)'
        || CASE WHEN has_approved THEN ', at least one already approved' ELSE '' END || '. Check before approving.',
      'warning', 'application', '/admin?section=applications', 'applications', NEW.id);
  END IF;

  INSERT INTO public.scholar_verifications (
    application_id, user_id, has_existing_scholarship, existing_scholarship_details, verification_status
  )
  VALUES (
    NEW.id, NEW.user_id, has_approved, details,
    CASE WHEN dup_count > 0 THEN 'Flagged' ELSE 'Pending' END
  );

  RETURN NEW;
END;
$$;

-- ── 6. Drop the columns ──
ALTER TABLE public.scholar_verifications DROP COLUMN IF EXISTS student_id_number;
ALTER TABLE public.scholar_verifications DROP COLUMN IF EXISTS government_id;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS student_id_number;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS government_id;

COMMIT;

NOTIFY pgrst, 'reload schema';
