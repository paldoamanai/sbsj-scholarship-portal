-- Notification infrastructure:
--   * categories, deep links, entity refs and de-duplication keys on notifications
--   * per-user delivery preferences (in-app / email) per category
--   * students can delete their own notifications
--   * helper functions used by triggers to create notifications safely

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'system';
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_category_check
  CHECK (category IN ('application', 'verification', 'payment', 'program', 'account', 'system'));
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS entity_id UUID;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx
  ON public.notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);

DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
CREATE POLICY "Users can delete own notifications" ON public.notifications
  FOR DELETE USING (auth.uid() = user_id);

-- Per-user preferences. A missing row means "on".
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('application', 'verification', 'payment', 'program')),
  in_app BOOLEAN NOT NULL DEFAULT true,
  email BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, category)
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users manage own notification preferences" ON public.notification_preferences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Honor the in-app preference. Account and system notices always get through.
CREATE OR REPLACE FUNCTION public.notifications_respect_prefs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.category IN ('application', 'verification', 'payment', 'program') AND EXISTS (
    SELECT 1 FROM public.notification_preferences
     WHERE user_id = NEW.user_id AND category = NEW.category AND in_app = false
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_notifications_respect_prefs ON public.notifications;
CREATE TRIGGER tr_notifications_respect_prefs
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_respect_prefs();

-- ── Helpers (called from other SECURITY DEFINER functions, not from clients) ──
CREATE OR REPLACE FUNCTION public.notify(
  _user UUID, _title TEXT, _message TEXT, _type TEXT DEFAULT 'info', _category TEXT DEFAULT 'system',
  _link TEXT DEFAULT NULL, _entity_type TEXT DEFAULT NULL, _entity_id UUID DEFAULT NULL, _dedupe TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, message, type, category, link, entity_type, entity_id, dedupe_key)
  VALUES (_user, _title, _message, _type, _category, _link, _entity_type, _entity_id, _dedupe)
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_admins(
  _title TEXT, _message TEXT, _type TEXT DEFAULT 'info', _category TEXT DEFAULT 'system',
  _link TEXT DEFAULT NULL, _entity_type TEXT DEFAULT NULL, _entity_id UUID DEFAULT NULL, _dedupe TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_id UUID;
BEGIN
  FOR admin_id IN SELECT user_id FROM public.user_roles WHERE role = 'admin' LOOP
    PERFORM public.notify(admin_id, _title, _message, _type, _category, _link, _entity_type, _entity_id, _dedupe);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_students(
  _title TEXT, _message TEXT, _type TEXT DEFAULT 'info', _category TEXT DEFAULT 'system',
  _link TEXT DEFAULT NULL, _entity_type TEXT DEFAULT NULL, _entity_id UUID DEFAULT NULL, _dedupe TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  student_id UUID;
BEGIN
  FOR student_id IN
    SELECT ur.user_id FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role = 'student' AND p.is_active
  LOOP
    PERFORM public.notify(student_id, _title, _message, _type, _category, _link, _entity_type, _entity_id, _dedupe);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.display_name(_uid UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''), email, 'A student')
    FROM public.profiles WHERE id = _uid;
$$;

REVOKE ALL ON FUNCTION public.notify(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_admins(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_students(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.display_name(UUID) FROM PUBLIC;
