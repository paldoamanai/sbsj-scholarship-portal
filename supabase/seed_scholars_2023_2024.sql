-- ============================================================
-- Seed: 200 past scholars (100 a year), fully released
--
--   * Two closed municipal programs, Alay Lakad and LGU Angat (₱10,000 a year, released once a year).
--   * 200 scholars: 100 in academic year 2023-2024 and 100 in 2024-2025, alternating between
--     the two programs, so each program has 50 scholars per year (100 in all). Each scholar has an
--     account, a profile, an Approved application, and one Disbursed payment for the full award.
--   * Budgets are per school year (the app checks each year's approvals against them), so each program's
--     budget is one year's payout, 50 × ₱10,000 = ₱500,000, and each school year has ₱0 left.
--
-- Run in the Supabase SQL Editor. Safe to re-run: a re-run resets the seed rows to what this file says,
-- so rows left by an earlier version of this seed get the right school year and program. Triggers on the public
-- tables are switched off for this transaction only, so no emails or notifications go out, the
-- "locked once disbursed" and budget/deadline guards don't reject historical rows, and no audit rows
-- are written. Seed accounts sign in with password Student@1234 at <first>.<last>.<n>@seed.sbsj.test.
--
-- Undo: see the bottom of this file.
-- ============================================================

BEGIN;

ALTER TABLE public.scholarships DISABLE TRIGGER USER;
ALTER TABLE public.applications DISABLE TRIGGER USER;
ALTER TABLE public.payments     DISABLE TRIGGER USER;
ALTER TABLE public.profiles     DISABLE TRIGGER USER;
ALTER TABLE public.user_roles   DISABLE TRIGGER USER;

-- ── 1. Programs ──
INSERT INTO public.scholarships (
  id, name, office, description, amount, slots, total_budget, is_active,
  open_date, deadline, eligibility, municipality, release_schedule, created_at
) VALUES
  (
    '5eed0003-0000-0000-0000-0000000000a1',
    'Alay Lakad', NULL,
    'Yearly educational assistance for college students from San Jose, funded by the Alay Lakad.',
    10000.00, 50, 500000.00, false,
    '2023-06-01', '2024-07-31',
    'Resident of San Jose, enrolled full-time in college', 'San Jose', 'yearly',
    '2023-05-15 09:00:00+08'
  ),
  (
    '5eed0003-0000-0000-0000-0000000000a2',
    'LGU Angat', NULL,
    'Yearly educational assistance for college students from San Jose under the LGU Angat program.',
    10000.00, 50, 500000.00, false,
    '2023-06-01', '2024-07-31',
    'Resident of San Jose, enrolled full-time in college', 'San Jose', 'yearly',
    '2023-05-15 09:00:00+08'
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, office = EXCLUDED.office, description = EXCLUDED.description,
  amount = EXCLUDED.amount, slots = EXCLUDED.slots, total_budget = EXCLUDED.total_budget,
  is_active = EXCLUDED.is_active, open_date = EXCLUDED.open_date, deadline = EXCLUDED.deadline,
  eligibility = EXCLUDED.eligibility, municipality = EXCLUDED.municipality,
  release_schedule = EXCLUDED.release_schedule, created_at = EXCLUDED.created_at;

-- ── 2. Scholars: 1–100 in 2023-2024, 101–200 in 2024-2025; odd numbers Alay Lakad, even LGU Angat ──
CREATE TEMP TABLE seed_scholars ON COMMIT DROP AS
WITH n AS (SELECT generate_series(1, 200) AS i),
pick AS (
  SELECT
    i,
    (ARRAY['Juan','Maria','Jose','Ana','Pedro','Rosa','Mark','Kristine','John Paul','Angelica',
           'Carlo','Jasmine','Miguel','Patricia','Rafael','Camille','Joshua','Nicole','Daniel','Princess',
           'Adrian','Mae','Christian','Joy','Kenneth'])[1 + (i - 1) % 25] AS first_name,
    (ARRAY['Dela Cruz','Santos','Reyes','Garcia','Mendoza','Flores','Bautista','Villanueva','Ramos','Castillo',
           'Aquino','Navarro','Torres','Gonzales','Domingo','Salazar','Mercado','Pascual','Valdez','Soriano',
           'Manalo','Fernandez','Rivera','Cruz','Morales','Lopez','Gutierrez'])[1 + ((i - 1) * 7) % 27] AS last_name,
    (ARRAY['A.','B.','C.','D.','E.','F.','G.','L.','M.','P.','R.','S.','T.','V.'])[1 + (i - 1) % 14] AS middle_name,
    CASE WHEN (i - 1) % 25 IN (1,3,5,7,9,11,13,15,17,19,21,23) THEN 'Female' ELSE 'Male' END AS sex,
    (ARRAY['Ambulong','Ansiray','Bagong Sikat','Bangkal','Barangay 1','Barangay 2','Barangay 3','Barangay 4',
           'Barangay 5','Barangay 6','Barangay 7','Barangay 8','Batasan','Bayotbot','Bubog','Buri','Camburay',
           'Caminawit','Catayungan','Central','Iling Proper','Inasakan','Ipil','La Curva','Labangan Iling',
           'Labangan Poblacion','Mabini','Magbay','Mangarin','Mapaya','Monte Claro','Murtha'])[1 + ((i - 1) * 5) % 32] AS barangay,
    (ARRAY['Occidental Mindoro State College','Divine Word College of San Jose',
           'Philippine College Foundation','Occidental Mindoro National College'])[1 + (i - 1) % 4] AS school_name,
    (ARRAY['Bachelor of Science in Information Technology','Bachelor of Science in Nursing',
           'Bachelor of Elementary Education','Bachelor of Secondary Education',
           'Bachelor of Science in Agriculture','Bachelor of Science in Criminology',
           'Bachelor of Science in Accountancy','Bachelor of Science in Civil Engineering',
           'Bachelor of Science in Business Administration'])[1 + ((i - 1) * 3) % 9] AS course,
    (ARRAY['1st Year','2nd Year','3rd Year','4th Year'])[1 + (i - 1) % 4] AS year_level,
    round((85 + ((i * 37) % 120) / 10.0)::numeric, 1) AS average_grade,
    CASE WHEN i <= 100 THEN 2023 ELSE 2024 END AS yr
  FROM n
)
SELECT
  p.*,
  ('5eed0000-0000-0000-0000-' || lpad(p.i::text, 12, '0'))::uuid AS user_id,
  ('5eed0001-0000-0000-0000-' || lpad(p.i::text, 12, '0'))::uuid AS app_id,
  ('5eed0002-0000-0000-0000-' || lpad(p.i::text, 12, '0'))::uuid AS pay_id,
  CASE WHEN p.i % 2 = 1 THEN '5eed0003-0000-0000-0000-0000000000a1'::uuid
       ELSE '5eed0003-0000-0000-0000-0000000000a2'::uuid END     AS scholarship_id,
  CASE WHEN p.i % 2 = 1 THEN 'AL' ELSE 'LA' END                   AS ref_code,
  p.yr || '-' || (p.yr + 1)                                       AS academic_year,
  lower(regexp_replace(p.first_name || '.' || p.last_name, '[^A-Za-z.]', '', 'g')) || '.' || p.i
    || '@seed.sbsj.test'                                          AS email,
  make_date(p.yr - 18 - (p.i % 4), 1 + (p.i % 12), 1 + (p.i % 28)) AS dob,
  '0917' || lpad((5000000 + p.i)::text, 7, '0')                   AS phone,
  (make_date(p.yr, 7, 1) + time '09:00' + make_interval(days => p.i % 25)) AT TIME ZONE 'Asia/Manila' AS applied_at,
  (make_date(p.yr, 8, 15) + time '14:00') AT TIME ZONE 'Asia/Manila'                                    AS approved_at,
  (make_date(p.yr, 10, 15) + time '10:00') AT TIME ZONE 'Asia/Manila'                                   AS disbursed_at
FROM pick p;

-- ── 3. Accounts (handle_new_user creates the profile and the student role) ──
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change, is_super_admin
)
SELECT
  user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
  crypt('Student@1234', gen_salt('bf')),
  applied_at, applied_at, applied_at,
  '{"provider":"email","providers":["email"]}',
  jsonb_build_object('first_name', first_name, 'last_name', last_name),
  '', '', '', '', false
FROM seed_scholars
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
SELECT
  user_id, user_id, user_id::text, 'email',
  jsonb_build_object('sub', user_id::text, 'email', email, 'email_verified', true),
  applied_at, applied_at, applied_at
FROM seed_scholars
ON CONFLICT DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT user_id, 'student' FROM seed_scholars
ON CONFLICT (user_id) DO NOTHING;

-- ── 4. Profiles ──
INSERT INTO public.profiles (
  id, email, first_name, middle_name, last_name, sex, civil_status, nationality, dob, phone,
  barangay, municipality, province,
  school_name, course, year_level, average_grade,
  terms_accepted_at, is_active, created_at, updated_at
)
SELECT
  user_id, email, first_name, middle_name, last_name, sex, 'Single', 'Filipino', dob, phone,
  barangay, 'San Jose', 'Occidental Mindoro',
  school_name, course, year_level, average_grade,
  applied_at, true, applied_at, applied_at
FROM seed_scholars
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email, first_name = EXCLUDED.first_name, middle_name = EXCLUDED.middle_name,
  last_name = EXCLUDED.last_name, sex = EXCLUDED.sex, civil_status = EXCLUDED.civil_status,
  nationality = EXCLUDED.nationality, dob = EXCLUDED.dob, phone = EXCLUDED.phone,
  barangay = EXCLUDED.barangay, municipality = EXCLUDED.municipality, province = EXCLUDED.province,
  school_name = EXCLUDED.school_name, course = EXCLUDED.course, year_level = EXCLUDED.year_level,
  average_grade = EXCLUDED.average_grade, terms_accepted_at = EXCLUDED.terms_accepted_at,
  is_active = EXCLUDED.is_active, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at;

-- ── 5. Applications: approved, fully disbursed ──
INSERT INTO public.applications (
  id, user_id, scholarship_id, status, disbursement_status, amount_approved, notes,
  academic_year, semester, is_renewal,
  school_name, course, year_level, average_grade,
  approved_at, decided_at, created_at, updated_at
)
SELECT
  app_id, user_id, scholarship_id, 'Approved', 'Disbursed', 10000.00, 'Requirements complete.',
  academic_year, '1st Semester', false,
  school_name, course, year_level, average_grade,
  approved_at, approved_at, applied_at, disbursed_at
FROM seed_scholars
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id, scholarship_id = EXCLUDED.scholarship_id, status = EXCLUDED.status,
  disbursement_status = EXCLUDED.disbursement_status, amount_approved = EXCLUDED.amount_approved,
  notes = EXCLUDED.notes, academic_year = EXCLUDED.academic_year, semester = EXCLUDED.semester,
  is_renewal = EXCLUDED.is_renewal, school_name = EXCLUDED.school_name, course = EXCLUDED.course,
  year_level = EXCLUDED.year_level, average_grade = EXCLUDED.average_grade,
  approved_at = EXCLUDED.approved_at, decided_at = EXCLUDED.decided_at,
  created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at;

-- ── 6. Payments: the full award, released in cash ──
INSERT INTO public.payments (
  id, application_id, user_id, amount, method, reference, status,
  academic_year, term, scheduled_date, disbursed_at,
  student_receipt_ref, student_receipt_at, receipt_review_status, receipt_reviewed_at,
  created_at
)
SELECT
  pay_id, app_id, user_id, 10000.00, 'Cash', ref_code || '-' || yr || '-' || lpad(i::text, 4, '0'), 'Disbursed',
  academic_year, 'Yearly', disbursed_at::date, disbursed_at,
  ref_code || '-' || yr || '-' || lpad(i::text, 4, '0'), disbursed_at, 'Accepted', disbursed_at,
  approved_at
FROM seed_scholars
ON CONFLICT (id) DO UPDATE SET
  application_id = EXCLUDED.application_id, user_id = EXCLUDED.user_id, amount = EXCLUDED.amount,
  method = EXCLUDED.method, reference = EXCLUDED.reference, status = EXCLUDED.status,
  academic_year = EXCLUDED.academic_year, term = EXCLUDED.term, scheduled_date = EXCLUDED.scheduled_date,
  disbursed_at = EXCLUDED.disbursed_at, student_receipt_ref = EXCLUDED.student_receipt_ref,
  student_receipt_at = EXCLUDED.student_receipt_at, receipt_review_status = EXCLUDED.receipt_review_status,
  receipt_reviewed_at = EXCLUDED.receipt_reviewed_at, created_at = EXCLUDED.created_at;

-- Programs left over from earlier versions of this seed (one program per year) now have no scholars.
DELETE FROM public.scholarships
 WHERE id::text LIKE '5eed0003-%'
   AND id NOT IN ('5eed0003-0000-0000-0000-0000000000a1', '5eed0003-0000-0000-0000-0000000000a2');

ALTER TABLE public.scholarships ENABLE TRIGGER USER;
ALTER TABLE public.applications ENABLE TRIGGER USER;
ALTER TABLE public.payments     ENABLE TRIGGER USER;
ALTER TABLE public.profiles     ENABLE TRIGGER USER;
ALTER TABLE public.user_roles   ENABLE TRIGGER USER;

-- Check: 100 scholars in each school year.
SELECT academic_year, count(*) AS scholars
  FROM public.applications
 WHERE id::text LIKE '5eed0001-%'
 GROUP BY academic_year
 ORDER BY academic_year;

-- Check: each program, each school year: 50 scholars, ₱500,000 budget, ₱500,000 disbursed, ₱0 left.
SELECT s.name, a.academic_year, s.total_budget,
       count(p.id)                     AS scholars,
       sum(p.amount)                   AS disbursed,
       s.total_budget - sum(p.amount)  AS remaining
  FROM public.scholarships s
  JOIN public.applications a ON a.scholarship_id = s.id
  JOIN public.payments p     ON p.application_id = a.id AND p.status = 'Disbursed'
 WHERE s.id IN ('5eed0003-0000-0000-0000-0000000000a1', '5eed0003-0000-0000-0000-0000000000a2')
 GROUP BY s.id, s.name, a.academic_year, s.total_budget
 ORDER BY s.name, a.academic_year;

COMMIT;

-- ============================================================
-- Undo (run on its own). Deleting the accounts removes their profiles, roles, applications and
-- payments through the foreign keys; triggers are off so disbursed payments can be deleted.
-- ============================================================
-- BEGIN;
-- ALTER TABLE public.payments DISABLE TRIGGER USER;
-- ALTER TABLE public.applications DISABLE TRIGGER USER;
-- ALTER TABLE public.profiles DISABLE TRIGGER USER;
-- ALTER TABLE public.user_roles DISABLE TRIGGER USER;
-- ALTER TABLE public.scholarships DISABLE TRIGGER USER;
-- DELETE FROM public.payments     WHERE id::text LIKE '5eed0002-%';
-- DELETE FROM public.applications WHERE id::text LIKE '5eed0001-%';
-- DELETE FROM auth.users          WHERE id::text LIKE '5eed0000-%';
-- DELETE FROM public.scholarships WHERE id::text LIKE '5eed0003-%';
-- ALTER TABLE public.payments ENABLE TRIGGER USER;
-- ALTER TABLE public.applications ENABLE TRIGGER USER;
-- ALTER TABLE public.profiles ENABLE TRIGGER USER;
-- ALTER TABLE public.user_roles ENABLE TRIGGER USER;
-- ALTER TABLE public.scholarships ENABLE TRIGGER USER;
-- COMMIT;
