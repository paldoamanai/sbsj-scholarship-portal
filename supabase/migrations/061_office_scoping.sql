-- Separates the offices (run after 060). Each program can belong to an office, and staff of an
-- office (user_roles.office) only see and act on that office's programs and everything filed under
-- them: applications, documents and their files, notes, verifications, payments, receipts, payment
-- problems, and the students who applied. The Mayor Office and staff without an office see everything.
--
-- How: RESTRICTIVE row level security policies. Postgres combines them with AND on top of whatever
-- policies a table already has (including ones on the live database that are not in this folder),
-- so the existing rules keep deciding what each role may do, and these only narrow it for office
-- staff. Students and the public have no office, so nothing changes for them.
--
-- Not covered: SECURITY DEFINER functions (the review, payment and messaging RPCs) skip row level
-- security. They still check the caller's role, and office staff never see other offices' records to
-- act on, but they don't check the office themselves.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

-- ── 1. Programs belong to an office (NULL = the Mayor Office / municipality-wide) ──
ALTER TABLE public.scholarships ADD COLUMN IF NOT EXISTS office TEXT;
ALTER TABLE public.scholarships DROP CONSTRAINT IF EXISTS scholarships_office_check;
ALTER TABLE public.scholarships ADD CONSTRAINT scholarships_office_check
  CHECK (office IS NULL OR office IN ('barangay_affairs', 'mswdo'));

-- ── 2. Helpers (SECURITY DEFINER, so they read past the policies they are used in) ──
CREATE OR REPLACE FUNCTION public.staff_office(_user UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT office FROM public.user_roles
   WHERE user_id = _user AND role::text IN ('admin', 'reviewer', 'finance_admin');
$$;

-- True when the caller may see a row that belongs to _office (NULL for "no office").
CREATE OR REPLACE FUNCTION public.office_ok(_office TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN public.staff_office(auth.uid()) IS NULL THEN true
              ELSE _office IS NOT DISTINCT FROM public.staff_office(auth.uid()) END;
$$;

CREATE OR REPLACE FUNCTION public.scholarship_office(_scholarship UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT office FROM public.scholarships WHERE id = _scholarship;
$$;

CREATE OR REPLACE FUNCTION public.application_office(_application UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.office FROM public.applications a JOIN public.scholarships s ON s.id = a.scholarship_id
   WHERE a.id = _application;
$$;

CREATE OR REPLACE FUNCTION public.payment_office(_payment UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.application_office(p.application_id) FROM public.payments p WHERE p.id = _payment;
$$;

-- True when the caller may see records about this person: no office, it's themselves, the person is
-- staff, or the person applied to one of the caller's office's programs.
CREATE OR REPLACE FUNCTION public.office_ok_person(_person UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.staff_office(auth.uid()) IS NULL
      OR _person = auth.uid()
      OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _person AND role::text <> 'student')
      OR EXISTS (
           SELECT 1 FROM public.applications a JOIN public.scholarships s ON s.id = a.scholarship_id
            WHERE a.user_id = _person AND s.office = public.staff_office(auth.uid()));
$$;

-- Files in the documents bucket: "<student id>/..." or "receipts/<payment id>/...".
CREATE OR REPLACE FUNCTION public.office_ok_file(_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _parts TEXT[] := string_to_array(_name, '/');
BEGIN
  IF public.staff_office(auth.uid()) IS NULL THEN RETURN true; END IF;
  -- Checked one step at a time: SQL doesn't promise to test the pattern before the cast.
  IF _parts[1] = 'receipts' THEN
    IF coalesce(_parts[2], '') !~ '^[0-9a-f-]{36}$' THEN RETURN false; END IF;
    RETURN public.office_ok(public.payment_office(_parts[2]::uuid));
  END IF;
  IF coalesce(_parts[1], '') !~ '^[0-9a-f-]{36}$' THEN RETURN false; END IF;
  RETURN public.office_ok_person(_parts[1]::uuid);
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_office(UUID), public.office_ok(TEXT), public.scholarship_office(UUID), public.application_office(UUID),
  public.payment_office(UUID), public.office_ok_person(UUID), public.office_ok_file(TEXT) TO anon, authenticated;

-- A program created by office staff belongs to their office.
CREATE OR REPLACE FUNCTION public.default_scholarship_office()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.staff_office(auth.uid()) IS NOT NULL THEN
    NEW.office := public.staff_office(auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_default_scholarship_office ON public.scholarships;
CREATE TRIGGER tr_default_scholarship_office
  BEFORE INSERT ON public.scholarships
  FOR EACH ROW EXECUTE FUNCTION public.default_scholarship_office();

-- ── 3. The office limits, one RESTRICTIVE policy per table ──
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('scholarships',            'public.office_ok(office)'),
    ('applications',            'public.office_ok(public.scholarship_office(scholarship_id))'),
    ('payments',                'public.office_ok(public.application_office(application_id))'),
    ('documents',               'CASE WHEN application_id IS NOT NULL THEN public.office_ok(public.application_office(application_id)) ELSE public.office_ok_person(user_id) END'),
    ('application_notes',       'public.office_ok(public.application_office(application_id))'),
    ('scholar_verifications',   'public.office_ok(public.application_office(application_id))'),
    ('payment_issues',          'public.office_ok(public.payment_office(payment_id))'),
    ('payment_receipt_numbers', 'public.office_ok(public.payment_office(payment_id))'),
    ('grade_updates',           'public.office_ok_person(user_id)'),
    ('data_requests',           'public.office_ok_person(user_id)'),
    ('profiles',                'public.office_ok_person(id)'),
    ('audit_logs',              'public.staff_office(auth.uid()) IS NULL OR user_id = auth.uid() OR public.staff_office(user_id) IS NOT DISTINCT FROM public.staff_office(auth.uid())')
  ) AS v(tbl, expr)
  LOOP
    -- Skip tables this database doesn't have.
    IF to_regclass('public.' || t.tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS "Office staff see their office" ON public.%I', t.tbl);
    EXECUTE format('CREATE POLICY "Office staff see their office" ON public.%I AS RESTRICTIVE FOR ALL USING (%s) WITH CHECK (%s)',
                   t.tbl, t.expr, t.expr);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Office staff see their office files" ON storage.objects;
CREATE POLICY "Office staff see their office files" ON storage.objects
  AS RESTRICTIVE FOR ALL
  USING (bucket_id <> 'documents' OR public.office_ok_file(name))
  WITH CHECK (bucket_id <> 'documents' OR public.office_ok_file(name));
