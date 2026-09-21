-- Audit log hardening:
--   * only admins can write audit rows from the client, and only as themselves
--   * key student-side actions are logged by the database (applications, receipts, method preference)
--   * index for date-ordered browsing

DROP POLICY IF EXISTS "System can insert audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Admins can insert audit logs" ON public.audit_logs;
CREATE POLICY "Admins can insert audit logs" ON public.audit_logs
  FOR INSERT WITH CHECK (public.has_role('admin', auth.uid()) AND user_id = auth.uid());

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs (created_at DESC);

CREATE OR REPLACE FUNCTION public.write_audit(_action TEXT, _entity TEXT, _entity_id UUID, _prev JSONB, _new JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, previous_value, new_value)
  VALUES (
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    _action, _entity, _entity_id, _prev, _new
  );
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit(TEXT, TEXT, UUID, JSONB, JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.audit_application_submitted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.write_audit('submit_application', 'applications', NEW.id, NULL,
    jsonb_build_object('scholarship_id', NEW.scholarship_id, 'status', NEW.status));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_audit_application_submitted ON public.applications;
CREATE TRIGGER tr_audit_application_submitted
  AFTER INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.audit_application_submitted();

CREATE OR REPLACE FUNCTION public.audit_payment_student_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.student_receipt_at IS DISTINCT FROM OLD.student_receipt_at AND NEW.student_receipt_at IS NOT NULL THEN
    PERFORM public.write_audit('student_submit_receipt', 'payments', NEW.id, NULL,
      jsonb_build_object('has_file', NEW.student_receipt_path IS NOT NULL, 'method', NEW.method));
  END IF;
  IF NEW.preferred_method IS DISTINCT FROM OLD.preferred_method THEN
    PERFORM public.write_audit('student_set_payment_method', 'payments', NEW.id,
      jsonb_build_object('preferred_method', OLD.preferred_method),
      jsonb_build_object('preferred_method', NEW.preferred_method));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_audit_payment_student_changes ON public.payments;
CREATE TRIGGER tr_audit_payment_student_changes
  AFTER UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.audit_payment_student_changes();
