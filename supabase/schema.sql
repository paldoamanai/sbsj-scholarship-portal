-- Sangguniang Bayan Scholarship System — Full Database Schema
-- Run this in the Supabase SQL Editor

-- 1. Enum for roles
CREATE TYPE public.app_role AS ENUM ('admin', 'student');

-- 2. User roles table
CREATE TABLE public.user_roles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'student',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id)
);

-- 3. Student profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  first_name TEXT,
  middle_name TEXT,
  last_name TEXT,
  sex TEXT,
  civil_status TEXT,
  nationality TEXT DEFAULT 'Filipino',
  dob DATE,
  phone TEXT,
  barangay TEXT,
  municipality TEXT,
  profile_picture_url TEXT,
  school_name TEXT,
  course TEXT,
  year_level TEXT,
  average_grade NUMERIC,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Scholarship programs
CREATE TABLE public.scholarships (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  amount NUMERIC DEFAULT 0,
  slots INTEGER DEFAULT 0,
  total_budget NUMERIC DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  deadline DATE,
  eligibility TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Applications
CREATE TABLE public.applications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scholarship_id UUID REFERENCES public.scholarships(id),
  status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Waitlisted')),
  disbursement_status TEXT DEFAULT 'Pending' CHECK (disbursement_status IN ('Pending', 'Processing', 'Disbursed')),
  amount_approved NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Documents
CREATE TABLE public.documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application_id UUID REFERENCES public.applications(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Payments / Disbursements
CREATE TABLE public.payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID REFERENCES public.applications(id),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL,
  method TEXT DEFAULT 'Bank Transfer',
  reference TEXT,
  status TEXT DEFAULT 'Pending' CHECK (status IN ('Pending', 'Processing', 'Disbursed')),
  scheduled_date DATE,
  disbursed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. Notifications
CREATE TABLE public.notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning', 'error')),
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 9. Helper function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_role app_role, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

-- 10. Auto-create profile + role on signup (copies registration metadata)
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
    last_name = COALESCE(EXCLUDED.last_name, public.profiles.last_name);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'student')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 11. Row Level Security Policies

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scholarships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read/update their own, admins can read all
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins can view all profiles" ON public.profiles
  FOR SELECT USING (public.has_role('admin', auth.uid()));

-- Applications: users can manage their own, admins can manage all
CREATE POLICY "Users can view own applications" ON public.applications
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own applications" ON public.applications
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own pending applications" ON public.applications
  FOR UPDATE USING (auth.uid() = user_id AND status = 'Pending');
CREATE POLICY "Admins can view all applications" ON public.applications
  FOR SELECT USING (public.has_role('admin', auth.uid()));
CREATE POLICY "Admins can update all applications" ON public.applications
  FOR UPDATE USING (public.has_role('admin', auth.uid()));

-- Documents: users can manage their own, admins can view all
CREATE POLICY "Users can view own documents" ON public.documents
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own documents" ON public.documents
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all documents" ON public.documents
  FOR SELECT USING (public.has_role('admin', auth.uid()));

-- Payments: users can view their own, admins can manage all
CREATE POLICY "Users can view own payments" ON public.payments
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all payments" ON public.payments
  FOR SELECT USING (public.has_role('admin', auth.uid()));
CREATE POLICY "Admins can insert payments" ON public.payments
  FOR INSERT WITH CHECK (public.has_role('admin', auth.uid()));
CREATE POLICY "Admins can update payments" ON public.payments
  FOR UPDATE USING (public.has_role('admin', auth.uid()));

-- Notifications: users can view/update their own
CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admins can insert notifications" ON public.notifications
  FOR INSERT WITH CHECK (public.has_role('admin', auth.uid()));

-- Scholarships: public read, admin write
CREATE POLICY "Anyone can view active scholarships" ON public.scholarships
  FOR SELECT USING (is_active = true);
CREATE POLICY "Admins can manage scholarships" ON public.scholarships
  FOR ALL USING (public.has_role('admin', auth.uid()));

-- User roles: users can view own, admins can view all
CREATE POLICY "Users can view own role" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all roles" ON public.user_roles
  FOR SELECT USING (public.has_role('admin', auth.uid()));

-- 12. Expand roles: add sub-roles for RBAC
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'finance_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'reviewer';

-- 13. Audit logs table
CREATE TABLE public.audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  previous_value JSONB,
  new_value JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view audit logs" ON public.audit_logs
  FOR SELECT USING (
    public.has_role('admin', auth.uid())
    OR public.has_role('super_admin', auth.uid())
  );
CREATE POLICY "System can insert audit logs" ON public.audit_logs
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- 14. System settings table
CREATE TABLE public.system_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read settings" ON public.system_settings
  FOR SELECT USING (true);
CREATE POLICY "Admins can manage settings" ON public.system_settings
  FOR ALL USING (
    public.has_role('admin', auth.uid())
    OR public.has_role('super_admin', auth.uid())
  );

-- 15. Scholar verification table (external duplicate check)
CREATE TABLE public.scholar_verifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID REFERENCES public.applications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id_number TEXT,
  government_id TEXT,
  has_existing_scholarship BOOLEAN DEFAULT false,
  existing_scholarship_details TEXT,
  verification_status TEXT DEFAULT 'Pending' CHECK (verification_status IN ('Pending', 'Verified', 'Flagged', 'Cleared')),
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.scholar_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own verifications" ON public.scholar_verifications
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage verifications" ON public.scholar_verifications
  FOR ALL USING (
    public.has_role('admin', auth.uid())
    OR public.has_role('super_admin', auth.uid())
    OR public.has_role('reviewer', auth.uid())
  );

-- 16. Add student_id_number and government_id to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS student_id_number TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS government_id TEXT;

-- 17. Update has_role to support new roles
CREATE OR REPLACE FUNCTION public.has_role(_role app_role, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

-- Helper: check if user has ANY admin-level role
CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin', 'super_admin', 'finance_admin', 'reviewer')
  );
$$;

-- 18. Default system settings seed
INSERT INTO public.system_settings (key, value, description) VALUES
  ('academic_year', '"2025-2026"', 'Current academic year'),
  ('current_semester', '"1st Semester"', 'Current semester'),
  ('payment_methods', '["Bank Transfer", "E-Wallet", "Cash"]', 'Available payment methods'),
  ('email_notifications', 'true', 'Enable email notifications'),
  ('sms_notifications', 'false', 'Enable SMS notifications'),
  ('max_scholarships_per_student', '1', 'Maximum active scholarships per student'),
  ('min_grade_requirement', '85', 'Minimum grade requirement for eligibility')
ON CONFLICT (key) DO NOTHING;

-- 19. Storage buckets (run these separately in Supabase dashboard or via SQL)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('profile-pictures', 'profile-pictures', true);
-- INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false);

-- 20. Annual application limit — 1 scholarship application per student per calendar year
CREATE UNIQUE INDEX IF NOT EXISTS applications_one_per_year_per_user
  ON public.applications (user_id, (EXTRACT(YEAR FROM created_at)::INTEGER));

-- 21. Scholar verification: copy ID numbers at signup, and auto-create a
-- scholar_verifications row whenever a student submits an application.
-- Supersedes the handle_new_user() defined in section 10 now that
-- student_id_number/government_id exist (section 16).
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
  -- verification record under the same student_id_number.
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

CREATE TRIGGER tr_create_scholar_verification
  AFTER INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.create_scholar_verification();

-- 22. Scholar verification hardening (see migrations/006)
-- Scholar verification hardening:
--   * case/whitespace-insensitive duplicate matching on student ID AND government ID
--   * flags the earlier record too, and sets has_existing_scholarship when the
--     matching applicant was already approved
--   * keeps pending/flagged verification rows in sync with profile ID edits
--   * blocks approving an application until its verification is Verified/Cleared
--   * backfills verification rows for applications submitted before 005

CREATE OR REPLACE FUNCTION public.normalize_id(v TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(lower(regexp_replace(COALESCE(v, ''), '\s+', '', 'g')), '');
$$;

CREATE INDEX IF NOT EXISTS scholar_verifications_student_id_idx
  ON public.scholar_verifications (public.normalize_id(student_id_number));
CREATE INDEX IF NOT EXISTS scholar_verifications_gov_id_idx
  ON public.scholar_verifications (public.normalize_id(government_id));

CREATE OR REPLACE FUNCTION public.create_scholar_verification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  applicant public.profiles%ROWTYPE;
  dup_count INTEGER;
  has_approved BOOLEAN;
  details TEXT;
BEGIN
  SELECT * INTO applicant FROM public.profiles WHERE id = NEW.user_id;

  SELECT COUNT(*),
         COALESCE(bool_or(a.status = 'Approved'), FALSE)
    INTO dup_count, has_approved
  FROM public.scholar_verifications sv
  LEFT JOIN public.applications a ON a.id = sv.application_id
  WHERE sv.user_id <> NEW.user_id
    AND (
      (public.normalize_id(applicant.student_id_number) IS NOT NULL
        AND public.normalize_id(sv.student_id_number) = public.normalize_id(applicant.student_id_number))
      OR
      (public.normalize_id(applicant.government_id) IS NOT NULL
        AND public.normalize_id(sv.government_id) = public.normalize_id(applicant.government_id))
    );

  IF dup_count > 0 THEN
    details := format('%s other applicant(s) share this student ID or government ID%s.',
      dup_count, CASE WHEN has_approved THEN ' (at least one already approved)' ELSE '' END);

    -- Flag the earlier, still-pending records too so a reviewer sees both sides.
    UPDATE public.scholar_verifications sv
       SET verification_status = 'Flagged',
           notes = COALESCE(sv.notes || E'\n', '') || 'Auto-flagged: another applicant registered the same ID.'
     WHERE sv.user_id <> NEW.user_id
       AND sv.verification_status = 'Pending'
       AND (
         (public.normalize_id(applicant.student_id_number) IS NOT NULL
           AND public.normalize_id(sv.student_id_number) = public.normalize_id(applicant.student_id_number))
         OR
         (public.normalize_id(applicant.government_id) IS NOT NULL
           AND public.normalize_id(sv.government_id) = public.normalize_id(applicant.government_id))
       );
  END IF;

  INSERT INTO public.scholar_verifications (
    application_id, user_id, student_id_number, government_id,
    has_existing_scholarship, existing_scholarship_details, verification_status
  )
  VALUES (
    NEW.id, NEW.user_id, applicant.student_id_number, applicant.government_id,
    COALESCE(has_approved, FALSE), details,
    CASE WHEN dup_count > 0 THEN 'Flagged' ELSE 'Pending' END
  );

  RETURN NEW;
END;
$$;

-- Keep unresolved verification rows in sync when a profile's IDs change.
CREATE OR REPLACE FUNCTION public.sync_verification_ids()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.scholar_verifications
     SET student_id_number = NEW.student_id_number,
         government_id = NEW.government_id
   WHERE user_id = NEW.id
     AND verification_status IN ('Pending', 'Flagged');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_verification_ids ON public.profiles;
CREATE TRIGGER tr_sync_verification_ids
  AFTER UPDATE OF student_id_number, government_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_verification_ids();

-- Approval gate: an application can only be approved once verified/cleared.
CREATE OR REPLACE FUNCTION public.require_verification_before_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF NEW.status = 'Approved' AND OLD.status IS DISTINCT FROM 'Approved' THEN
    SELECT verification_status INTO v_status
      FROM public.scholar_verifications
     WHERE application_id = NEW.id
     ORDER BY created_at DESC LIMIT 1;

    IF v_status IS NULL OR v_status NOT IN ('Verified', 'Cleared') THEN
      RAISE EXCEPTION 'Scholar verification must be Verified or Cleared before approval (current: %)',
        COALESCE(v_status, 'none');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_require_verification_before_approval ON public.applications;
CREATE TRIGGER tr_require_verification_before_approval
  BEFORE UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.require_verification_before_approval();

-- Backfill: applications that pre-date the auto-create trigger.
INSERT INTO public.scholar_verifications (application_id, user_id, student_id_number, government_id)
SELECT a.id, a.user_id, p.student_id_number, p.government_id
  FROM public.applications a
  LEFT JOIN public.profiles p ON p.id = a.user_id
 WHERE NOT EXISTS (SELECT 1 FROM public.scholar_verifications sv WHERE sv.application_id = a.id);

-- 23. Admin activate/deactivate student (see migrations/007)
CREATE OR REPLACE FUNCTION public.set_student_active(_user_id UUID, _active BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.has_role('admin', auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF public.is_admin(_user_id) THEN
    RAISE EXCEPTION 'Only student accounts can be activated or deactivated here';
  END IF;

  UPDATE public.profiles SET is_active = _active WHERE id = _user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_student_active(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_student_active(UUID, BOOLEAN) TO authenticated;

-- 24. Scholarship program rules (see migrations/008)

ALTER TABLE public.scholarships DROP CONSTRAINT IF EXISTS scholarships_amount_nonneg;
ALTER TABLE public.scholarships ADD CONSTRAINT scholarships_amount_nonneg CHECK (amount >= 0);
ALTER TABLE public.scholarships DROP CONSTRAINT IF EXISTS scholarships_slots_nonneg;
ALTER TABLE public.scholarships ADD CONSTRAINT scholarships_slots_nonneg CHECK (slots >= 0);

CREATE OR REPLACE FUNCTION public.enforce_scholarship_open()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.scholarships%ROWTYPE;
  approved_count INTEGER;
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_scholarship_open ON public.applications;
CREATE TRIGGER tr_enforce_scholarship_open
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_scholarship_open();

CREATE OR REPLACE FUNCTION public.enforce_scholarship_slots_on_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.scholarships%ROWTYPE;
  approved_count INTEGER;
BEGIN
  IF NEW.status = 'Approved' AND OLD.status IS DISTINCT FROM 'Approved' AND NEW.scholarship_id IS NOT NULL THEN
    SELECT * INTO s FROM public.scholarships WHERE id = NEW.scholarship_id;
    IF s.slots > 0 THEN
      SELECT COUNT(*) INTO approved_count FROM public.applications
       WHERE scholarship_id = s.id AND status = 'Approved' AND id <> NEW.id;
      IF approved_count >= s.slots THEN
        RAISE EXCEPTION 'All % slots for % are already filled', s.slots, s.name;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enforce_scholarship_slots_on_approval ON public.applications;
CREATE TRIGGER tr_enforce_scholarship_slots_on_approval
  BEFORE UPDATE OF status ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_scholarship_slots_on_approval();

-- 25. Disbursement hardening (see migrations/009)

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS receipt_path TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('Pending', 'Processing', 'Disbursed', 'Cancelled'));

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_amount_positive;
ALTER TABLE public.payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0) NOT VALID;

CREATE OR REPLACE FUNCTION public.guard_payments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'Disbursed' THEN
      RAISE EXCEPTION 'Disbursed payments are locked and cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'Disbursed' THEN
    RAISE EXCEPTION 'Disbursed payments are locked';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.application_id IS NOT NULL THEN
    SELECT status INTO app_status FROM public.applications WHERE id = NEW.application_id;
    IF app_status IS DISTINCT FROM 'Approved' THEN
      RAISE EXCEPTION 'Payments can only be created for approved applications';
    END IF;
  END IF;

  IF NEW.status = 'Disbursed' THEN
    IF NEW.method NOT IN ('Cash', 'Cheque') THEN
      RAISE EXCEPTION 'Only Cash or Cheque payments can be disbursed';
    END IF;
    IF NEW.method = 'Cheque' AND COALESCE(btrim(NEW.reference), '') = '' THEN
      RAISE EXCEPTION 'A cheque number is required';
    END IF;
    IF NEW.receipt_path IS NULL THEN
      RAISE EXCEPTION 'A receipt is required before marking as disbursed';
    END IF;
    NEW.disbursed_at := COALESCE(NEW.disbursed_at, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_guard_payments ON public.payments;
CREATE TRIGGER tr_guard_payments
  BEFORE INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_payments();

CREATE OR REPLACE FUNCTION public.sync_application_disbursement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  aid UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN aid := OLD.application_id; ELSE aid := NEW.application_id; END IF;
  IF aid IS NULL THEN RETURN NULL; END IF;

  UPDATE public.applications a
     SET disbursement_status = CASE
       WHEN EXISTS (SELECT 1 FROM public.payments p WHERE p.application_id = aid AND p.status = 'Disbursed') THEN 'Disbursed'
       WHEN EXISTS (SELECT 1 FROM public.payments p WHERE p.application_id = aid AND p.status = 'Processing') THEN 'Processing'
       ELSE 'Pending'
     END
   WHERE a.id = aid;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_application_disbursement ON public.payments;
CREATE TRIGGER tr_sync_application_disbursement
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_application_disbursement();

-- Backfill existing payments.
UPDATE public.applications a
   SET disbursement_status = CASE
     WHEN EXISTS (SELECT 1 FROM public.payments p WHERE p.application_id = a.id AND p.status = 'Disbursed') THEN 'Disbursed'
     WHEN EXISTS (SELECT 1 FROM public.payments p WHERE p.application_id = a.id AND p.status = 'Processing') THEN 'Processing'
     ELSE 'Pending'
   END;

-- RLS: allow every money-handling staff role, not just 'admin'.
DROP POLICY IF EXISTS "Admins can view all payments" ON public.payments;
CREATE POLICY "Admins can view all payments" ON public.payments
  FOR SELECT USING (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "Admins can insert payments" ON public.payments;
CREATE POLICY "Admins can insert payments" ON public.payments
  FOR INSERT WITH CHECK (
    public.has_role('admin', auth.uid())
  );
DROP POLICY IF EXISTS "Admins can update payments" ON public.payments;
CREATE POLICY "Admins can update payments" ON public.payments
  FOR UPDATE USING (
    public.has_role('admin', auth.uid())
  );

-- 26. Storage policies for the documents bucket (see migrations/010)
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "documents_owner_select" ON storage.objects;
CREATE POLICY "documents_owner_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "documents_owner_insert" ON storage.objects;
CREATE POLICY "documents_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "documents_owner_update" ON storage.objects;
CREATE POLICY "documents_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "documents_staff_select" ON storage.objects;
CREATE POLICY "documents_staff_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'documents' AND public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "documents_finance_insert" ON storage.objects;
CREATE POLICY "documents_finance_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (public.has_role('admin', auth.uid()))
  );

DROP POLICY IF EXISTS "documents_finance_delete" ON storage.objects;
CREATE POLICY "documents_finance_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND (public.has_role('admin', auth.uid()))
  );

-- 27. Student payment receipt (see migrations/011)
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS student_receipt_path TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS student_receipt_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.guard_payments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'Disbursed' THEN
      RAISE EXCEPTION 'Disbursed payments are locked and cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'Disbursed' THEN
    -- Only the student's receipt columns may change once disbursed.
    IF (to_jsonb(NEW) - 'student_receipt_path' - 'student_receipt_at')
       IS DISTINCT FROM (to_jsonb(OLD) - 'student_receipt_path' - 'student_receipt_at') THEN
      RAISE EXCEPTION 'Disbursed payments are locked';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.application_id IS NOT NULL THEN
    SELECT status INTO app_status FROM public.applications WHERE id = NEW.application_id;
    IF app_status IS DISTINCT FROM 'Approved' THEN
      RAISE EXCEPTION 'Payments can only be created for approved applications';
    END IF;
  END IF;

  IF NEW.status = 'Disbursed' THEN
    IF NEW.method NOT IN ('Cash', 'Cheque') THEN
      RAISE EXCEPTION 'Only Cash or Cheque payments can be disbursed';
    END IF;
    IF NEW.method = 'Cheque' AND COALESCE(btrim(NEW.reference), '') = '' THEN
      RAISE EXCEPTION 'A cheque number is required';
    END IF;
    IF NEW.receipt_path IS NULL THEN
      RAISE EXCEPTION 'A receipt is required before marking as disbursed';
    END IF;
    NEW.disbursed_at := COALESCE(NEW.disbursed_at, now());
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_student_receipt(_payment_id UUID, _path TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay public.payments%ROWTYPE;
  student_name TEXT;
BEGIN
  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND OR pay.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;
  IF pay.status <> 'Disbursed' THEN
    RAISE EXCEPTION 'A receipt can only be submitted for a disbursed payment';
  END IF;
  IF _path NOT LIKE (auth.uid()::text || '/receipts/' || _payment_id::text || '/%') THEN
    RAISE EXCEPTION 'Invalid receipt path';
  END IF;

  UPDATE public.payments
     SET student_receipt_path = _path, student_receipt_at = now()
   WHERE id = _payment_id;

  SELECT COALESCE(NULLIF(btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''), email, 'A student')
    INTO student_name FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.notifications (user_id, title, message, type)
  SELECT user_id, 'Receipt Submitted',
         student_name || ' submitted a signed receipt for a disbursed payment.', 'info'
    FROM public.user_roles WHERE role = 'admin';
END;
$$;

REVOKE ALL ON FUNCTION public.submit_student_receipt(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_student_receipt(UUID, TEXT) TO authenticated;

-- 28. Student payment method preference (see migrations/012)
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS preferred_method TEXT;
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_preferred_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_preferred_method_check
  CHECK (preferred_method IS NULL OR preferred_method IN ('Cash', 'Cheque'));

CREATE OR REPLACE FUNCTION public.set_payment_preference(_payment_id UUID, _method TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay public.payments%ROWTYPE;
  student_name TEXT;
BEGIN
  IF _method NOT IN ('Cash', 'Cheque') THEN
    RAISE EXCEPTION 'Choose Cash or Cheque';
  END IF;

  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND OR pay.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;
  IF pay.status NOT IN ('Pending', 'Processing') THEN
    RAISE EXCEPTION 'The payment method can no longer be changed';
  END IF;
  IF pay.preferred_method IS NOT DISTINCT FROM _method THEN
    RETURN;
  END IF;

  UPDATE public.payments SET preferred_method = _method WHERE id = _payment_id;

  SELECT COALESCE(NULLIF(btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''), email, 'A student')
    INTO student_name FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.notifications (user_id, title, message, type)
  SELECT user_id, 'Payment Method Preference',
         student_name || ' prefers ' || _method || ' for a scheduled payment.', 'info'
    FROM public.user_roles WHERE role = 'admin';
END;
$$;

REVOKE ALL ON FUNCTION public.set_payment_preference(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_payment_preference(UUID, TEXT) TO authenticated;

-- 29. Cash receipt confirmation without a file (see migrations/013)
CREATE OR REPLACE FUNCTION public.submit_student_receipt(_payment_id UUID, _path TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay public.payments%ROWTYPE;
  student_name TEXT;
BEGIN
  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND OR pay.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;
  IF pay.status <> 'Disbursed' THEN
    RAISE EXCEPTION 'A receipt can only be submitted for a disbursed payment';
  END IF;

  IF _path IS NULL THEN
    IF pay.method <> 'Cash' THEN
      RAISE EXCEPTION 'Please upload the signed receipt for a cheque payment';
    END IF;
  ELSIF _path NOT LIKE (auth.uid()::text || '/receipts/' || _payment_id::text || '/%') THEN
    RAISE EXCEPTION 'Invalid receipt path';
  END IF;

  UPDATE public.payments
     SET student_receipt_path = _path, student_receipt_at = now()
   WHERE id = _payment_id;

  SELECT COALESCE(NULLIF(btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''), email, 'A student')
    INTO student_name FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.notifications (user_id, title, message, type)
  SELECT user_id,
         CASE WHEN _path IS NULL THEN 'Cash Receipt Confirmed' ELSE 'Receipt Submitted' END,
         CASE WHEN _path IS NULL
              THEN student_name || ' confirmed receiving a cash payment (no file attached).'
              ELSE student_name || ' submitted a signed receipt for a disbursed payment.' END,
         'info'
    FROM public.user_roles WHERE role = 'admin';
END;
$$;

-- 30. Student preference takes priority (see migrations/014)
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS method_override_reason TEXT;

CREATE OR REPLACE FUNCTION public.set_payment_preference(_payment_id UUID, _method TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pay public.payments%ROWTYPE;
  student_name TEXT;
BEGIN
  IF _method NOT IN ('Cash', 'Cheque') THEN
    RAISE EXCEPTION 'Choose Cash or Cheque';
  END IF;

  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND OR pay.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;
  IF pay.status NOT IN ('Pending', 'Processing') THEN
    RAISE EXCEPTION 'The payment method can no longer be changed';
  END IF;
  IF pay.preferred_method IS NOT DISTINCT FROM _method AND pay.method = _method THEN
    RETURN;
  END IF;

  UPDATE public.payments SET preferred_method = _method, method = _method WHERE id = _payment_id;

  SELECT COALESCE(NULLIF(btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''), email, 'A student')
    INTO student_name FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.notifications (user_id, title, message, type)
  SELECT user_id, 'Payment Method Preference',
         student_name || ' prefers ' || _method || ' for a scheduled payment.', 'info'
    FROM public.user_roles WHERE role = 'admin';
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_payments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'Disbursed' THEN
      RAISE EXCEPTION 'Disbursed payments are locked and cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'Disbursed' THEN
    -- Only the student's receipt columns may change once disbursed.
    IF (to_jsonb(NEW) - 'student_receipt_path' - 'student_receipt_at')
       IS DISTINCT FROM (to_jsonb(OLD) - 'student_receipt_path' - 'student_receipt_at') THEN
      RAISE EXCEPTION 'Disbursed payments are locked';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.application_id IS NOT NULL THEN
    SELECT status INTO app_status FROM public.applications WHERE id = NEW.application_id;
    IF app_status IS DISTINCT FROM 'Approved' THEN
      RAISE EXCEPTION 'Payments can only be created for approved applications';
    END IF;
  END IF;

  IF NEW.status = 'Disbursed' THEN
    IF NEW.method NOT IN ('Cash', 'Cheque') THEN
      RAISE EXCEPTION 'Only Cash or Cheque payments can be disbursed';
    END IF;
    IF NEW.method = 'Cheque' AND COALESCE(btrim(NEW.reference), '') = '' THEN
      RAISE EXCEPTION 'A cheque number is required';
    END IF;
    IF NEW.receipt_path IS NULL THEN
      RAISE EXCEPTION 'A receipt is required before marking as disbursed';
    END IF;
    IF NEW.preferred_method IS NOT NULL AND NEW.method <> NEW.preferred_method
       AND COALESCE(btrim(NEW.method_override_reason), '') = '' THEN
      RAISE EXCEPTION 'The student prefers %. Give a reason to pay by % instead', NEW.preferred_method, NEW.method;
    END IF;
    IF NEW.method = NEW.preferred_method THEN
      NEW.method_override_reason := NULL;
    END IF;
    NEW.disbursed_at := COALESCE(NEW.disbursed_at, now());
  END IF;

  RETURN NEW;
END;
$$;

-- 31. Strict student preference (see migrations/015)
CREATE OR REPLACE FUNCTION public.guard_payments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'Disbursed' THEN
      RAISE EXCEPTION 'Disbursed payments are locked and cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'Disbursed' THEN
    -- Only the student's receipt columns may change once disbursed.
    IF (to_jsonb(NEW) - 'student_receipt_path' - 'student_receipt_at')
       IS DISTINCT FROM (to_jsonb(OLD) - 'student_receipt_path' - 'student_receipt_at') THEN
      RAISE EXCEPTION 'Disbursed payments are locked';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.application_id IS NOT NULL THEN
    SELECT status INTO app_status FROM public.applications WHERE id = NEW.application_id;
    IF app_status IS DISTINCT FROM 'Approved' THEN
      RAISE EXCEPTION 'Payments can only be created for approved applications';
    END IF;
  END IF;

  IF NEW.preferred_method IS NOT NULL AND NEW.status <> 'Cancelled' AND NEW.method IS DISTINCT FROM NEW.preferred_method THEN
    RAISE EXCEPTION 'The student chose % for this payment, so the method cannot be changed', NEW.preferred_method;
  END IF;

  IF NEW.status = 'Disbursed' THEN
    IF NEW.method NOT IN ('Cash', 'Cheque') THEN
      RAISE EXCEPTION 'Only Cash or Cheque payments can be disbursed';
    END IF;
    IF NEW.method = 'Cheque' AND COALESCE(btrim(NEW.reference), '') = '' THEN
      RAISE EXCEPTION 'A cheque number is required';
    END IF;
    IF NEW.receipt_path IS NULL THEN
      RAISE EXCEPTION 'A receipt is required before marking as disbursed';
    END IF;
    NEW.disbursed_at := COALESCE(NEW.disbursed_at, now());
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE public.payments DROP COLUMN IF EXISTS method_override_reason;

-- 32. Audit log hardening (see migrations/016)
DROP POLICY IF EXISTS "System can insert audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Admins can insert audit logs" ON public.audit_logs;
CREATE POLICY "Admins can insert audit logs" ON public.audit_logs
  FOR INSERT WITH CHECK (public.has_role('admin', auth.uid()) AND user_id = auth.uid());

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs (created_at DESC);

CREATE OR REPLACE FUNCTION public.write_audit(_action TEXT, _entity TEXT, _entity_id UUID, _prev JSONB, _new JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, previous_value, new_value)
  VALUES (
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    _action, _entity, _entity_id, _prev, _new
  );
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit(TEXT, TEXT, UUID, JSONB, JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.audit_application_submitted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.write_audit('submit_application', 'applications', NEW.id, NULL,
    jsonb_build_object('scholarship_id', NEW.scholarship_id, 'status', NEW.status));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_audit_application_submitted ON public.applications;
CREATE TRIGGER tr_audit_application_submitted
  AFTER INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.audit_application_submitted();

CREATE OR REPLACE FUNCTION public.audit_payment_student_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.student_receipt_at IS DISTINCT FROM OLD.student_receipt_at AND NEW.student_receipt_at IS NOT NULL THEN
    PERFORM public.write_audit('student_submit_receipt', 'payments', NEW.id, NULL,
      jsonb_build_object('has_file', NEW.student_receipt_path IS NOT NULL, 'method', NEW.method));
  END IF;
  IF NEW.preferred_method IS DISTINCT FROM OLD.preferred_method THEN
    PERFORM public.write_audit('student_set_payment_method', 'payments', NEW.id,
      jsonb_build_object('preferred_method', OLD.preferred_method),
      jsonb_build_object('preferred_method', NEW.preferred_method));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_audit_payment_student_changes ON public.payments;
CREATE TRIGGER tr_audit_payment_student_changes
  AFTER UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.audit_payment_student_changes();

-- 33. Notification infrastructure (see migrations/017)
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'system';
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_category_check
  CHECK (category IN ('application', 'verification', 'payment', 'program', 'account', 'system'));
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS entity_id UUID;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx
  ON public.notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);

DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
CREATE POLICY "Users can delete own notifications" ON public.notifications
  FOR DELETE USING (auth.uid() = user_id);

-- Per-user preferences. A missing row means "on".
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('application', 'verification', 'payment', 'program')),
  in_app BOOLEAN NOT NULL DEFAULT true,
  email BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, category)
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users manage own notification preferences" ON public.notification_preferences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Honor the in-app preference. Account and system notices always get through.
CREATE OR REPLACE FUNCTION public.notifications_respect_prefs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.category IN ('application', 'verification', 'payment', 'program') AND EXISTS (
    SELECT 1 FROM public.notification_preferences
     WHERE user_id = NEW.user_id AND category = NEW.category AND in_app = false
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_notifications_respect_prefs ON public.notifications;
CREATE TRIGGER tr_notifications_respect_prefs
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_respect_prefs();

-- ── Helpers (called from other SECURITY DEFINER functions, not from clients) ──
CREATE OR REPLACE FUNCTION public.notify(
  _user UUID, _title TEXT, _message TEXT, _type TEXT DEFAULT 'info', _category TEXT DEFAULT 'system',
  _link TEXT DEFAULT NULL, _entity_type TEXT DEFAULT NULL, _entity_id UUID DEFAULT NULL, _dedupe TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, message, type, category, link, entity_type, entity_id, dedupe_key)
  VALUES (_user, _title, _message, _type, _category, _link, _entity_type, _entity_id, _dedupe)
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_admins(
  _title TEXT, _message TEXT, _type TEXT DEFAULT 'info', _category TEXT DEFAULT 'system',
  _link TEXT DEFAULT NULL, _entity_type TEXT DEFAULT NULL, _entity_id UUID DEFAULT NULL, _dedupe TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_id UUID;
BEGIN
  FOR admin_id IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    PERFORM public.notify(admin_id, _title, _message, _type, _category, _link, _entity_type, _entity_id, _dedupe);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_students(
  _title TEXT, _message TEXT, _type TEXT DEFAULT 'info', _category TEXT DEFAULT 'system',
  _link TEXT DEFAULT NULL, _entity_type TEXT DEFAULT NULL, _entity_id UUID DEFAULT NULL, _dedupe TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  student_id UUID;
BEGIN
  FOR student_id IN
    SELECT ur.user_id FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role = 'student' AND p.is_active
  LOOP
    PERFORM public.notify(student_id, _title, _message, _type, _category, _link, _entity_type, _entity_id, _dedupe);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.display_name(_uid UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''), email, 'A student')
    FROM public.profiles WHERE id = _uid;
$$;

REVOKE ALL ON FUNCTION public.notify(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_admins(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_students(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.display_name(UUID) FROM PUBLIC;

-- 34. Notification triggers (see migrations/018)
CREATE OR REPLACE FUNCTION public.notify_staff_new_registration()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.notify_admins('New Student Registered', public.display_name(NEW.id) || ' just created an account.',
    'info', 'account', '/admin?section=students', 'profiles', NEW.id);
  RETURN NEW;
END;
$$;

-- ── Applications ──
CREATE OR REPLACE FUNCTION public.notify_application_submitted()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sch TEXT;
BEGIN
  SELECT name INTO sch FROM public.scholarships WHERE id = NEW.scholarship_id;
  sch := COALESCE(sch, 'the scholarship');
  PERFORM public.notify(NEW.user_id, 'Application Submitted',
    'We received your application for ' || sch || '. You will be notified once it is reviewed.',
    'success', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  PERFORM public.notify_admins('New Application', public.display_name(NEW.user_id) || ' applied for ' || sch || '.',
    'info', 'application', '/admin?section=applications', 'applications', NEW.id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_notify_application_submitted ON public.applications;
CREATE TRIGGER tr_notify_application_submitted
  AFTER INSERT ON public.applications FOR EACH ROW EXECUTE FUNCTION public.notify_application_submitted();

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
  ELSIF NEW.status = 'Pending' AND OLD.status = 'Rejected' THEN
    PERFORM public.notify(NEW.user_id, 'Application Reopened', 'Your application for ' || sch || ' has been reopened for review.' || remarks,
      'info', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_notify_application_decision ON public.applications;
CREATE TRIGGER tr_notify_application_decision
  AFTER UPDATE OF status ON public.applications FOR EACH ROW EXECUTE FUNCTION public.notify_application_decision();

-- ── Verification ──
CREATE OR REPLACE FUNCTION public.notify_verification_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  by_admin BOOLEAN := COALESCE(public.has_role('admin', auth.uid()), false);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.verification_status = 'Flagged' THEN
      PERFORM public.notify_admins('Duplicate ID Flagged', public.display_name(NEW.user_id) || ' shares a student or government ID with another applicant.',
        'warning', 'verification', '/admin?section=verification', 'scholar_verifications', NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.verification_status IS NOT DISTINCT FROM OLD.verification_status THEN RETURN NEW; END IF;

  IF NOT by_admin THEN
    -- Automatic flag caused by another applicant's registration.
    IF NEW.verification_status = 'Flagged' THEN
      PERFORM public.notify_admins('Duplicate ID Flagged', public.display_name(NEW.user_id) || ' now shares an ID with a newer applicant.',
        'warning', 'verification', '/admin?section=verification', 'scholar_verifications', NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.verification_status IN ('Verified', 'Cleared') THEN
    PERFORM public.notify(NEW.user_id, 'Verification Complete', 'Your identity verification is complete.',
      'success', 'verification', '/student-dashboard?section=application', 'scholar_verifications', NEW.id);
  ELSIF NEW.verification_status = 'Flagged' THEN
    PERFORM public.notify(NEW.user_id, 'Verification Needs Attention', 'Your application needs additional review before it can proceed. The office may contact you.',
      'warning', 'verification', '/student-dashboard?section=application', 'scholar_verifications', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_notify_verification_change ON public.scholar_verifications;
CREATE TRIGGER tr_notify_verification_change
  AFTER INSERT OR UPDATE OF verification_status ON public.scholar_verifications
  FOR EACH ROW EXECUTE FUNCTION public.notify_verification_change();

-- ── Payments ──
CREATE OR REPLACE FUNCTION public.notify_payment_events()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  amt TEXT := '₱' || to_char(NEW.amount, 'FM999,999,999,990.00');
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.notify(NEW.user_id, 'Payment Scheduled',
      'A payment of ' || amt || ' has been scheduled' || COALESCE(' for ' || NEW.scheduled_date::text, '') || '. You can choose Cash or Cheque on your Disbursement page.',
      'info', 'payment', '/student-dashboard?section=disbursement', 'payments', NEW.id);
    RETURN NEW;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status = 'Processing' THEN
    PERFORM public.notify(NEW.user_id, 'Payment Processing', 'Your payment of ' || amt || ' is being processed.',
      'info', 'payment', '/student-dashboard?section=disbursement', 'payments', NEW.id);
  ELSIF NEW.status = 'Disbursed' THEN
    PERFORM public.notify(NEW.user_id, 'Payment Disbursed',
      'Your scholarship payment of ' || amt || ' has been disbursed by ' || NEW.method || '. Please submit your receipt.',
      'success', 'payment', '/student-dashboard?section=payments', 'payments', NEW.id);
  ELSIF NEW.status = 'Cancelled' THEN
    PERFORM public.notify(NEW.user_id, 'Payment Cancelled', 'Your scheduled payment of ' || amt || ' has been cancelled.',
      'warning', 'payment', '/student-dashboard?section=disbursement', 'payments', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_notify_payment_events ON public.payments;
CREATE TRIGGER tr_notify_payment_events
  AFTER INSERT OR UPDATE OF status ON public.payments FOR EACH ROW EXECUTE FUNCTION public.notify_payment_events();

-- Student receipt / method preference -> admins (replaces the inline inserts from 011-014).
CREATE OR REPLACE FUNCTION public.submit_student_receipt(_payment_id UUID, _path TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pay public.payments%ROWTYPE;
BEGIN
  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND OR pay.user_id <> auth.uid() THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF pay.status <> 'Disbursed' THEN RAISE EXCEPTION 'A receipt can only be submitted for a disbursed payment'; END IF;

  IF _path IS NULL THEN
    IF pay.method <> 'Cash' THEN RAISE EXCEPTION 'Please upload the signed receipt for a cheque payment'; END IF;
  ELSIF _path NOT LIKE (auth.uid()::text || '/receipts/' || _payment_id::text || '/%') THEN
    RAISE EXCEPTION 'Invalid receipt path';
  END IF;

  UPDATE public.payments SET student_receipt_path = _path, student_receipt_at = now() WHERE id = _payment_id;

  PERFORM public.notify_admins(
    CASE WHEN _path IS NULL THEN 'Cash Receipt Confirmed' ELSE 'Receipt Submitted' END,
    CASE WHEN _path IS NULL THEN public.display_name(auth.uid()) || ' confirmed receiving a cash payment (no file attached).'
         ELSE public.display_name(auth.uid()) || ' submitted a signed receipt for a disbursed payment.' END,
    'info', 'payment', '/admin?section=disbursement', 'payments', _payment_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_payment_preference(_payment_id UUID, _method TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pay public.payments%ROWTYPE;
BEGIN
  IF _method NOT IN ('Cash', 'Cheque') THEN RAISE EXCEPTION 'Choose Cash or Cheque'; END IF;
  SELECT * INTO pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND OR pay.user_id <> auth.uid() THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF pay.status NOT IN ('Pending', 'Processing') THEN RAISE EXCEPTION 'The payment method can no longer be changed'; END IF;
  IF pay.preferred_method IS NOT DISTINCT FROM _method AND pay.method = _method THEN RETURN; END IF;

  UPDATE public.payments SET preferred_method = _method, method = _method WHERE id = _payment_id;

  PERFORM public.notify_admins('Payment Method Preference',
    public.display_name(auth.uid()) || ' prefers ' || _method || ' for a scheduled payment.',
    'info', 'payment', '/admin?section=disbursement', 'payments', _payment_id);
END;
$$;

-- ── Account (de)activation ──
CREATE OR REPLACE FUNCTION public.set_student_active(_user_id UUID, _active BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role('admin', auth.uid()) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF public.is_admin(_user_id) THEN
    RAISE EXCEPTION 'Only student accounts can be activated or deactivated here';
  END IF;

  UPDATE public.profiles SET is_active = _active WHERE id = _user_id;

  IF _active THEN
    PERFORM public.notify(_user_id, 'Account Reactivated', 'Your account has been reactivated.', 'success', 'account', '/student-dashboard');
  ELSE
    PERFORM public.notify(_user_id, 'Account Deactivated', 'Your account has been deactivated. Please contact the scholarship office if this is a mistake.', 'warning', 'account', '/student-dashboard');
  END IF;
END;
$$;

-- ── New program open ──
CREATE OR REPLACE FUNCTION public.notify_program_open()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_active AND (TG_OP = 'INSERT' OR NOT OLD.is_active) THEN
    PERFORM public.notify_students('New Scholarship Open: ' || NEW.name,
      'Applications are now open' || COALESCE(' until ' || NEW.deadline::text, '') || '.',
      'info', 'program', '/student-dashboard?section=scholarship', 'scholarships', NEW.id, 'program-open-' || NEW.id::text);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_notify_program_open ON public.scholarships;
CREATE TRIGGER tr_notify_program_open
  AFTER INSERT OR UPDATE OF is_active ON public.scholarships FOR EACH ROW EXECUTE FUNCTION public.notify_program_open();

-- ── Scheduled reminders (each is de-duplicated, so re-running is safe) ──
CREATE OR REPLACE FUNCTION public.send_deadline_reminders()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sch RECORD;
  st UUID;
BEGIN
  FOR sch IN
    SELECT id, name, deadline FROM public.scholarships
     WHERE is_active AND deadline BETWEEN CURRENT_DATE AND CURRENT_DATE + 3
  LOOP
    FOR st IN
      SELECT ur.user_id FROM public.user_roles ur
        JOIN public.profiles p ON p.id = ur.user_id
       WHERE ur.role = 'student' AND p.is_active
         AND NOT EXISTS (
           SELECT 1 FROM public.applications a
            WHERE a.user_id = ur.user_id
              AND EXTRACT(YEAR FROM a.created_at) = EXTRACT(YEAR FROM now())
         )
    LOOP
      PERFORM public.notify(st, 'Deadline Approaching: ' || sch.name,
        'Applications close on ' || sch.deadline::text || '. Apply before then.',
        'warning', 'program', '/student-dashboard?section=scholarship', 'scholarships', sch.id,
        'deadline-' || sch.id::text || '-' || sch.deadline::text);
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_receipt_reminders()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT id, user_id, amount FROM public.payments
     WHERE status = 'Disbursed' AND student_receipt_at IS NULL AND disbursed_at < now() - interval '3 days'
  LOOP
    PERFORM public.notify(p.user_id, 'Please Submit Your Receipt',
      'Your payment of ₱' || to_char(p.amount, 'FM999,999,999,990.00') || ' was disbursed. Please upload your signed receipt or confirm receipt.',
      'warning', 'payment', '/student-dashboard?section=payments', 'payments', p.id, 'receipt-reminder-' || p.id::text);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_payment_reminders()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a RECORD;
BEGIN
  FOR a IN
    SELECT ap.id, ap.user_id FROM public.applications ap
     WHERE ap.status = 'Approved' AND ap.updated_at < now() - interval '3 days'
       AND NOT EXISTS (SELECT 1 FROM public.payments pay WHERE pay.application_id = ap.id AND pay.status <> 'Cancelled')
  LOOP
    PERFORM public.notify_admins('Approved Scholar Awaiting Payment',
      public.display_name(a.user_id) || ' was approved but has no payment scheduled.',
      'warning', 'payment', '/admin?section=funds', 'applications', a.id, 'awaiting-payment-' || a.id::text);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_scheduled_notifications()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.send_deadline_reminders();
  PERFORM public.send_receipt_reminders();
  PERFORM public.send_payment_reminders();
END;
$$;
REVOKE ALL ON FUNCTION public.send_scheduled_notifications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_deadline_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_receipt_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_payment_reminders() FROM PUBLIC;

-- Run the reminders daily at 09:00 Manila time (01:00 UTC) when pg_cron is available.
-- If this block prints a NOTICE, enable the pg_cron extension in the Supabase dashboard
-- (Database -> Extensions) and run:  SELECT cron.schedule('sbsj-reminders', '0 1 * * *', 'SELECT public.send_scheduled_notifications()');
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('sbsj-reminders', '0 1 * * *', 'SELECT public.send_scheduled_notifications()');
EXCEPTION WHEN others THEN
  RAISE NOTICE 'pg_cron not available (%). Schedule public.send_scheduled_notifications() manually.', SQLERRM;
END $$;
