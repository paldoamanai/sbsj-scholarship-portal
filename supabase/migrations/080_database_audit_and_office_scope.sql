-- The audit log is written by the database, and office Admins act only on their own office's students.
--
--   * Audit entries for staff changes to programs, applications, payments and their own profile are now
--     written by triggers in the same transaction as the change. Before, the admin panel wrote them
--     afterwards, so a failed write (or a closed tab) left a change with no entry. Now the change and its
--     entry are saved together or not at all. Entries keep the action names the panel used, so reports
--     and filters read them the same way.
--   * Settings are saved by save_settings(), all changed keys at once: if one is refused, none are saved.
--     It writes the audit entries in the same transaction.
--   * set_student_active() refuses students outside an office Admin's office (061's office_ok_person),
--     like the rest of the office scoping. The admin API checks the same for its other account actions.
--
-- Changes students make, and changes made by other triggers, are not logged here (some already have
-- entries of their own, see 016). Review, messaging and home-visit functions keep writing their own.
--
-- Run in the Supabase SQL Editor after 079. Safe to re-run.

BEGIN;

-- ── 1. Writing an entry: who, from which browser ──
CREATE OR REPLACE FUNCTION public.audit_staff_change(_action TEXT, _entity TEXT, _entity_id UUID, _prev JSONB, _new JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, previous_value, new_value, user_agent)
  VALUES (
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    _action, _entity, _entity_id, _prev, _new,
    -- PostgREST passes the request headers; absent outside an API request.
    left(nullif(current_setting('request.headers', true), '')::json ->> 'user-agent', 250)
  );
END;
$$;

-- A change made by staff directly, not by a trigger reacting to some other change.
CREATE OR REPLACE FUNCTION public.audited_staff_change()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND pg_trigger_depth() <= 1 AND public.is_staff(auth.uid());
$$;

-- The columns that differ between two rows, with their new values (old values when _old_side).
CREATE OR REPLACE FUNCTION public.changed_columns(_old JSONB, _new JSONB, _old_side BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(jsonb_object_agg(n.key, CASE WHEN _old_side THEN _old -> n.key ELSE n.value END), '{}'::jsonb)
    FROM jsonb_each(_new) n
   WHERE n.value IS DISTINCT FROM _old -> n.key AND n.key NOT IN ('updated_at', 'updated_by');
$$;

REVOKE ALL ON FUNCTION public.audit_staff_change(TEXT, TEXT, UUID, JSONB, JSONB), public.audited_staff_change()
  FROM PUBLIC, anon, authenticated;

-- ── 2. Programs ──
CREATE OR REPLACE FUNCTION public.audit_scholarship_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new JSONB;
BEGIN
  IF NOT public.audited_staff_change() THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.audit_staff_change('create_scholarship', 'scholarships', NEW.id, NULL,
      to_jsonb(NEW) - 'id' - 'created_at' - 'updated_at');
    RETURN NULL;
  END IF;
  _new := public.changed_columns(to_jsonb(OLD), to_jsonb(NEW));
  IF _new = '{}'::jsonb THEN RETURN NULL; END IF;
  PERFORM public.audit_staff_change(
    CASE WHEN _new ?& ARRAY['is_active'] AND (SELECT count(*) FROM jsonb_object_keys(_new)) = 1
         THEN CASE WHEN NEW.is_active THEN 'enable_scholarship' ELSE 'disable_scholarship' END
         ELSE 'update_scholarship' END,
    'scholarships', NEW.id, public.changed_columns(to_jsonb(OLD), to_jsonb(NEW), true), _new);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_audit_scholarship_change ON public.scholarships;
CREATE TRIGGER tr_audit_scholarship_change
  AFTER INSERT OR UPDATE ON public.scholarships
  FOR EACH ROW EXECUTE FUNCTION public.audit_scholarship_change();

-- ── 3. Applications: decisions, awards and the message to the student ──
CREATE OR REPLACE FUNCTION public.audit_application_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.audited_staff_change() THEN RETURN NULL; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.audit_staff_change(
      CASE NEW.status
        WHEN 'Approved' THEN 'approve_application'
        WHEN 'Disapproved' THEN 'disapprove_application'
        WHEN 'Waitlisted' THEN 'waitlist_application'
        WHEN 'Pending' THEN CASE WHEN OLD.status = 'Approved' THEN 'revoke_approval' ELSE 'reopen_application' END
        ELSE 'update_application_status' END,
      'applications', NEW.id,
      jsonb_build_object('status', OLD.status, 'notes', OLD.notes),
      jsonb_build_object('status', NEW.status, 'notes', NEW.notes)
        || CASE WHEN NEW.amount_approved IS DISTINCT FROM OLD.amount_approved
                THEN jsonb_build_object('amount_approved', NEW.amount_approved) ELSE '{}'::jsonb END);
  ELSIF NEW.amount_approved IS DISTINCT FROM OLD.amount_approved THEN
    PERFORM public.audit_staff_change('update_award', 'applications', NEW.id,
      jsonb_build_object('amount_approved', OLD.amount_approved), jsonb_build_object('amount_approved', NEW.amount_approved));
  ELSIF NEW.notes IS DISTINCT FROM OLD.notes THEN
    PERFORM public.audit_staff_change('update_application_remarks', 'applications', NEW.id,
      jsonb_build_object('notes', OLD.notes), jsonb_build_object('notes', NEW.notes));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_audit_application_change ON public.applications;
CREATE TRIGGER tr_audit_application_change
  AFTER UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.audit_application_change();

-- ── 4. Payments: scheduling, editing, processing, cancelling, disbursing ──
CREATE OR REPLACE FUNCTION public.audit_payment_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cols TEXT[] := ARRAY['amount', 'method', 'reference', 'scheduled_date', 'notes', 'term'];
  _old JSONB;
  _new JSONB;
BEGIN
  IF NOT public.audited_staff_change() THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.audit_staff_change('create_payment', 'payments', NEW.id, NULL,
      jsonb_build_object('application_id', NEW.application_id, 'amount', NEW.amount, 'method', NEW.method,
                         'term', NEW.term, 'scheduled_date', NEW.scheduled_date, 'reference', NEW.reference));
    RETURN NULL;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.audit_staff_change(
      CASE NEW.status
        WHEN 'Disbursed' THEN 'disburse_payment'
        WHEN 'Processing' THEN 'process_payment'
        WHEN 'Cancelled' THEN 'cancel_payment'
        ELSE 'update_payment' END,
      'payments', NEW.id,
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status)
        || CASE WHEN NEW.status = 'Disbursed' THEN jsonb_build_object('method', NEW.method, 'reference', NEW.reference) ELSE '{}'::jsonb END
        || CASE WHEN NEW.status = 'Cancelled' AND NEW.cancel_reason IS NOT NULL THEN jsonb_build_object('cancel_reason', NEW.cancel_reason) ELSE '{}'::jsonb END);
    RETURN NULL;
  END IF;

  -- Field edits only; receipt reviews and the student's own changes are logged by their functions (016, 050).
  SELECT jsonb_object_agg(k, to_jsonb(OLD) -> k), jsonb_object_agg(k, to_jsonb(NEW) -> k) INTO _old, _new
    FROM unnest(_cols) k WHERE to_jsonb(NEW) -> k IS DISTINCT FROM to_jsonb(OLD) -> k;
  IF _new IS NOT NULL THEN
    PERFORM public.audit_staff_change('update_payment', 'payments', NEW.id, _old, _new);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_audit_payment_change ON public.payments;
CREATE TRIGGER tr_audit_payment_change
  AFTER INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.audit_payment_change();

-- ── 5. Staff editing their own profile ──
CREATE OR REPLACE FUNCTION public.audit_staff_profile_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.audited_staff_change() OR NEW.id IS DISTINCT FROM auth.uid() THEN RETURN NULL; END IF;
  IF NEW.profile_picture_url IS DISTINCT FROM OLD.profile_picture_url THEN
    PERFORM public.audit_staff_change('update_profile_photo', 'profiles', NEW.id, NULL, NULL);
  END IF;
  IF ROW(NEW.first_name, NEW.last_name, NEW.phone) IS DISTINCT FROM ROW(OLD.first_name, OLD.last_name, OLD.phone) THEN
    PERFORM public.audit_staff_change('update_profile', 'profiles', NEW.id,
      jsonb_build_object('first_name', OLD.first_name, 'last_name', OLD.last_name, 'phone', OLD.phone),
      jsonb_build_object('first_name', NEW.first_name, 'last_name', NEW.last_name, 'phone', NEW.phone));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_audit_staff_profile_change ON public.profiles;
CREATE TRIGGER tr_audit_staff_profile_change
  AFTER UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_staff_profile_change();

-- ── 6. Settings: all or nothing ──
CREATE OR REPLACE FUNCTION public.save_settings(_changes JSONB, _reset BOOLEAN DEFAULT false)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _prev JSONB;
  s record;
BEGIN
  IF NOT public.can_manage_settings(auth.uid()) THEN
    RAISE EXCEPTION 'Only the Mayor Office can change settings' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(_changes) IS DISTINCT FROM 'object' OR _changes = '{}'::jsonb THEN RETURN; END IF;

  SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) INTO _prev
    FROM public.system_settings WHERE key IN (SELECT jsonb_object_keys(_changes));

  -- The settings trigger (019) validates each value; one refusal rolls back the whole save.
  FOR s IN SELECT key, value FROM jsonb_each(_changes) LOOP
    INSERT INTO public.system_settings (key, value) VALUES (s.key, s.value)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
    IF NOT _reset THEN
      PERFORM public.audit_staff_change('update_setting', 'system_settings', NULL,
        jsonb_build_object('key', s.key, 'value', _prev -> s.key), jsonb_build_object('key', s.key, 'value', s.value));
    END IF;
  END LOOP;
  IF _reset THEN
    PERFORM public.audit_staff_change('reset_settings', 'system_settings', NULL, _prev, _changes);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_settings(JSONB, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_settings(JSONB, BOOLEAN) TO authenticated;

-- ── 7. Activating and deactivating: office Admins, only their office's students (050, plus that) ──
CREATE OR REPLACE FUNCTION public.set_student_active(_user_id UUID, _active BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.staff_may(auth.uid(), 'manage') THEN RAISE EXCEPTION 'Only admins can do this'; END IF;
  IF public.is_admin(_user_id) THEN
    RAISE EXCEPTION 'Only student accounts can be activated or deactivated here';
  END IF;
  IF NOT public.office_ok_person(_user_id) THEN
    RAISE EXCEPTION 'This student has not applied to your office''s programs' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles SET is_active = _active WHERE id = _user_id;

  IF _active THEN
    PERFORM public.notify(_user_id, 'Account Reactivated', 'Your account has been reactivated.', 'success', 'account', '/student-dashboard');
  ELSE
    PERFORM public.notify(_user_id, 'Account Deactivated', 'Your account has been deactivated. Please contact the scholarship office if this is a mistake.', 'warning', 'account', '/student-dashboard');
  END IF;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
