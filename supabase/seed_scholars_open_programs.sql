-- ============================================================
-- Seed: 100 scholars a year for 2023-2024 and 2024-2025 in the programs open now, fully released
--
--   * Uses the scholarship programs that are open now (is_active) and have a budget, from every office
--     (Mayor Office, Barangay Affairs, MSWDO, Sangguniang Bayan). Programs aren't changed.
--   * Each school year, its 100 scholars are spread evenly over those programs.
--   * Budgets count per school year, so in each program each year the scholars' awards add up to the
--     program's budget exactly, and every term is paid (yearly once, per semester twice, monthly once a
--     month), all marked Received. Each program shows ₱0 left for 2023-2024 and for 2024-2025.
--   * Because of that, a scholar's award is the program budget ÷ its scholars that year, not the
--     program's usual award.
--
-- Run in the Supabase SQL Editor. Safe to re-run (fixed ids; a re-run resets the seed rows). Triggers on
-- the public tables are off for this transaction only: no emails or notifications go out and the
-- deadline, slot, budget and "locked once received" checks don't reject these past records. Seed
-- accounts sign in with password Student@1234 at <first>.<last>.<1000+n>@seed.sbsj.test.
--
-- If the earlier seed (seed_scholars_2023_2024.sql) is still in the database, delete it first
-- (delete_seeded_scholars.sql), or both sets count toward 2023-2024 and 2024-2025.
--
-- Undo: see the bottom of this file.
-- ============================================================

BEGIN;

ALTER TABLE public.applications DISABLE TRIGGER USER;
ALTER TABLE public.payments     DISABLE TRIGGER USER;
ALTER TABLE public.profiles     DISABLE TRIGGER USER;
ALTER TABLE public.user_roles   DISABLE TRIGGER USER;

-- ── 1. The programs open now, numbered office by office ──
CREATE TEMP TABLE seed_programs ON COMMIT DROP AS
SELECT s.id, s.name, s.office, s.total_budget,
       COALESCE(s.release_schedule, 'yearly') AS schedule,
       GREATEST(COALESCE(s.release_months, 1), 1) AS months,
       row_number() OVER (ORDER BY COALESCE(s.office, ''), s.name, s.id) AS pnum
  FROM public.scholarships s
 WHERE s.is_active AND s.total_budget > 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM seed_programs) THEN
    RAISE EXCEPTION 'No open program with a budget: open at least one program (with a budget) first';
  END IF;
END $$;

-- ── 2. 200 scholars: 1–100 in 2023-2024, 101–200 in 2024-2025, dealt out over the programs ──
CREATE TEMP TABLE seed_scholars ON COMMIT DROP AS
WITH n AS (SELECT generate_series(1, 200) AS i),
pick AS (
  SELECT
    i,
    CASE WHEN i <= 100 THEN 2023 ELSE 2024 END AS yr,
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
    round((85 + ((i * 37) % 120) / 10.0)::numeric, 1) AS average_grade
  FROM n
),
dealt AS (
  SELECT p.*, 1 + ((p.i - 1) % 100) % (SELECT count(*) FROM seed_programs) AS pnum FROM pick p
),
placed AS (
  SELECT d.*, g.id AS scholarship_id, g.total_budget, g.schedule, g.months,
         count(*)     OVER (PARTITION BY d.pnum, d.yr)                   AS in_year,
         row_number() OVER (PARTITION BY d.pnum, d.yr ORDER BY d.i) - 1  AS pos
    FROM dealt d JOIN seed_programs g ON g.pnum = d.pnum
)
SELECT
  x.*,
  ('5eed1000-0000-0000-0000-' || lpad(x.i::text, 12, '0'))::uuid AS user_id,
  ('5eed1001-0000-0000-0000-' || lpad(x.i::text, 12, '0'))::uuid AS app_id,
  x.yr || '-' || (x.yr + 1)                                       AS academic_year,
  lower(regexp_replace(x.first_name || '.' || x.last_name, '[^A-Za-z.]', '', 'g')) || '.' || (1000 + x.i)
    || '@seed.sbsj.test'                                          AS email,
  make_date(x.yr - 18 - (x.i % 4), 1 + (x.i % 12), 1 + (x.i % 28)) AS dob,
  '0917' || lpad((6000000 + x.i)::text, 7, '0')                   AS phone,
  (make_date(x.yr, 7, 1) + time '09:00' + make_interval(days => x.i % 25)) AT TIME ZONE 'Asia/Manila' AS applied_at,
  (make_date(x.yr, 8, 15) + time '14:00') AT TIME ZONE 'Asia/Manila'                                    AS approved_at,
  -- The year's award in centavos: the budget split evenly, the leftover centavos to the first scholars.
  (round(x.total_budget * 100)::bigint / x.in_year
    + CASE WHEN x.pos < round(x.total_budget * 100)::bigint % x.in_year THEN 1 ELSE 0 END)           AS year_cents,
  CASE x.schedule WHEN 'semester' THEN 2 WHEN 'monthly' THEN x.months ELSE 1 END                       AS terms
FROM placed x;

-- ── 3. Accounts (handle_new_user creates the profile and the scholar role) ──
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
SELECT user_id, user_id, user_id::text, 'email',
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
  barangay, municipality, province, school_name, course, year_level, average_grade,
  terms_accepted_at, is_active, created_at, updated_at
)
SELECT user_id, email, first_name, middle_name, last_name, sex, 'Single', 'Filipino', dob, phone,
       barangay, 'San Jose', 'Occidental Mindoro', school_name, course, year_level, average_grade,
       applied_at, true, applied_at, applied_at
FROM seed_scholars
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email, first_name = EXCLUDED.first_name, middle_name = EXCLUDED.middle_name,
  last_name = EXCLUDED.last_name, sex = EXCLUDED.sex, dob = EXCLUDED.dob, phone = EXCLUDED.phone,
  barangay = EXCLUDED.barangay, municipality = EXCLUDED.municipality, province = EXCLUDED.province,
  school_name = EXCLUDED.school_name, course = EXCLUDED.course, year_level = EXCLUDED.year_level,
  average_grade = EXCLUDED.average_grade, is_active = true,
  created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at;

-- ── 5. Applications: approved, fully received. The award is per term (the app multiplies it by the terms). ──
INSERT INTO public.applications (
  id, user_id, scholarship_id, status, disbursement_status, amount_approved, notes,
  academic_year, semester, is_renewal, school_name, course, year_level, average_grade,
  approved_at, decided_at, created_at, updated_at
)
SELECT app_id, user_id, scholarship_id, 'Approved', 'Disbursed', round(year_cents::numeric / terms) / 100, 'Requirements complete.',
       academic_year, '1st Semester', false, school_name, course, year_level, average_grade,
       approved_at, approved_at, applied_at, approved_at
FROM seed_scholars
ON CONFLICT (id) DO UPDATE SET
  user_id = EXCLUDED.user_id, scholarship_id = EXCLUDED.scholarship_id, status = EXCLUDED.status,
  disbursement_status = EXCLUDED.disbursement_status, amount_approved = EXCLUDED.amount_approved,
  academic_year = EXCLUDED.academic_year, approved_at = EXCLUDED.approved_at, decided_at = EXCLUDED.decided_at,
  created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at;

-- ── 6. Payments: every term, in cash, received. The last term takes the leftover centavos. ──
DELETE FROM public.payments WHERE id::text LIKE '5eed1002-%';
INSERT INTO public.payments (
  id, application_id, user_id, amount, method, status, academic_year, term,
  scheduled_date, disbursed_at, receipt_review_status, created_at
)
SELECT
  ('5eed1002-0000-0000-' || lpad(t.n::text, 4, '0') || '-' || lpad(x.i::text, 12, '0'))::uuid,
  x.app_id, x.user_id,
  (CASE WHEN t.n = x.terms THEN x.year_cents - (x.year_cents / x.terms) * (x.terms - 1) ELSE x.year_cents / x.terms END)::numeric / 100,
  'Cash', 'Disbursed', x.academic_year,
  CASE x.schedule WHEN 'semester' THEN (ARRAY['1st Semester', '2nd Semester'])[t.n]
                  WHEN 'monthly'  THEN 'Month ' || t.n
                  ELSE 'Yearly' END,
  d.paid::date, d.paid, 'Accepted', x.approved_at
FROM seed_scholars x
CROSS JOIN LATERAL generate_series(1, x.terms) AS t(n)
-- Released: yearly in October; per semester in October and March; monthly from September on.
CROSS JOIN LATERAL (SELECT (CASE x.schedule
    WHEN 'semester' THEN make_date(x.yr + (t.n - 1), CASE t.n WHEN 1 THEN 10 ELSE 3 END, 15)
    WHEN 'monthly'  THEN (make_date(x.yr, 9, 15) + make_interval(months => t.n - 1))::date
    ELSE make_date(x.yr, 10, 15) END + time '10:00') AT TIME ZONE 'Asia/Manila' AS paid) d;

ALTER TABLE public.applications ENABLE TRIGGER USER;
ALTER TABLE public.payments     ENABLE TRIGGER USER;
ALTER TABLE public.profiles     ENABLE TRIGGER USER;
ALTER TABLE public.user_roles   ENABLE TRIGGER USER;

-- Check: 100 scholars in each school year.
SELECT academic_year, count(*) AS scholars FROM public.applications
 WHERE id::text LIKE '5eed1001-%' GROUP BY academic_year ORDER BY academic_year;

-- Check: each program, each year: budget = received, ₱0 left.
SELECT COALESCE(s.office, 'mayor_office') AS office, s.name, a.academic_year,
       count(DISTINCT a.id) AS scholars, s.total_budget AS budget,
       sum(p.amount) AS received, s.total_budget - sum(p.amount) AS remaining
  FROM public.applications a
  JOIN public.scholarships s ON s.id = a.scholarship_id
  JOIN public.payments p     ON p.application_id = a.id AND p.status = 'Disbursed'
 WHERE a.id::text LIKE '5eed1001-%'
 GROUP BY s.id, s.office, s.name, a.academic_year, s.total_budget
 ORDER BY office, s.name, a.academic_year;

COMMIT;

-- ============================================================
-- Undo (run on its own): removes these 200 scholars and everything under them. Programs stay.
-- ============================================================
-- BEGIN;
-- ALTER TABLE public.payments DISABLE TRIGGER USER;
-- ALTER TABLE public.applications DISABLE TRIGGER USER;
-- ALTER TABLE public.profiles DISABLE TRIGGER USER;
-- ALTER TABLE public.user_roles DISABLE TRIGGER USER;
-- DELETE FROM public.payments      WHERE user_id::text LIKE '5eed1000-%';
-- DELETE FROM public.applications  WHERE user_id::text LIKE '5eed1000-%';
-- DELETE FROM public.notifications WHERE user_id::text LIKE '5eed1000-%';
-- DELETE FROM auth.users           WHERE id::text LIKE '5eed1000-%';
-- ALTER TABLE public.payments ENABLE TRIGGER USER;
-- ALTER TABLE public.applications ENABLE TRIGGER USER;
-- ALTER TABLE public.profiles ENABLE TRIGGER USER;
-- ALTER TABLE public.user_roles ENABLE TRIGGER USER;
-- COMMIT;
