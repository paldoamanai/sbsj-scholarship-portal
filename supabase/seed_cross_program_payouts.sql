-- ============================================================
-- Seed: 10 already-paid scholars per program, scheduled for payout in another program
--
--   * For every program open now (is_active, with a budget), picks 10 seeded scholars who were already
--     paid (a payment marked Received) in a DIFFERENT program, and approves them in this program for
--     2026-2027 with every term Scheduled in cash. They show in Disbursement (list and Schedule view),
--     ready to mark received, while their earlier program still shows them as received.
--   * Only seeded scholars (the 5eed2000- / 5eed1000- / 5eed0000- accounts from the other seed files)
--     are used, so real accounts are never touched. Archived or inactive scholars, and scholars who
--     already have an application in that program for 2026-2027, are skipped. Run one of the scholar
--     seeds first (seed_scholars_2025_2026.sql gives the most scholars to pick from).
--   * The scholars are spread out: each program gets a different mix, though a scholar can be picked
--     for more than one program.
--   * Award per term: the program's own award (or its budget split over 10 scholars if it has none).
--     Approvals here are on top of the program's other 2026-2027 scholars, so a program can show more
--     than its budget or slots for the year.
--   * Programs that need the MOA before release (MSWDO) get a Verified MOA record for each of these
--     applications, so they can be marked received too. It's a record only, with no file behind it.
--   * Payment dates: from 16 November 2026, a few a day; later terms a month apart.
--
-- Run in the Supabase SQL Editor. Safe to re-run (fixed ids; a re-run replaces these rows). Triggers on
-- the public tables are off for this transaction only: no emails or notifications go out, and the
-- deadline, slot and budget checks don't reject these records. Marking them received later goes
-- through every normal check.
--
-- Undo: see the bottom of this file.
-- ============================================================

BEGIN;

ALTER TABLE public.applications DISABLE TRIGGER USER;
ALTER TABLE public.payments     DISABLE TRIGGER USER;
ALTER TABLE public.documents    DISABLE TRIGGER USER;

-- A re-run starts clean.
DELETE FROM public.documents    WHERE id::text LIKE '5eed3003-%';
DELETE FROM public.payments     WHERE id::text LIKE '5eed3002-%';
DELETE FROM public.applications WHERE id::text LIKE '5eed3001-%';

-- ── 1. The programs open now, numbered ──
CREATE TEMP TABLE seed_programs ON COMMIT DROP AS
SELECT s.id, s.name, s.office, s.total_budget, s.amount,
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

-- ── 2. Seeded scholars already paid, and the programs they were paid in ──
CREATE TEMP TABLE seed_paid ON COMMIT DROP AS
SELECT pr.id AS user_id,
       array_agg(DISTINCT a.scholarship_id) AS paid_in,
       pr.school_name, pr.course, pr.year_level, pr.average_grade
  FROM public.profiles pr
  JOIN public.payments p     ON p.user_id = pr.id AND p.status = 'Disbursed'
  JOIN public.applications a ON a.id = p.application_id
 WHERE pr.id::text LIKE '5eed%'
   AND pr.is_active AND pr.archived_at IS NULL
 GROUP BY pr.id, pr.school_name, pr.course, pr.year_level, pr.average_grade;

-- ── 3. For each program, 10 of them who were paid elsewhere and aren't in it yet this year ──
CREATE TEMP TABLE seed_picks ON COMMIT DROP AS
SELECT ranked.*,
       ('5eed3001-0000-0000-' || lpad(ranked.pnum::text, 4, '0') || '-' || lpad(ranked.k::text, 12, '0'))::uuid AS app_id,
       CASE ranked.schedule WHEN 'semester' THEN 2 WHEN 'monthly' THEN ranked.months ELSE 1 END AS terms,
       CASE WHEN ranked.amount > 0 THEN ranked.amount
            ELSE round(ranked.total_budget / 10 / CASE ranked.schedule WHEN 'semester' THEN 2 WHEN 'monthly' THEN ranked.months ELSE 1 END, 2)
       END AS term_amount
  FROM (
    SELECT g.id AS scholarship_id, g.pnum, g.office, g.schedule, g.months, g.amount, g.total_budget,
           sp.user_id, sp.school_name, sp.course, sp.year_level, sp.average_grade,
           row_number() OVER (PARTITION BY g.id ORDER BY md5(sp.user_id::text || g.id::text)) AS k
      FROM seed_programs g
      JOIN seed_paid sp ON NOT (g.id = ANY (sp.paid_in))
     WHERE NOT EXISTS (
       SELECT 1 FROM public.applications x
        WHERE x.user_id = sp.user_id AND x.scholarship_id = g.id AND x.academic_year = '2026-2027')
  ) ranked
 WHERE ranked.k <= 10;

-- ── 4. Approved applications in the new program ──
INSERT INTO public.applications (
  id, user_id, scholarship_id, status, disbursement_status, amount_approved, notes,
  academic_year, semester, is_renewal, school_name, course, year_level, average_grade,
  approved_at, decided_at, created_at, updated_at
)
SELECT app_id, user_id, scholarship_id, 'Approved', 'Pending', term_amount, 'Requirements complete.',
       '2026-2027', '1st Semester', false, school_name, course, year_level, average_grade,
       now(), now(), now() - interval '20 days', now()
  FROM seed_picks;

-- ── 5. Every term scheduled, in cash, ready to mark received ──
INSERT INTO public.payments (
  id, application_id, user_id, amount, method, status, academic_year, term,
  scheduled_date, receipt_review_status, created_at
)
SELECT
  ('5eed3002-0000-' || lpad(t.n::text, 4, '0') || '-' || lpad(x.pnum::text, 4, '0') || '-' || lpad(x.k::text, 12, '0'))::uuid,
  x.app_id, x.user_id, x.term_amount, 'Cash', 'Pending', '2026-2027',
  CASE x.schedule WHEN 'semester' THEN (ARRAY['1st Semester', '2nd Semester'])[t.n]
                  WHEN 'monthly'  THEN 'Month ' || t.n
                  ELSE 'Yearly' END,
  (make_date(2026, 11, 16) + ((x.k - 1) % 5)::int * 7 + make_interval(months => t.n - 1))::date,
  'Pending', now()
FROM seed_picks x
CROSS JOIN LATERAL generate_series(1, x.terms) AS t(n);

-- ── 6. A Verified MOA for programs that need one before release (MSWDO) ──
INSERT INTO public.documents (
  id, user_id, application_id, document_type, file_url, file_name, uploaded_at, status, reviewed_at
)
SELECT ('5eed3003-0000-0000-' || lpad(x.pnum::text, 4, '0') || '-' || lpad(x.k::text, 12, '0'))::uuid,
       x.user_id, x.app_id, 'MOA Agreement Letter', '', 'moa-seed.jpg', now() - interval '5 days', 'Verified', now()
  FROM seed_picks x
 WHERE public.office_requires_moa(x.office);

ALTER TABLE public.applications ENABLE TRIGGER USER;
ALTER TABLE public.payments     ENABLE TRIGGER USER;
ALTER TABLE public.documents    ENABLE TRIGGER USER;

-- Check: each program, how many paid-elsewhere scholars are now scheduled in it (10 unless it ran short).
SELECT COALESCE(g.office, 'mayor_office') AS office, g.name,
       count(DISTINCT x.user_id) AS scholars,
       count(p.id)               AS scheduled_payments,
       sum(p.amount)             AS scheduled_amount
  FROM seed_programs g
  LEFT JOIN seed_picks x    ON x.scholarship_id = g.id
  LEFT JOIN public.payments p ON p.application_id = x.app_id
 GROUP BY g.pnum, g.office, g.name
 ORDER BY g.pnum;

COMMIT;

-- ============================================================
-- Undo (run on its own): removes only what this file added. The scholars and their earlier programs stay.
-- ============================================================
-- BEGIN;
-- ALTER TABLE public.payments DISABLE TRIGGER USER;
-- ALTER TABLE public.applications DISABLE TRIGGER USER;
-- ALTER TABLE public.documents DISABLE TRIGGER USER;
-- DELETE FROM public.documents    WHERE id::text LIKE '5eed3003-%';
-- DELETE FROM public.payments     WHERE id::text LIKE '5eed3002-%';
-- DELETE FROM public.applications WHERE id::text LIKE '5eed3001-%';
-- ALTER TABLE public.payments ENABLE TRIGGER USER;
-- ALTER TABLE public.applications ENABLE TRIGGER USER;
-- ALTER TABLE public.documents ENABLE TRIGGER USER;
-- COMMIT;
