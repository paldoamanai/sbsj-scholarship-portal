-- Migration: Enable Supabase Realtime for live notification / status updates
-- Run this in the Supabase SQL Editor or via: npx supabase db query --linked -f supabase/migrations/002_enable_realtime.sql

-- 1. Ensure full row data is available on UPDATE events (new values are always
--    sent; FULL also gives old values, useful for future diffing).
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER TABLE public.applications  REPLICA IDENTITY FULL;
ALTER TABLE public.payments      REPLICA IDENTITY FULL;

-- 2. Add the tables to the supabase_realtime publication so postgres_changes
--    subscriptions receive INSERT/UPDATE events for them. Guarded so this is
--    safe to re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'applications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.applications;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'payments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
  END IF;
END $$;
