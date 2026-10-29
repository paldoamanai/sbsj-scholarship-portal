-- ============================================================
-- Delete EVERY scholar account (role 'student') and everything under it
--
--   * Goes: logins, profiles, applications, payments, receipt numbers, documents, grade updates,
--     notes, notifications, data requests, house pins, and any other row that points at a scholar.
--   * Stays: scholarship programs, staff accounts (every non-student role), settings, announcements,
--     audit log.
--   * Uploaded files stay in Storage (SQL can't remove them); nothing links to them any more.
--   * Triggers on the public tables are off for this transaction only: no notifications or emails go
--     out and the "disbursed payments are locked" guard doesn't block the delete.
--
-- THIS CANNOT BE UNDONE. Run step 1 first, check the numbers, then step 2.
-- ============================================================

-- ── Step 1: preview (changes nothing) ──
SELECT (SELECT count(*) FROM public.user_roles WHERE role::text = 'student') AS scholar_accounts,
       (SELECT count(*) FROM public.user_roles WHERE role::text <> 'student') AS staff_accounts_kept,
       (SELECT count(*) FROM public.applications)                             AS applications,
       (SELECT count(*) FROM public.payments)                                 AS payments,
       (SELECT count(*) FROM public.scholarships)                             AS programs_kept;

-- ── Step 2: delete (select from here to the end and run) ──
BEGIN;

ALTER TABLE public.payments     DISABLE TRIGGER USER;
ALTER TABLE public.applications DISABLE TRIGGER USER;
ALTER TABLE public.profiles     DISABLE TRIGGER USER;
ALTER TABLE public.user_roles   DISABLE TRIGGER USER;

DO $$
DECLARE _ids UUID[] := (SELECT coalesce(array_agg(user_id), '{}') FROM public.user_roles WHERE role::text = 'student');
BEGIN
  -- Rows tied to scholars' applications and payments first, then whatever points at the scholars.
  DELETE FROM public.payments     WHERE user_id = ANY (_ids);
  DELETE FROM public.applications WHERE user_id = ANY (_ids);
  PERFORM public.purge_rows_referencing('public.profiles'::regclass, _ids);
  PERFORM public.purge_rows_referencing('auth.users'::regclass, _ids);
  DELETE FROM auth.users WHERE id = ANY (_ids);
  RAISE NOTICE 'Deleted % scholar accounts', cardinality(_ids);
END $$;

ALTER TABLE public.payments     ENABLE TRIGGER USER;
ALTER TABLE public.applications ENABLE TRIGGER USER;
ALTER TABLE public.profiles     ENABLE TRIGGER USER;
ALTER TABLE public.user_roles   ENABLE TRIGGER USER;

-- Check: scholars, applications and payments should all be 0; staff and programs unchanged.
SELECT (SELECT count(*) FROM public.user_roles WHERE role::text = 'student') AS scholar_accounts,
       (SELECT count(*) FROM public.profiles p WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = p.id AND r.role::text <> 'student')) AS scholar_profiles,
       (SELECT count(*) FROM public.applications) AS applications,
       (SELECT count(*) FROM public.payments)     AS payments,
       (SELECT count(*) FROM public.user_roles WHERE role::text <> 'student') AS staff_accounts_kept,
       (SELECT count(*) FROM public.scholarships) AS programs_kept;

COMMIT;
