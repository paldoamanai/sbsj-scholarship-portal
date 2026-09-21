-- Student profile hardening. Run after 025. Safe to re-run.
--   * students could edit ANY column of their own profile (average_grade, is_active, ID numbers, email):
--     a trigger now limits what a student can change, validates formats, and locks identity fields
--     while a scholarship is active
--   * the average grade is verified: students submit a grade with their grade report, staff verify it
--   * new profile fields: street address, province, ZIP, guardian details
--   * profile photos move to a private bucket (2 MB, JPG/PNG/WebP) with per-user storage policies
--   * privacy: students can ask for their account and data to be erased; staff respond
--   * profiles.email follows the auth email when a student changes it

-- ── 1. Columns ──
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS street_address TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS province TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS zip_code TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS guardian_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS guardian_relationship TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS guardian_phone TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS grade_verified_at TIMESTAMPTZ;   -- NULL = self-declared at registration
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS grade_term TEXT;

-- ── 2. What a student may change on their own profile ──
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only self-edits are restricted (admins act through their own functions / policies), and updates
  -- fired from another trigger (e.g. the auth email sync) are not.
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

  -- The grade may be declared once (at registration); after that it changes only through a verified update.
  IF NEW.average_grade IS DISTINCT FROM OLD.average_grade AND OLD.average_grade IS NOT NULL THEN
    RAISE EXCEPTION 'Your average grade is verified by the office. Submit a grade update with your grade report.';
  END IF;

  -- ID numbers feed duplicate detection, so they are fixed once you have applied.
  IF (NEW.student_id_number IS DISTINCT FROM OLD.student_id_number OR NEW.government_id IS DISTINCT FROM OLD.government_id)
     AND EXISTS (SELECT 1 FROM public.applications WHERE user_id = OLD.id AND status <> 'Withdrawn') THEN
    RAISE EXCEPTION 'Your ID numbers are locked once you have applied. Contact the office to correct them.';
  END IF;

  -- Identity and school details are locked while this year's scholarship is approved.
  IF public.documents_locked(OLD.id)
     AND ROW(NEW.first_name, NEW.middle_name, NEW.last_name, NEW.sex, NEW.dob, NEW.school_name, NEW.course, NEW.year_level)
         IS DISTINCT FROM
         ROW(OLD.first_name, OLD.middle_name, OLD.last_name, OLD.sex, OLD.dob, OLD.school_name, OLD.course, OLD.year_level) THEN
    RAISE EXCEPTION 'Your name, birth date, school, course and year level are locked while your scholarship is active. Contact the office to change them.';
  END IF;

  -- Formats (checked when the value changes, so old rows with legacy values can still be edited elsewhere).
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

DROP TRIGGER IF EXISTS tr_guard_profile_update ON public.profiles;
CREATE TRIGGER tr_guard_profile_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_update();

-- ── 3. profiles.email follows the auth email ──
CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_profile_email ON auth.users;
CREATE TRIGGER tr_sync_profile_email
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.sync_profile_email();

-- ── 4. Profile photos: private bucket, limits, per-user policies ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('profile-pictures', 'profile-pictures', false, 2 * 1024 * 1024, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "pp_owner_select" ON storage.objects;
CREATE POLICY "pp_owner_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'profile-pictures' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "pp_owner_insert" ON storage.objects;
CREATE POLICY "pp_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'profile-pictures' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "pp_owner_update" ON storage.objects;
CREATE POLICY "pp_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'profile-pictures' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "pp_owner_delete" ON storage.objects;
CREATE POLICY "pp_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'profile-pictures' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "pp_staff_select" ON storage.objects;
CREATE POLICY "pp_staff_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'profile-pictures' AND public.is_admin(auth.uid()));

-- Stored value is now the object path (it used to be a public URL): convert what can be converted safely.
UPDATE public.profiles
   SET profile_picture_url = substring(profile_picture_url from '/profile-pictures/([^?]+)$')
 WHERE profile_picture_url LIKE 'http%' AND profile_picture_url LIKE '%/profile-pictures/%' AND position('%' in profile_picture_url) = 0;

-- ── 5. Verified grades ──
CREATE TABLE IF NOT EXISTS public.grade_updates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grade NUMERIC NOT NULL CHECK (grade >= 0 AND grade <= 100),
  term TEXT NOT NULL CHECK (char_length(btrim(term)) BETWEEN 3 AND 60),
  file_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Verified', 'Rejected')),
  review_note TEXT,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS grade_updates_one_pending_per_user ON public.grade_updates (user_id) WHERE status = 'Pending';
CREATE INDEX IF NOT EXISTS grade_updates_user_idx ON public.grade_updates (user_id);

ALTER TABLE public.grade_updates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Students view own grade updates" ON public.grade_updates;
CREATE POLICY "Students view own grade updates" ON public.grade_updates FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Staff view grade updates" ON public.grade_updates;
CREATE POLICY "Staff view grade updates" ON public.grade_updates FOR SELECT USING (public.is_admin(auth.uid()));
-- Writes go through the functions below.

CREATE OR REPLACE FUNCTION public.submit_grade_update(_grade NUMERIC, _term TEXT, _path TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  obj_size BIGINT;
  obj_mime TEXT;
  max_mb NUMERIC := public.setting_number('max_upload_mb', 5);
  new_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please log in again'; END IF;
  IF _grade IS NULL OR _grade < 0 OR _grade > 100 THEN RAISE EXCEPTION 'Enter your average grade as a number from 0 to 100'; END IF;
  IF char_length(btrim(COALESCE(_term, ''))) < 3 OR char_length(_term) > 60 THEN RAISE EXCEPTION 'Enter the term the grade is for'; END IF;
  IF _path IS NULL OR _path NOT LIKE (auth.uid()::text || '/grades/%') THEN RAISE EXCEPTION 'Attach your grade report'; END IF;
  IF EXISTS (SELECT 1 FROM public.grade_updates WHERE user_id = auth.uid() AND status = 'Pending') THEN
    RAISE EXCEPTION 'You already have a grade update waiting for review';
  END IF;

  SELECT (metadata->>'size')::bigint, metadata->>'mimetype' INTO obj_size, obj_mime
    FROM storage.objects WHERE bucket_id = 'documents' AND name = _path;
  IF NOT FOUND THEN RAISE EXCEPTION 'The uploaded file could not be found. Please try again.'; END IF;
  IF obj_mime IS NULL OR obj_mime NOT IN ('application/pdf', 'image/jpeg', 'image/png') THEN
    RAISE EXCEPTION 'Only PDF, JPG and PNG files are allowed';
  END IF;
  IF obj_size IS NULL OR obj_size <= 0 THEN RAISE EXCEPTION 'The file is empty'; END IF;
  IF obj_size > max_mb * 1024 * 1024 THEN RAISE EXCEPTION 'File is too large (max % MB)', trim_scale(max_mb); END IF;

  INSERT INTO public.grade_updates (user_id, grade, term, file_path)
  VALUES (auth.uid(), _grade, btrim(_term), _path)
  RETURNING id INTO new_id;

  PERFORM public.notify_admins('Grade Update Submitted',
    public.display_name(auth.uid()) || ' submitted an average grade of ' || trim_scale(_grade) || ' for ' || btrim(_term) || '.',
    'info', 'verification', '/admin?section=students', 'grade_updates', new_id);
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_grade_update(NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_grade_update(NUMERIC, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_grade_update(_id UUID, _status TEXT, _note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g public.grade_updates%ROWTYPE;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _status NOT IN ('Verified', 'Rejected') THEN RAISE EXCEPTION 'Choose Verified or Rejected'; END IF;
  SELECT * INTO g FROM public.grade_updates WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Grade update not found'; END IF;
  IF g.status <> 'Pending' THEN RAISE EXCEPTION 'This grade update was already reviewed'; END IF;
  IF _status = 'Rejected' AND btrim(COALESCE(_note, '')) = '' THEN RAISE EXCEPTION 'Add a reason so the student knows what to fix'; END IF;

  UPDATE public.grade_updates
     SET status = _status, review_note = CASE WHEN _status = 'Rejected' THEN btrim(_note) ELSE NULL END,
         reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = _id;

  IF _status = 'Verified' THEN
    UPDATE public.profiles SET average_grade = g.grade, grade_verified_at = now(), grade_term = g.term WHERE id = g.user_id;
    PERFORM public.notify(g.user_id, 'Grade Verified', 'Your average grade of ' || trim_scale(g.grade) || ' for ' || g.term || ' was verified.',
      'success', 'verification', '/student-dashboard?section=profile', 'grade_updates', g.id);
  ELSE
    PERFORM public.notify(g.user_id, 'Grade Update Needs Attention', 'Your grade update was not accepted. Reason: ' || btrim(_note) || ' Please submit it again.',
      'warning', 'verification', '/student-dashboard?section=profile', 'grade_updates', g.id);
  END IF;
  PERFORM public.write_audit(CASE WHEN _status = 'Verified' THEN 'verify_grade' ELSE 'reject_grade' END, 'grade_updates', g.id,
    jsonb_build_object('status', 'Pending'), jsonb_build_object('status', _status, 'grade', g.grade, 'note', _note));
END;
$$;
REVOKE ALL ON FUNCTION public.review_grade_update(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_grade_update(UUID, TEXT, TEXT) TO authenticated;

-- Grade reports live in the students' own folder and, like receipts, stay uploadable / undeletable
-- after approval (a renewal needs a fresh one).
DROP POLICY IF EXISTS "documents_owner_insert" ON storage.objects;
CREATE POLICY "documents_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND ((storage.foldername(name))[2] IN ('receipts', 'grades') OR NOT public.documents_locked(auth.uid()))
  );
DROP POLICY IF EXISTS "documents_owner_delete" ON storage.objects;
CREATE POLICY "documents_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND COALESCE((storage.foldername(name))[2], '') NOT IN ('receipts', 'grades')
    AND NOT public.documents_locked(auth.uid())
  );

-- ── 6. Privacy: erasure requests ──
CREATE TABLE IF NOT EXISTS public.data_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'deletion' CHECK (kind IN ('deletion')),
  reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 1000),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed', 'Declined')),
  response TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  handled_at TIMESTAMPTZ,
  handled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS data_requests_one_pending_per_user ON public.data_requests (user_id, kind) WHERE status = 'Pending';

ALTER TABLE public.data_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Students view own data requests" ON public.data_requests;
CREATE POLICY "Students view own data requests" ON public.data_requests FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Staff view data requests" ON public.data_requests;
CREATE POLICY "Staff view data requests" ON public.data_requests FOR SELECT USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.request_account_deletion(_reason TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please log in again'; END IF;
  IF EXISTS (SELECT 1 FROM public.data_requests WHERE user_id = auth.uid() AND kind = 'deletion' AND status = 'Pending') THEN
    RAISE EXCEPTION 'You already have a deletion request waiting for the office';
  END IF;
  INSERT INTO public.data_requests (user_id, kind, reason)
  VALUES (auth.uid(), 'deletion', NULLIF(btrim(COALESCE(_reason, '')), ''))
  RETURNING id INTO new_id;
  PERFORM public.notify_admins('Account Deletion Requested', public.display_name(auth.uid()) || ' asked for their account and data to be deleted.',
    'warning', 'account', '/admin?section=students', 'data_requests', new_id);
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.request_account_deletion(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_data_request(_id UUID, _status TEXT, _response TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.data_requests%ROWTYPE;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _status NOT IN ('Completed', 'Declined') THEN RAISE EXCEPTION 'Choose Completed or Declined'; END IF;
  SELECT * INTO r FROM public.data_requests WHERE id = _id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF r.status <> 'Pending' THEN RAISE EXCEPTION 'This request was already handled'; END IF;
  IF btrim(COALESCE(_response, '')) = '' THEN RAISE EXCEPTION 'Write a response for the student'; END IF;

  UPDATE public.data_requests SET status = _status, response = btrim(_response), handled_at = now(), handled_by = auth.uid() WHERE id = _id;
  PERFORM public.notify(r.user_id, CASE WHEN _status = 'Completed' THEN 'Deletion Request Completed' ELSE 'Deletion Request Declined' END,
    btrim(_response), CASE WHEN _status = 'Completed' THEN 'success' ELSE 'info' END, 'account', '/student-dashboard?section=profile', 'data_requests', r.id);
  PERFORM public.write_audit('handle_data_request', 'data_requests', r.id,
    jsonb_build_object('status', 'Pending'), jsonb_build_object('status', _status, 'response', _response));
END;
$$;
REVOKE ALL ON FUNCTION public.handle_data_request(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_data_request(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
