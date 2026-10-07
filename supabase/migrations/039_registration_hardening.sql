-- Registration hardening:
--
--   * a student ID number can belong to one account only (case/whitespace-insensitive). Existing
--     duplicates are left alone, but no new account or profile edit may reuse a registered ID
--   * student_id_available() lets the registration form check an ID before the account is created
--   * records when the student accepted the Terms and Privacy Policy (sent as signup metadata)
--
-- Run after 035. Safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_id(v TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(lower(regexp_replace(COALESCE(v, ''), '\s+', '', 'g')), '');
$$;

CREATE INDEX IF NOT EXISTS profiles_student_id_norm_idx
  ON public.profiles (public.normalize_id(student_id_number));

-- ── 1. One account per student ID ──
CREATE OR REPLACE FUNCTION public.guard_unique_student_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  norm TEXT := public.normalize_id(NEW.student_id_number);
BEGIN
  IF norm IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND norm IS NOT DISTINCT FROM public.normalize_id(OLD.student_id_number) THEN
    RETURN NEW;
  END IF;

  -- Serialize concurrent signups with the same ID so both can't pass the check.
  PERFORM pg_advisory_xact_lock(hashtext('student_id:' || norm));

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id <> NEW.id AND public.normalize_id(student_id_number) = norm
  ) THEN
    RAISE EXCEPTION 'This student ID number is already registered to another account'
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_guard_unique_student_id ON public.profiles;
CREATE TRIGGER tr_guard_unique_student_id
  BEFORE INSERT OR UPDATE OF student_id_number ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_unique_student_id();

-- Pre-check for the registration form (callable before signing in). Returns only yes/no.
CREATE OR REPLACE FUNCTION public.student_id_available(_student_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.normalize_id(_student_id) IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE public.normalize_id(student_id_number) = public.normalize_id(_student_id)
      AND id IS DISTINCT FROM auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.student_id_available(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_id_available(TEXT) TO anon, authenticated;

-- ── 2. Terms and Privacy Policy consent ──
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;

-- handle_new_user() doesn't know this field, so copy it from the signup metadata when the profile row
-- is first created.
CREATE OR REPLACE FUNCTION public.fill_terms_accepted_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw TEXT;
BEGIN
  IF NEW.terms_accepted_at IS NULL THEN
    SELECT raw_user_meta_data->>'terms_accepted_at' INTO raw FROM auth.users WHERE id = NEW.id;
    BEGIN
      NEW.terms_accepted_at := NULLIF(raw, '')::timestamptz;
    EXCEPTION WHEN others THEN
      NEW.terms_accepted_at := NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_fill_terms_accepted_at ON public.profiles;
CREATE TRIGGER tr_fill_terms_accepted_at
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fill_terms_accepted_at();

COMMIT;
