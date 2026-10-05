-- Scholar verification is no longer part of the admin workflow: the admin Verification section is gone,
-- so nothing can move a scholar_verifications row to Verified/Cleared any more.
--
--   * drops the approval gate from 006, which would otherwise block every approval
--   * drops the verification notifications from 018, which pointed admins at the removed section
--
-- The scholar_verifications table, its rows and the triggers that fill it are left in place, so the
-- existing history is kept. Approval still requires verified documents (see 023).
--
-- Run after 032. Safe to re-run.

DROP TRIGGER IF EXISTS tr_require_verification_before_approval ON public.applications;
DROP FUNCTION IF EXISTS public.require_verification_before_approval();

DROP TRIGGER IF EXISTS tr_notify_verification_change ON public.scholar_verifications;
DROP FUNCTION IF EXISTS public.notify_verification_change();
