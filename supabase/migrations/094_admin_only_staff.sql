-- Two staff roles: Mayor Office and Admin (run after 093).
--
--   * The Reviewer and Finance roles are retired. Their work (reviewing applicants; scheduling payments and
--     payment problems) is the Admin's. Existing Reviewer and Finance accounts become Admins of the same
--     office, and neither role can be given again. (The enum values stay, because Postgres can't drop
--     them; nothing uses them.)
--   * Marking a payment received (Disbursed) is for an Admin only. The Mayor Office can still schedule,
--     edit and cancel payments, but not confirm that a scholar received the money.
--   * With no Reviewer or Finance accounts left, office Admins no longer manage staff: set_staff_access()
--     is for the Mayor Office only. /api/admin/staff checks the same.
--
-- Run in the Supabase SQL Editor. Safe to re-run.

BEGIN;

-- ── 1. Existing Reviewer and Finance accounts become Admins (office kept) ──
UPDATE public.user_roles SET role = 'admin'::app_role WHERE role::text IN ('reviewer', 'finance_admin');

-- ── 2. The retired roles can't be given again, by any path ──
CREATE OR REPLACE FUNCTION public.reject_retired_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.role::text IN ('reviewer', 'finance_admin') THEN
    RAISE EXCEPTION 'The Reviewer and Finance roles were retired. Give Admin access instead.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_reject_retired_roles ON public.user_roles;
CREATE TRIGGER tr_reject_retired_roles
  BEFORE INSERT OR UPDATE OF role ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.reject_retired_roles();

-- ── 3. Permissions: 'receive' (marking payments received) is the Admin's alone ──
CREATE OR REPLACE FUNCTION public.staff_may(_user UUID, _perm TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN _user IS NULL THEN false
    WHEN _user = auth.uid() AND NOT public.staff_access_ok() THEN false
    WHEN _perm = 'super' THEN public.can_manage_settings(_user)
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = _user
         AND role::text = ANY (CASE _perm
               WHEN 'view'    THEN ARRAY['super_admin', 'admin']
               WHEN 'manage'  THEN ARRAY['super_admin', 'admin']
               WHEN 'review'  THEN ARRAY['super_admin', 'admin']
               WHEN 'finance' THEN ARRAY['super_admin', 'admin']
               WHEN 'receive' THEN ARRAY['admin']
               ELSE ARRAY[]::text[]
             END)
    )
  END;
$$;
REVOKE ALL ON FUNCTION public.staff_may(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_may(UUID, TEXT) TO authenticated;

-- ── 4. guard_payments (084) plus: only an Admin marks a payment received ──
CREATE OR REPLACE FUNCTION public.guard_payments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'Disbursed' THEN
      RAISE EXCEPTION 'Disbursed payments are locked and cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'Disbursed' THEN
    -- Only the student's receipt and its review may change once disbursed.
    IF (to_jsonb(NEW) - 'student_receipt_path' - 'student_receipt_ref' - 'student_receipt_at'
                      - 'receipt_review_status' - 'receipt_review_note' - 'receipt_reviewed_by' - 'receipt_reviewed_at')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'student_receipt_path' - 'student_receipt_ref' - 'student_receipt_at'
                      - 'receipt_review_status' - 'receipt_review_note' - 'receipt_reviewed_by' - 'receipt_reviewed_at') THEN
      RAISE EXCEPTION 'Disbursed payments are locked';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.application_id IS NOT NULL THEN
    SELECT status INTO app_status FROM public.applications WHERE id = NEW.application_id;
    IF app_status IS DISTINCT FROM 'Approved' THEN
      RAISE EXCEPTION 'Payments can only be created for approved applications';
    END IF;
  END IF;

  IF NEW.preferred_method IS NOT NULL AND NEW.status <> 'Cancelled' AND NEW.method IS DISTINCT FROM NEW.preferred_method THEN
    RAISE EXCEPTION 'The student chose % for this payment, so the method cannot be changed', NEW.preferred_method;
  END IF;

  IF NEW.status = 'Disbursed' THEN
    -- Signed-in users only; the SQL Editor and server jobs (no auth.uid()) are unaffected.
    IF auth.uid() IS NOT NULL AND NOT public.staff_may(auth.uid(), 'receive') THEN
      RAISE EXCEPTION 'Only an Admin can mark a payment received' USING ERRCODE = '42501';
    END IF;
    IF NEW.method NOT IN ('Cash', 'Cheque') THEN
      RAISE EXCEPTION 'Only Cash or Cheque payments can be disbursed';
    END IF;
    IF NEW.method = 'Cheque' AND COALESCE(btrim(NEW.reference), '') = '' THEN
      RAISE EXCEPTION 'A cheque number is required';
    END IF;
    NEW.disbursed_at := COALESCE(NEW.disbursed_at, now());
  END IF;

  RETURN NEW;
END;
$$;

-- ── 5. Staff are managed by the Mayor Office only (replaces the office-Admin branch from 065) ──
CREATE OR REPLACE FUNCTION public.set_staff_access(_user_id UUID, _role TEXT, _office TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller UUID := auth.uid();
BEGIN
  IF _caller IS NULL OR NOT public.can_manage_settings(_caller) THEN
    RAISE EXCEPTION 'Only the Mayor Office can change staff';
  END IF;
  PERFORM public.set_user_role(_user_id, _role);
  IF _role = 'admin' THEN
    PERFORM public.set_staff_office(_user_id, _office);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_staff_access(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_staff_access(UUID, TEXT, TEXT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
