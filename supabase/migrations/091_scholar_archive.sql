-- Scholar archive: people who are finished with the program but whose records must be kept.
--
--   * profiles.archived_at / archived_by / archive_reason / archive_note / graduated_level.
--     Reasons: graduated, discontinued, inactive (a long-inactive account), other.
--   * archive_scholars(users, reason, note): admins (staff_may 'manage') of the scholar's office. A scholar
--     with a scheduled payment (Pending/Processing) or an application still in review (Pending/Waitlisted)
--     is skipped and named in the result. Graduates are told; the others aren't (a discontinued scholar
--     was already told, an inactive one can't sign in).
--   * restore_scholar(user): takes them out of the archive.
--   * While archived: no new payments (guard_payments), no new applications, and no reminders or
--     program announcements (scheduled notifications are dropped). Everything already on record stays,
--     reports included. Archiving doesn't touch sign-in: graduates can still sign in to see their history;
--     deactivated accounts stay deactivated.
--   * Students can't change these columns themselves.
--
-- Run in the Supabase SQL Editor, after 090. Safe to re-run.

BEGIN;

-- ── 1. Columns ──
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS archive_reason TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS archive_note TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS graduated_level TEXT;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_archive_reason_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_archive_reason_check
  CHECK (archive_reason IS NULL OR archive_reason IN ('graduated', 'discontinued', 'inactive', 'other'));
CREATE INDEX IF NOT EXISTS profiles_archived_at ON public.profiles (archived_at) WHERE archived_at IS NOT NULL;

-- ── 2. Students can't archive or restore themselves ──
CREATE OR REPLACE FUNCTION public.guard_profile_archive()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() = OLD.id
     AND ROW(NEW.archived_at, NEW.archived_by, NEW.archive_reason, NEW.archive_note, NEW.graduated_level)
         IS DISTINCT FROM ROW(OLD.archived_at, OLD.archived_by, OLD.archive_reason, OLD.archive_note, OLD.graduated_level) THEN
    RAISE EXCEPTION 'That part of your profile can only be changed by the office';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_guard_profile_archive ON public.profiles;
CREATE TRIGGER tr_guard_profile_archive BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_archive();

-- ── 3. Archive / restore ──
CREATE OR REPLACE FUNCTION public.archive_scholars(_users UUID[], _reason TEXT, _note TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u UUID;
  p public.profiles%ROWTYPE;
  who TEXT;
  done INTEGER := 0;
  skipped JSONB := '[]'::jsonb;
BEGIN
  IF NOT public.staff_may(auth.uid(), 'manage') THEN
    RAISE EXCEPTION 'Only admins can archive scholars' USING ERRCODE = '42501';
  END IF;
  IF _reason IS NULL OR _reason NOT IN ('graduated', 'discontinued', 'inactive', 'other') THEN
    RAISE EXCEPTION 'Pick why the scholar is archived';
  END IF;

  FOREACH u IN ARRAY COALESCE(_users, ARRAY[]::UUID[]) LOOP
    SELECT * INTO p FROM public.profiles WHERE id = u FOR UPDATE;
    IF NOT FOUND OR public.is_admin(u) THEN CONTINUE; END IF;
    who := COALESCE(NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email, 'A scholar');

    IF p.archived_at IS NOT NULL THEN
      skipped := skipped || jsonb_build_array(who || ': already archived'); CONTINUE;
    END IF;
    IF NOT public.office_ok_person(u) THEN
      skipped := skipped || jsonb_build_array(who || ': not in your office''s programs'); CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.payments WHERE user_id = u AND status IN ('Pending', 'Processing')) THEN
      skipped := skipped || jsonb_build_array(who || ': has a scheduled payment (release or cancel it first)'); CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.applications WHERE user_id = u AND status IN ('Pending', 'Waitlisted')) THEN
      skipped := skipped || jsonb_build_array(who || ': has an application in review'); CONTINUE;
    END IF;

    UPDATE public.profiles
       SET archived_at = now(), archived_by = auth.uid(), archive_reason = _reason,
           archive_note = NULLIF(btrim(COALESCE(_note, '')), ''),
           graduated_level = CASE WHEN _reason = 'graduated' THEN p.year_level END
     WHERE id = u;

    IF _reason = 'graduated' THEN
      PERFORM public.notify(u, 'Congratulations, graduate!',
        'The scholarship office has marked you as graduated. Your records and payment history are kept, and you can still sign in to see them. Contact the office if this is a mistake.',
        'success', 'account', '/student-dashboard', 'profiles', u);
    END IF;

    PERFORM public.audit_staff_change('archive_scholar', 'profiles', u, NULL,
      jsonb_build_object('reason', _reason, 'note', NULLIF(btrim(COALESCE(_note, '')), '')));
    done := done + 1;
  END LOOP;

  RETURN jsonb_build_object('archived', done, 'skipped', skipped);
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_scholar(_user UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.staff_may(auth.uid(), 'manage') THEN
    RAISE EXCEPTION 'Only admins can restore scholars' USING ERRCODE = '42501';
  END IF;
  IF NOT public.office_ok_person(_user) THEN
    RAISE EXCEPTION 'This scholar has not applied to your office''s programs' USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles
     SET archived_at = NULL, archived_by = NULL, archive_reason = NULL, archive_note = NULL, graduated_level = NULL
   WHERE id = _user AND archived_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'This scholar is not archived'; END IF;
  PERFORM public.audit_staff_change('restore_scholar', 'profiles', _user, NULL, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.archive_scholars(UUID[], TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_scholar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_scholars(UUID[], TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_scholar(UUID) TO authenticated;

-- ── 4. No new applications while archived ──
CREATE OR REPLACE FUNCTION public.refuse_archived_applicant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.user_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Your account is archived. Contact the scholarship office to reopen it before applying.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_refuse_archived_applicant ON public.applications;
CREATE TRIGGER tr_refuse_archived_applicant BEFORE INSERT ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.refuse_archived_applicant();

-- ── 5. No new payments while archived (084's guard_payments, plus that) ──
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

  IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.user_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This scholar is archived. Restore them before scheduling a payment';
  END IF;

  IF NEW.preferred_method IS NOT NULL AND NEW.status <> 'Cancelled' AND NEW.method IS DISTINCT FROM NEW.preferred_method THEN
    RAISE EXCEPTION 'The student chose % for this payment, so the method cannot be changed', NEW.preferred_method;
  END IF;

  IF NEW.status = 'Disbursed' THEN
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

-- ── 6. No reminders or program announcements while archived ──
-- Scheduled notifications carry a dedupe key (reminders) or the 'program' category; staff announcements
-- ('announce-…') and notices about their own records still arrive.
CREATE OR REPLACE FUNCTION public.skip_archived_reminders()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.category = 'program' OR (NEW.dedupe_key IS NOT NULL AND NEW.dedupe_key NOT LIKE 'announce-%'))
     AND EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.user_id AND archived_at IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_skip_archived_reminders ON public.notifications;
CREATE TRIGGER tr_skip_archived_reminders BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.skip_archived_reminders();

COMMIT;

NOTIFY pgrst, 'reload schema';
