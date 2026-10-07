-- Two submissions for the same program at the same moment (double-click, two tabs) could both pass the
-- "one application per program per year" check in enforce_application_settings, because neither sees
-- the other's uncommitted row. This takes a per-student, per-program lock first, so the second insert
-- waits for the first to commit and then fails the check as it should.
--
-- Triggers fire in name order; tr_aa_* runs before tr_enforce_application_settings.
-- Run after 043. Safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION public.serialize_application_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text || ':' || COALESCE(NEW.scholarship_id::text, ''), 0));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_aa_serialize_application_insert ON public.applications;
CREATE TRIGGER tr_aa_serialize_application_insert
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.serialize_application_insert();

COMMIT;
