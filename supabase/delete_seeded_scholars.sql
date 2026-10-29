-- ============================================================
-- Delete the 200 seeded scholars (from seed_scholars_2023_2024.sql)
--
--   * Only rows with the seed's fixed ids are touched: accounts 5eed0000-…, applications 5eed0001-…,
--     payments 5eed0002-…. Real registrations, staff and every other program stay.
--   * The seeded programs (Alay Lakad, LGU Angat; ids 5eed0003-…) are kept unless you also run the
--     optional line in step 2.
--   * Triggers on the public tables are off for this transaction only, so the "disbursed payments
--     are locked" guard doesn't block the delete and no notifications or audit rows are written.
--
-- THIS CANNOT BE UNDONE. Run step 1 first, then step 2.
-- ============================================================

-- ── Step 1: preview (changes nothing). Expect 200 / 200 / 200. ──
SELECT (SELECT count(*) FROM auth.users          WHERE id::text LIKE '5eed0000-%') AS accounts,
       (SELECT count(*) FROM public.applications WHERE id::text LIKE '5eed0001-%') AS applications,
       (SELECT count(*) FROM public.payments     WHERE id::text LIKE '5eed0002-%') AS payments;

-- ── Step 2: delete (select from here to the end and run) ──
BEGIN;

ALTER TABLE public.payments     DISABLE TRIGGER USER;
ALTER TABLE public.applications DISABLE TRIGGER USER;
ALTER TABLE public.profiles     DISABLE TRIGGER USER;
ALTER TABLE public.user_roles   DISABLE TRIGGER USER;

DELETE FROM public.payments      WHERE user_id::text LIKE '5eed0000-%';
DELETE FROM public.applications  WHERE user_id::text LIKE '5eed0000-%';
DELETE FROM public.notifications WHERE user_id::text LIKE '5eed0000-%';
-- Profile, role and login go with the account.
DELETE FROM auth.users           WHERE id::text LIKE '5eed0000-%';

-- Optional: also delete the seeded programs (they're empty now). Remove the two dashes to include it.
-- DELETE FROM public.scholarships WHERE id::text LIKE '5eed0003-%';

ALTER TABLE public.payments     ENABLE TRIGGER USER;
ALTER TABLE public.applications ENABLE TRIGGER USER;
ALTER TABLE public.profiles     ENABLE TRIGGER USER;
ALTER TABLE public.user_roles   ENABLE TRIGGER USER;

-- Check: all 0.
SELECT (SELECT count(*) FROM auth.users          WHERE id::text LIKE '5eed0000-%') AS accounts_left,
       (SELECT count(*) FROM public.profiles     WHERE id::text LIKE '5eed0000-%') AS profiles_left,
       (SELECT count(*) FROM public.applications WHERE user_id::text LIKE '5eed0000-%') AS applications_left,
       (SELECT count(*) FROM public.payments     WHERE user_id::text LIKE '5eed0000-%') AS payments_left;

COMMIT;
