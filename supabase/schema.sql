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

-- 10. Auto-create profile + role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'student');

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

-- 12. Storage buckets (run these separately in Supabase dashboard or via SQL)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('profile-pictures', 'profile-pictures', true);
-- INSERT INTO storage.buckets (id, name, public) VALUES ('documents', 'documents', false);
