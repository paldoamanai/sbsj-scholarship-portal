-- Migration: Enforce 1 scholarship application per student per calendar year
-- Run this in the Supabase SQL Editor or via: npx supabase db query --linked -f supabase/migrations/001_annual_application_limit.sql

-- 1. Add a plain integer column to store the calendar year of the application.
--    Using a plain column (not an expression index) avoids the IMMUTABLE restriction
--    that PostgreSQL imposes on index expressions involving TIMESTAMPTZ.
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS year_applied INTEGER;

-- 2. Backfill existing rows using UTC year of created_at.
UPDATE public.applications
SET year_applied = EXTRACT(YEAR FROM (created_at AT TIME ZONE 'UTC'))::INTEGER
WHERE year_applied IS NULL;

-- 3. Auto-populate year_applied on every new INSERT via a trigger.
CREATE OR REPLACE FUNCTION public.set_application_year()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.year_applied IS NULL THEN
    NEW.year_applied := EXTRACT(YEAR FROM CURRENT_TIMESTAMP)::INTEGER;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_applications_set_year ON public.applications;

CREATE TRIGGER tr_applications_set_year
  BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.set_application_year();

-- 4. Remove duplicate rows for the same user in the same year,
--    keeping only the most-recent application.
DELETE FROM public.applications a
USING public.applications b
WHERE a.user_id      = b.user_id
  AND a.year_applied = b.year_applied
  AND a.created_at   < b.created_at;

-- 5. Create the unique constraint on the plain column (no expression = no IMMUTABLE issue).
CREATE UNIQUE INDEX IF NOT EXISTS applications_one_per_year_per_user
  ON public.applications (user_id, year_applied)
  WHERE year_applied IS NOT NULL;

-- 6. (Optional) Update system_settings if the table exists.
--    Uncomment the lines below if you have the system_settings table set up.
-- INSERT INTO public.system_settings (key, value, description)
-- VALUES ('max_scholarships_per_student', '1', 'Maximum scholarship applications per student per calendar year')
-- ON CONFLICT (key) DO UPDATE
--   SET value       = '1',
--       description = 'Maximum scholarship applications per student per calendar year';
