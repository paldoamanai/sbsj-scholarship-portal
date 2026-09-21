-- Template: emails every new notification through the Next.js webhook route (Resend).
-- Not a migration: fill in the two values, then run once in the Supabase SQL Editor.
-- (Equivalent to Dashboard -> Database -> Webhooks -> Create: table "notifications", event
--  INSERT, HTTP POST, header x-webhook-secret.)
--
--   <SITE_URL>        public URL of the deployed site, e.g. https://sbsj.example.com
--                     (localhost is not reachable from Supabase; use a tunnel such as ngrok to test)
--   <WEBHOOK_SECRET>  same value as NOTIFICATION_WEBHOOK_SECRET in the site's environment

CREATE TRIGGER tr_email_notifications
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request(
    '<SITE_URL>/api/webhooks/notifications',
    'POST',
    '{"Content-Type":"application/json","x-webhook-secret":"<WEBHOOK_SECRET>"}',
    '{}',
    '5000'
  );
