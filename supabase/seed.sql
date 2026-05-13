-- ============================================================
-- SBSJ Scholarship Portal — Sample Data Seed
-- Run this in the Supabase SQL Editor (after schema.sql)
-- ============================================================

-- Fixed UUIDs for consistent references
-- admin:    a0000000-0000-0000-0000-000000000001
-- student1: b0000000-0000-0000-0000-000000000001
-- student2: b0000000-0000-0000-0000-000000000002
-- student3: b0000000-0000-0000-0000-000000000003
-- student4: b0000000-0000-0000-0000-000000000004
-- student5: b0000000-0000-0000-0000-000000000005

-- ============================================================
-- 1. Insert into auth.users (requires service role / SQL editor)
-- ============================================================
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new,
  email_change, is_super_admin
) VALUES
  (
    'a0000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'admin@sbsj.gov.ph',
    crypt('Admin@1234', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}',
    '', '', '', '', false
  ),
  (
    'b0000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'juan.dela.cruz@email.com',
    crypt('Student@1234', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}',
    '', '', '', '', false
  ),
  (
    'b0000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'maria.santos@email.com',
    crypt('Student@1234', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}',
    '', '', '', '', false
  ),
  (
    'b0000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'pedro.reyes@email.com',
    crypt('Student@1234', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}',
    '', '', '', '', false
  ),
  (
    'b0000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'ana.garcia@email.com',
    crypt('Student@1234', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}',
    '', '', '', '', false
  ),
  (
    'b0000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'jose.flores@email.com',
    crypt('Student@1234', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}',
    '', '', '', '', false
  )
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 2. User Roles
-- ============================================================
INSERT INTO public.user_roles (user_id, role) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin'),
  ('b0000000-0000-0000-0000-000000000001', 'student'),
  ('b0000000-0000-0000-0000-000000000002', 'student'),
  ('b0000000-0000-0000-0000-000000000003', 'student'),
  ('b0000000-0000-0000-0000-000000000004', 'student'),
  ('b0000000-0000-0000-0000-000000000005', 'student')
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================
-- 3. Profiles
-- ============================================================
INSERT INTO public.profiles (
  id, email, first_name, middle_name, last_name,
  sex, civil_status, nationality, dob, phone,
  barangay, municipality,
  school_name, course, year_level, average_grade,
  is_active
) VALUES
  (
    'a0000000-0000-0000-0000-000000000001',
    'admin@sbsj.gov.ph', 'Ricardo', 'B.', 'Mendoza',
    'Male', 'Married', 'Filipino', '1985-03-15', '09171234001',
    'Poblacion', 'San Jose',
    NULL, NULL, NULL, NULL,
    true
  ),
  (
    'b0000000-0000-0000-0000-000000000001',
    'juan.dela.cruz@email.com', 'Juan', 'P.', 'Dela Cruz',
    'Male', 'Single', 'Filipino', '2003-06-12', '09181234001',
    'Brgy. Sto. Niño', 'San Jose',
    'San Jose Community College', 'Bachelor of Science in Information Technology', '3rd Year', 91.5,
    true
  ),
  (
    'b0000000-0000-0000-0000-000000000002',
    'maria.santos@email.com', 'Maria', 'L.', 'Santos',
    'Female', 'Single', 'Filipino', '2004-01-20', '09181234002',
    'Brgy. San Roque', 'San Jose',
    'Nueva Ecija University of Science and Technology', 'Bachelor of Science in Nursing', '2nd Year', 88.0,
    true
  ),
  (
    'b0000000-0000-0000-0000-000000000003',
    'pedro.reyes@email.com', 'Pedro', 'A.', 'Reyes',
    'Male', 'Single', 'Filipino', '2002-09-05', '09181234003',
    'Brgy. Malapit', 'San Jose',
    'Wesleyan University Philippines', 'Bachelor of Science in Agriculture', '4th Year', 85.5,
    true
  ),
  (
    'b0000000-0000-0000-0000-000000000004',
    'ana.garcia@email.com', 'Ana', 'R.', 'Garcia',
    'Female', 'Single', 'Filipino', '2005-04-18', '09181234004',
    'Brgy. Dicarma', 'San Jose',
    'San Jose Community College', 'Bachelor of Elementary Education', '1st Year', 93.0,
    true
  ),
  (
    'b0000000-0000-0000-0000-000000000005',
    'jose.flores@email.com', 'Jose', 'M.', 'Flores',
    'Male', 'Single', 'Filipino', '2003-11-30', '09181234005',
    'Brgy. Platero', 'San Jose',
    'Nueva Ecija University of Science and Technology', 'Bachelor of Science in Civil Engineering', '3rd Year', 87.5,
    true
  )
ON CONFLICT (id) DO UPDATE SET
  first_name    = EXCLUDED.first_name,
  last_name     = EXCLUDED.last_name,
  school_name   = EXCLUDED.school_name,
  course        = EXCLUDED.course,
  year_level    = EXCLUDED.year_level,
  average_grade = EXCLUDED.average_grade,
  is_active     = EXCLUDED.is_active;

-- ============================================================
-- 4. Scholarship Programs
-- ============================================================
INSERT INTO public.scholarships (
  id, name, description, amount, slots, total_budget,
  is_active, deadline, eligibility
) VALUES
  (
    'c0000000-0000-0000-0000-000000000001',
    'SB Academic Excellence Grant',
    'Awarded to students with outstanding academic performance enrolled in accredited colleges and universities. Recipients must maintain a GPA of 88 or above each semester.',
    10000.00, 20, 200000.00, true,
    '2026-06-30',
    'Filipino citizen, resident of San Jose, enrolled full-time, GPA ≥ 88, no existing scholarship'
  ),
  (
    'c0000000-0000-0000-0000-000000000002',
    'SB Indigent Student Assistance Program',
    'Financial assistance for students from low-income families to help cover tuition and other educational expenses.',
    7500.00, 30, 225000.00, true,
    '2026-07-15',
    'Filipino citizen, resident of San Jose, enrolled full-time, household income ≤ PHP 15,000/month, 4Ps beneficiary or DSWD-certified indigent'
  ),
  (
    'c0000000-0000-0000-0000-000000000003',
    'SB STEM Scholarship',
    'Supports students pursuing degrees in Science, Technology, Engineering, and Mathematics to address local workforce needs.',
    12000.00, 10, 120000.00, true,
    '2026-06-15',
    'Filipino citizen, resident of San Jose, enrolled in a STEM course, GPA ≥ 85, passed technical aptitude assessment'
  ),
  (
    'c0000000-0000-0000-0000-000000000004',
    'SB Special Needs Education Fund',
    'Dedicated scholarship for students with disabilities (PWD) to ensure equal access to higher education.',
    8000.00, 5, 40000.00, true,
    '2026-08-01',
    'Filipino citizen, resident of San Jose, registered PWD with valid PWD ID, enrolled full-time'
  )
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 5. Applications
-- ============================================================
INSERT INTO public.applications (
  id, user_id, scholarship_id, status, disbursement_status,
  amount_approved, notes, created_at, updated_at
) VALUES
  -- Juan: Approved for Academic Excellence
  (
    'd0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'Approved', 'Disbursed',
    10000.00,
    'All requirements complete. Grade verified by school registrar.',
    '2026-02-10 09:00:00+08', '2026-03-05 14:00:00+08'
  ),
  -- Maria: Approved for Indigent
  (
    'd0000000-0000-0000-0000-000000000002',
    'b0000000-0000-0000-0000-000000000002',
    'c0000000-0000-0000-0000-000000000002',
    'Approved', 'Processing',
    7500.00,
    'DSWD certification verified. Disbursement scheduled.',
    '2026-02-12 10:30:00+08', '2026-04-01 09:00:00+08'
  ),
  -- Pedro: Pending for STEM
  (
    'd0000000-0000-0000-0000-000000000003',
    'b0000000-0000-0000-0000-000000000003',
    'c0000000-0000-0000-0000-000000000003',
    'Pending', 'Pending',
    NULL,
    NULL,
    '2026-04-20 11:00:00+08', '2026-04-20 11:00:00+08'
  ),
  -- Ana: Pending for Academic Excellence
  (
    'd0000000-0000-0000-0000-000000000004',
    'b0000000-0000-0000-0000-000000000004',
    'c0000000-0000-0000-0000-000000000001',
    'Pending', 'Pending',
    NULL,
    NULL,
    '2026-04-25 08:45:00+08', '2026-04-25 08:45:00+08'
  ),
  -- Jose: Rejected for STEM (missed aptitude test)
  (
    'd0000000-0000-0000-0000-000000000005',
    'b0000000-0000-0000-0000-000000000005',
    'c0000000-0000-0000-0000-000000000003',
    'Rejected', 'Pending',
    NULL,
    'Applicant did not complete the required technical aptitude assessment.',
    '2026-03-01 13:00:00+08', '2026-03-20 10:00:00+08'
  ),
  -- Juan: second application for STEM (Waitlisted)
  (
    'd0000000-0000-0000-0000-000000000006',
    'b0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000002',
    'Waitlisted', 'Pending',
    NULL,
    'Slots are full. Applicant added to waitlist.',
    '2026-03-10 09:00:00+08', '2026-03-15 11:00:00+08'
  )
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 6. Documents (metadata only — no actual files)
-- ============================================================
INSERT INTO public.documents (
  id, user_id, application_id, document_type,
  file_url, file_name, uploaded_at
) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Certificate of Enrollment',      '/sample/juan_enrollment.pdf',    'juan_enrollment.pdf',    '2026-02-10 09:05:00+08'),
  ('e0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Official Transcript of Records', '/sample/juan_tor.pdf',           'juan_tor.pdf',           '2026-02-10 09:06:00+08'),
  ('e0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Barangay Certificate',           '/sample/juan_barangay.pdf',      'juan_barangay.pdf',      '2026-02-10 09:07:00+08'),
  ('e0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'Certificate of Enrollment',      '/sample/maria_enrollment.pdf',   'maria_enrollment.pdf',   '2026-02-12 10:35:00+08'),
  ('e0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'DSWD Certification',             '/sample/maria_dswd.pdf',         'maria_dswd.pdf',         '2026-02-12 10:36:00+08'),
  ('e0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'Income Certificate',             '/sample/maria_income.pdf',       'maria_income.pdf',       '2026-02-12 10:37:00+08'),
  ('e0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', 'Certificate of Enrollment',      '/sample/pedro_enrollment.pdf',   'pedro_enrollment.pdf',   '2026-04-20 11:05:00+08'),
  ('e0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000004', 'Certificate of Enrollment',      '/sample/ana_enrollment.pdf',     'ana_enrollment.pdf',     '2026-04-25 08:50:00+08'),
  ('e0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000004', 'Official Transcript of Records', '/sample/ana_tor.pdf',            'ana_tor.pdf',            '2026-04-25 08:52:00+08'),
  ('e0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000005', 'Certificate of Enrollment',      '/sample/jose_enrollment.pdf',    'jose_enrollment.pdf',    '2026-03-01 13:05:00+08')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 7. Payments / Disbursements
-- ============================================================
INSERT INTO public.payments (
  id, application_id, user_id, amount,
  method, reference, status,
  scheduled_date, disbursed_at, created_at
) VALUES
  (
    'f0000000-0000-0000-0000-000000000001',
    'd0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    10000.00, 'Bank Transfer', 'REF-2026-BT-00101', 'Disbursed',
    '2026-03-10', '2026-03-10 10:00:00+08', '2026-03-05 14:00:00+08'
  ),
  (
    'f0000000-0000-0000-0000-000000000002',
    'd0000000-0000-0000-0000-000000000002',
    'b0000000-0000-0000-0000-000000000002',
    7500.00, 'E-Wallet', 'REF-2026-EW-00202', 'Processing',
    '2026-04-15', NULL, '2026-04-01 09:00:00+08'
  )
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 8. Notifications
-- ============================================================
INSERT INTO public.notifications (
  id, user_id, title, message, type, read, created_at
) VALUES
  (
    '10000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'Application Approved',
    'Congratulations! Your application for the SB Academic Excellence Grant has been approved. Your scholarship amount of PHP 10,000 will be disbursed on March 10, 2026.',
    'success', true, '2026-03-05 14:05:00+08'
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    'b0000000-0000-0000-0000-000000000001',
    'Disbursement Completed',
    'Your scholarship grant of PHP 10,000 has been transferred to your registered bank account. Reference number: REF-2026-BT-00101.',
    'success', true, '2026-03-10 10:05:00+08'
  ),
  (
    '10000000-0000-0000-0000-000000000003',
    'b0000000-0000-0000-0000-000000000001',
    'Waitlist Notice',
    'Your application for the SB Indigent Student Assistance Program has been added to the waitlist. You will be notified if a slot becomes available.',
    'warning', false, '2026-03-15 11:05:00+08'
  ),
  (
    '10000000-0000-0000-0000-000000000004',
    'b0000000-0000-0000-0000-000000000002',
    'Application Approved',
    'Your application for the SB Indigent Student Assistance Program has been approved. Disbursement is being processed.',
    'success', true, '2026-04-01 09:05:00+08'
  ),
  (
    '10000000-0000-0000-0000-000000000005',
    'b0000000-0000-0000-0000-000000000002',
    'Disbursement in Progress',
    'Your scholarship payment of PHP 7,500 is currently being processed via E-Wallet. Expected release: April 15, 2026.',
    'info', false, '2026-04-01 09:10:00+08'
  ),
  (
    '10000000-0000-0000-0000-000000000006',
    'b0000000-0000-0000-0000-000000000003',
    'Application Received',
    'We have received your application for the SB STEM Scholarship. Our team will review it shortly.',
    'info', false, '2026-04-20 11:10:00+08'
  ),
  (
    '10000000-0000-0000-0000-000000000007',
    'b0000000-0000-0000-0000-000000000004',
    'Application Received',
    'We have received your application for the SB Academic Excellence Grant. Our team will review it shortly.',
    'info', false, '2026-04-25 09:00:00+08'
  ),
  (
    '10000000-0000-0000-0000-000000000008',
    'b0000000-0000-0000-0000-000000000005',
    'Application Rejected',
    'We regret to inform you that your application for the SB STEM Scholarship has been rejected. Reason: Applicant did not complete the required technical aptitude assessment. You may reapply next semester.',
    'error', false, '2026-03-20 10:05:00+08'
  )
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 9. Scholar Verifications
-- ============================================================
INSERT INTO public.scholar_verifications (
  id, application_id, user_id,
  has_existing_scholarship, existing_scholarship_details,
  verification_status, verified_by, verified_at, notes
) VALUES
  (
    '20000000-0000-0000-0000-000000000001',
    'd0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    false, NULL,
    'Verified', 'a0000000-0000-0000-0000-000000000001',
    '2026-02-28 10:00:00+08',
    'No duplicate scholarship found. Student ID and government ID verified.'
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    'd0000000-0000-0000-0000-000000000002',
    'b0000000-0000-0000-0000-000000000002',
    false, NULL,
    'Verified', 'a0000000-0000-0000-0000-000000000001',
    '2026-03-25 11:00:00+08',
    'Documents authentic. DSWD certification confirmed.'
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    'd0000000-0000-0000-0000-000000000003',
    'b0000000-0000-0000-0000-000000000003',
    false, NULL,
    'Pending', NULL, NULL,
    'Awaiting review.'
  )
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 10. Audit Logs
-- ============================================================
INSERT INTO public.audit_logs (
  id, user_id, user_email, action, entity_type, entity_id,
  previous_value, new_value, created_at
) VALUES
  (
    '30000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'admin@sbsj.gov.ph',
    'UPDATE_APPLICATION_STATUS', 'applications',
    'd0000000-0000-0000-0000-000000000001',
    '{"status":"Pending"}', '{"status":"Approved","amount_approved":10000}',
    '2026-03-05 14:00:00+08'
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'admin@sbsj.gov.ph',
    'UPDATE_DISBURSEMENT_STATUS', 'payments',
    'f0000000-0000-0000-0000-000000000001',
    '{"status":"Pending"}', '{"status":"Disbursed","disbursed_at":"2026-03-10T02:00:00+00:00"}',
    '2026-03-10 10:00:00+08'
  ),
  (
    '30000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000001',
    'admin@sbsj.gov.ph',
    'UPDATE_APPLICATION_STATUS', 'applications',
    'd0000000-0000-0000-0000-000000000002',
    '{"status":"Pending"}', '{"status":"Approved","amount_approved":7500}',
    '2026-04-01 09:00:00+08'
  ),
  (
    '30000000-0000-0000-0000-000000000004',
    'a0000000-0000-0000-0000-000000000001',
    'admin@sbsj.gov.ph',
    'UPDATE_APPLICATION_STATUS', 'applications',
    'd0000000-0000-0000-0000-000000000005',
    '{"status":"Pending"}', '{"status":"Rejected","notes":"Applicant did not complete the required technical aptitude assessment."}',
    '2026-03-20 10:00:00+08'
  )
ON CONFLICT (id) DO NOTHING;
