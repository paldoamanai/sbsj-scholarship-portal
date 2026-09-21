-- Notification settings. Run after 026. Safe to re-run.
--   * master switches per user: email and in-app (per-category switches still apply on top)
--   * turning in-app off no longer also kills the email: a notification that is off in-app but on for email
--     is stored "muted" (hidden from the inbox, marked read) so the email webhook still fires; a
--     notification that is off in both places is dropped
--   * a rate-limited "send me a test notification"

-- ── 1. Master switches ──
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  in_app_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own settings" ON public.user_settings;
CREATE POLICY "Users manage own settings" ON public.user_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── 2. Muted notifications ──
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.notifications_respect_prefs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  in_app_off BOOLEAN;
  email_off BOOLEAN;
BEGIN
  -- Account and system notices are always delivered.
  IF NEW.category NOT IN ('application', 'verification', 'payment', 'program') THEN
    RETURN NEW;
  END IF;

  in_app_off :=
    EXISTS (SELECT 1 FROM public.user_settings WHERE user_id = NEW.user_id AND in_app_enabled = false)
    OR EXISTS (SELECT 1 FROM public.notification_preferences WHERE user_id = NEW.user_id AND category = NEW.category AND in_app = false);

  email_off :=
    NOT public.setting_bool('email_notifications', true)
    OR EXISTS (SELECT 1 FROM public.user_settings WHERE user_id = NEW.user_id AND email_enabled = false)
    OR EXISTS (SELECT 1 FROM public.notification_preferences WHERE user_id = NEW.user_id AND category = NEW.category AND email = false);

  IF in_app_off AND email_off THEN
    RETURN NULL;                       -- nothing to show and nothing to send
  ELSIF in_app_off THEN
    NEW.muted := true;                 -- keep the row so the email webhook still fires, but hide it
    NEW.read := true;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 3. Test notification (once per 10 minutes) ──
CREATE OR REPLACE FUNCTION public.send_test_notification()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bucket TEXT := 'test:' || floor(extract(epoch FROM now()) / 600)::bigint::text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please log in again'; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications WHERE user_id = auth.uid() AND dedupe_key = bucket) THEN
    RAISE EXCEPTION 'You already sent a test a moment ago. Try again in a few minutes.';
  END IF;
  PERFORM public.notify(auth.uid(), 'Test notification',
    'This is a test from your Settings. If you can read this in your inbox, email notifications are working.',
    'info', 'system', NULL, NULL, NULL, bucket);
END;
$$;
REVOKE ALL ON FUNCTION public.send_test_notification() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_test_notification() TO authenticated;

NOTIFY pgrst, 'reload schema';
