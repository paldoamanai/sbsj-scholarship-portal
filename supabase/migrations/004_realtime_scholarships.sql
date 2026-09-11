-- Migration: Enable Supabase Realtime for the scholarships table so the
-- public landing page can reflect admin changes (create/update/delete/toggle
-- active) live, without a page refresh.
-- Run in the Supabase SQL Editor or:
--   npx supabase db query --linked -f supabase/migrations/004_realtime_scholarships.sql

ALTER TABLE public.scholarships REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'scholarships'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.scholarships;
  END IF;
END $$;
