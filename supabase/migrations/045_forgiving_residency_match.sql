-- Residency rules compared the student's free-text municipality to the program's exactly (ignoring case
-- and outer spaces), so "Labangan, Zamboanga del Sur", "Municipality of Labangan" or "Pagadian City"
-- failed a "Labangan" / "Pagadian" program. Both sides are now reduced with normalize_town(): the part
-- before the first comma, lowercased, punctuation collapsed, and "municipality/city/town of" and a
-- trailing "municipality/city" dropped. Same as normalizeTown() in src/lib/scholarships.ts.
--
-- Affects applying (enforce_scholarship_open), approval (require_program_requirements_on_approval) and
-- reminders (student_eligible_for). Run after 044. Safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_town(v TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(regexp_replace(
           btrim(regexp_replace(lower(split_part(COALESCE(v, ''), ',', 1)), '[^[:alnum:]]+', ' ', 'g')),
           '^(municipality|city|town) of ', ''),
         ' (municipality|city)$', '');
$$;

-- Rebuilt from the live definitions (as in 035), so only the comparison changes.
DO $$
DECLARE
  f RECORD;
  def TEXT;
  patched TEXT;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.proname IN ('enforce_scholarship_open', 'require_program_requirements_on_approval', 'student_eligible_for')
  LOOP
    def := pg_get_functiondef(f.oid);
    patched := replace(def,
      'lower(btrim(COALESCE(prof.municipality, ''''))) <> lower(btrim(s.municipality))',
      'public.normalize_town(prof.municipality) <> public.normalize_town(s.municipality)');
    patched := replace(patched,
      'lower(btrim(COALESCE(p.municipality, ''''))) = lower(btrim(s.municipality))',
      'public.normalize_town(p.municipality) = public.normalize_town(s.municipality)');
    IF patched <> def THEN
      EXECUTE patched;
    ELSIF position('normalize_town' IN def) = 0 THEN
      RAISE EXCEPTION 'Could not find the residency check in %; update it by hand', f.proname;
    END IF;
  END LOOP;
END $$;

COMMIT;
