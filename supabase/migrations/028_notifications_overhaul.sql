-- Notifications overhaul. Run after 027. Safe to re-run.
--   * students are told when a scheduled payment's amount / date / method changes, and when they withdraw
--   * smarter, eligibility-aware reminders: deadline (7 and 2 days), applications/renewals opening,
--     missing documents, incomplete profile, grade report, receipts (also rejected ones, weekly)
--   * announcements: staff send a message to a chosen audience
--   * retention: old read / muted notifications are purged
--   * the daily job records each run and its errors, and staff can see (and trigger) it

-- ── 1. Payment edits ──
CREATE OR REPLACE FUNCTION public.notify_payment_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parts TEXT[] := '{}';
BEGIN
  -- Status changes have their own notifications; only open payments can still be edited.
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.status NOT IN ('Pending', 'Processing') THEN RETURN NEW; END IF;
  -- The student choosing their own method is not news to them.
  IF auth.uid() = NEW.user_id THEN RETURN NEW; END IF;

  IF NEW.amount IS DISTINCT FROM OLD.amount THEN
    parts := parts || ('amount ₱' || to_char(OLD.amount, 'FM999,999,999,990.00') || ' → ₱' || to_char(NEW.amount, 'FM999,999,999,990.00'));
  END IF;
  IF NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date THEN
    parts := parts || ('date ' || COALESCE(OLD.scheduled_date::text, 'not set') || ' → ' || COALESCE(NEW.scheduled_date::text, 'not set'));
  END IF;
  IF NEW.method IS DISTINCT FROM OLD.method THEN
    parts := parts || ('method ' || COALESCE(OLD.method, 'not set') || ' → ' || COALESCE(NEW.method, 'not set'));
  END IF;
  IF cardinality(parts) = 0 THEN RETURN NEW; END IF;

  PERFORM public.notify(NEW.user_id, 'Payment Updated', 'Your scheduled payment was updated: ' || array_to_string(parts, '; ') || '.',
    'info', 'payment', '/student-dashboard?section=disbursement', 'payments', NEW.id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_notify_payment_changes ON public.payments;
CREATE TRIGGER tr_notify_payment_changes
  AFTER UPDATE OF amount, scheduled_date, method ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.notify_payment_changes();

-- ── 2. Application decisions, now including withdrawal ──
CREATE OR REPLACE FUNCTION public.notify_application_decision()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sch TEXT;
  remarks TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  SELECT name INTO sch FROM public.scholarships WHERE id = NEW.scholarship_id;
  sch := COALESCE(sch, 'the scholarship');
  remarks := CASE WHEN COALESCE(btrim(NEW.notes), '') <> '' THEN ' Remarks: ' || NEW.notes ELSE '' END;

  IF NEW.status = 'Approved' THEN
    PERFORM public.notify(NEW.user_id, 'Application Approved', 'Your application for ' || sch || ' has been approved.' || remarks,
      'success', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Rejected' THEN
    PERFORM public.notify(NEW.user_id, 'Application Rejected', 'Your application for ' || sch || ' was not approved this time.' || remarks,
      'error', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Waitlisted' THEN
    PERFORM public.notify(NEW.user_id, 'Application Waitlisted', 'Your application for ' || sch || ' has been placed on the waitlist. We will notify you if a slot opens.' || remarks,
      'warning', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Pending' AND OLD.status = 'Rejected' THEN
    PERFORM public.notify(NEW.user_id, 'Application Reopened', 'Your application for ' || sch || ' has been reopened for review.' || remarks,
      'info', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  ELSIF NEW.status = 'Withdrawn' THEN
    PERFORM public.notify(NEW.user_id, 'Application Withdrawn', 'You withdrew your application for ' || sch || '. Your documents are kept, and you can apply again while applications are open.',
      'info', 'application', '/student-dashboard?section=application', 'applications', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

-- ── 3. Who can apply where (used by reminders) ──
CREATE OR REPLACE FUNCTION public.student_eligible_for(_user UUID, _scholarship UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
      JOIN public.scholarships s ON s.id = _scholarship
     WHERE p.id = _user AND p.is_active
       AND (COALESCE(s.min_grade, 0) = 0 OR COALESCE(p.average_grade, -1) >= s.min_grade)
       AND (public.setting_number('min_grade_requirement', 0) = 0 OR COALESCE(p.average_grade, -1) >= public.setting_number('min_grade_requirement', 0))
       AND (s.year_levels IS NULL OR cardinality(s.year_levels) = 0 OR p.year_level = ANY (s.year_levels))
       AND (btrim(COALESCE(s.municipality, '')) = '' OR lower(btrim(COALESCE(p.municipality, ''))) = lower(btrim(s.municipality)))
  );
$$;

-- Students who have not applied this year (a withdrawn application doesn't count).
CREATE OR REPLACE FUNCTION public.has_application_this_year(_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.applications
     WHERE user_id = _user AND status <> 'Withdrawn'
       AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM now())
  );
$$;

-- ── 4. Reminders ──
CREATE OR REPLACE FUNCTION public.send_deadline_reminders()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sch RECORD;
  st UUID;
BEGIN
  FOR sch IN
    SELECT s.id, s.name, s.deadline, (s.deadline - CURRENT_DATE) AS days
      FROM public.scholarships s
     WHERE s.is_active AND s.deadline IS NOT NULL AND (s.deadline - CURRENT_DATE) IN (7, 2)
       AND (s.open_date IS NULL OR s.open_date <= CURRENT_DATE)
       AND (s.slots = 0 OR (SELECT COUNT(*) FROM public.applications a WHERE a.scholarship_id = s.id AND a.status = 'Approved') < s.slots)
  LOOP
    FOR st IN
      SELECT ur.user_id FROM public.user_roles ur
       WHERE ur.role::text = 'student'
         AND public.student_eligible_for(ur.user_id, sch.id)
         AND NOT public.has_application_this_year(ur.user_id)
    LOOP
      PERFORM public.notify(st, 'Deadline approaching: ' || sch.name,
        'Applications close on ' || to_char(sch.deadline, 'FMMonth DD, YYYY') || ' (' || sch.days || ' day' || CASE WHEN sch.days = 1 THEN '' ELSE 's' END || ' left). Apply before then.',
        'warning', 'program', '/student-dashboard?section=application&apply=' || sch.id::text, 'scholarships', sch.id,
        'deadline-' || sch.id::text || '-' || sch.deadline::text || '-' || sch.days::text);
    END LOOP;
  END LOOP;
END;
$$;

-- Applications / renewals opening (the global window, and each program's own opening date).
CREATE OR REPLACE FUNCTION public.send_opening_reminders()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  st UUID;
  sch RECORD;
  today TEXT := to_char(CURRENT_DATE, 'YYYY-MM-DD');
  scholar BOOLEAN;
BEGIN
  IF public.setting_text('application_open_date', '') = today AND public.setting_bool('applications_open', true) THEN
    FOR st IN
      SELECT ur.user_id FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
       WHERE ur.role::text = 'student' AND p.is_active AND NOT public.has_application_this_year(ur.user_id)
    LOOP
      scholar := EXISTS (SELECT 1 FROM public.applications WHERE user_id = st AND status = 'Approved');
      IF scholar AND public.setting_bool('renewal_enabled', true) THEN
        PERFORM public.notify(st, 'Renewals are open', 'You can renew your scholarship now. Update your grade report and documents, then apply.',
          'info', 'program', '/student-dashboard?section=application', NULL, NULL, 'window-open-' || today);
      ELSIF NOT scholar THEN
        PERFORM public.notify(st, 'Applications are open', 'Scholarship applications are now open. Check your documents and apply.',
          'info', 'program', '/student-dashboard?section=application', NULL, NULL, 'window-open-' || today);
      END IF;
    END LOOP;
  END IF;

  FOR sch IN SELECT id, name FROM public.scholarships WHERE is_active AND open_date = CURRENT_DATE LOOP
    FOR st IN
      SELECT ur.user_id FROM public.user_roles ur
       WHERE ur.role::text = 'student' AND public.student_eligible_for(ur.user_id, sch.id) AND NOT public.has_application_this_year(ur.user_id)
    LOOP
      PERFORM public.notify(st, 'Now open: ' || sch.name, 'Applications for ' || sch.name || ' are open. You meet its requirements.',
        'info', 'program', '/student-dashboard?section=application&apply=' || sch.id::text, 'scholarships', sch.id, 'program-open-' || sch.id::text);
    END LOOP;
  END LOOP;
END;
$$;

-- Applicants still missing (or holding rejected) required documents: once a week.
CREATE OR REPLACE FUNCTION public.send_document_reminders()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a RECORD;
  req JSONB;
  missing TEXT;
  week TEXT := floor(extract(epoch FROM now()) / 604800)::bigint::text;
BEGIN
  SELECT value INTO req FROM public.system_settings WHERE key = 'required_documents';
  IF req IS NULL OR jsonb_typeof(req) <> 'array' THEN RETURN; END IF;

  FOR a IN
    SELECT id, user_id FROM public.applications
     WHERE status = 'Pending' AND created_at < now() - interval '2 days'
       AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM now())
  LOOP
    SELECT string_agg(d, ', ') INTO missing
      FROM jsonb_array_elements_text(req) AS d
     WHERE NOT EXISTS (
       SELECT 1 FROM public.documents doc
        WHERE doc.user_id = a.user_id AND doc.document_type = d AND doc.status <> 'Rejected'
          AND (doc.application_id = a.id OR doc.application_id IS NULL)
     );
    IF missing IS NOT NULL THEN
      PERFORM public.notify(a.user_id, 'Documents still needed', 'Your application can''t be approved until these are uploaded: ' || missing || '.',
        'warning', 'application', '/student-dashboard?section=documents', 'applications', a.id, 'docs-' || a.id::text || '-' || week);
    END IF;
  END LOOP;
END;
$$;

-- Incomplete profiles (every two weeks) and stale grade reports for scholars (monthly).
CREATE OR REPLACE FUNCTION public.send_profile_reminders()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p RECORD;
  fortnight TEXT := floor(extract(epoch FROM now()) / 1209600)::bigint::text;
  month TEXT := floor(extract(epoch FROM now()) / 2592000)::bigint::text;
BEGIN
  FOR p IN
    SELECT pr.id FROM public.profiles pr JOIN public.user_roles ur ON ur.user_id = pr.id
     WHERE ur.role::text = 'student' AND pr.is_active AND pr.created_at < now() - interval '3 days'
       AND (btrim(COALESCE(pr.first_name, '')) = '' OR btrim(COALESCE(pr.last_name, '')) = '' OR btrim(COALESCE(pr.phone, '')) = ''
            OR btrim(COALESCE(pr.school_name, '')) = '' OR btrim(COALESCE(pr.course, '')) = '' OR btrim(COALESCE(pr.year_level, '')) = ''
            OR pr.average_grade IS NULL)
  LOOP
    PERFORM public.notify(p.id, 'Complete your profile', 'A few details are missing from your profile. The office needs them to review an application.',
      'info', 'application', '/student-dashboard?section=profile', NULL, NULL, 'profile-' || p.id::text || '-' || fortnight);
  END LOOP;

  FOR p IN
    SELECT pr.id FROM public.profiles pr
     WHERE pr.is_active
       AND EXISTS (SELECT 1 FROM public.applications a WHERE a.user_id = pr.id AND a.status = 'Approved')
       AND (pr.grade_verified_at IS NULL OR pr.grade_verified_at < now() - interval '180 days')
       AND NOT EXISTS (SELECT 1 FROM public.grade_updates g WHERE g.user_id = pr.id AND g.status = 'Pending')
  LOOP
    PERFORM public.notify(p.id, 'Submit your latest grades', 'Your verified grade is out of date. Upload your latest grade report in your profile to keep your scholarship and renewals on track.',
      'warning', 'verification', '/student-dashboard?section=profile', NULL, NULL, 'grade-' || p.id::text || '-' || month);
  END LOOP;
END;
$$;

-- Disbursed payments with no receipt, or a rejected one: weekly, for five weeks.
CREATE OR REPLACE FUNCTION public.send_receipt_reminders()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p RECORD;
  week TEXT := floor(extract(epoch FROM now()) / 604800)::bigint::text;
BEGIN
  FOR p IN
    SELECT id, user_id, amount, receipt_review_status FROM public.payments
     WHERE status = 'Disbursed' AND disbursed_at < now() - interval '3 days' AND disbursed_at > now() - interval '35 days'
       AND (student_receipt_at IS NULL OR receipt_review_status = 'Rejected')
  LOOP
    PERFORM public.notify(p.user_id,
      CASE WHEN p.receipt_review_status = 'Rejected' THEN 'Please resend your receipt' ELSE 'Please submit your receipt' END,
      'Your payment of ₱' || to_char(p.amount, 'FM999,999,999,990.00') || CASE WHEN p.receipt_review_status = 'Rejected'
        THEN ' still needs a receipt the office can accept.' ELSE ' was disbursed. Please upload your signed receipt or confirm you received it.' END,
      'warning', 'payment', '/student-dashboard?section=disbursement', 'payments', p.id, 'receipt-reminder-' || p.id::text || '-' || week);
  END LOOP;
END;
$$;

-- ── 5. Retention ──
CREATE OR REPLACE FUNCTION public.purge_old_notifications()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.notifications
   WHERE (read AND created_at < now() - interval '90 days')
      OR (muted AND created_at < now() - interval '30 days')
      OR created_at < now() - interval '365 days';
END;
$$;

-- ── 6. The daily job: every part runs on its own, and the run is recorded ──
CREATE TABLE IF NOT EXISTS public.job_runs (
  job TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ,
  last_ok_at TIMESTAMPTZ,
  last_error TEXT,
  runs BIGINT NOT NULL DEFAULT 0
);
ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;   -- read through notification_jobs_status() only

CREATE OR REPLACE FUNCTION public.send_scheduled_notifications()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  err TEXT;
BEGIN
  BEGIN PERFORM public.send_deadline_reminders(); EXCEPTION WHEN others THEN err := concat_ws('; ', err, 'deadline: ' || SQLERRM); END;
  BEGIN PERFORM public.send_opening_reminders();  EXCEPTION WHEN others THEN err := concat_ws('; ', err, 'opening: ' || SQLERRM); END;
  BEGIN PERFORM public.send_document_reminders(); EXCEPTION WHEN others THEN err := concat_ws('; ', err, 'documents: ' || SQLERRM); END;
  BEGIN PERFORM public.send_profile_reminders();  EXCEPTION WHEN others THEN err := concat_ws('; ', err, 'profile: ' || SQLERRM); END;
  BEGIN PERFORM public.send_receipt_reminders();  EXCEPTION WHEN others THEN err := concat_ws('; ', err, 'receipts: ' || SQLERRM); END;
  BEGIN PERFORM public.send_payment_reminders();  EXCEPTION WHEN others THEN err := concat_ws('; ', err, 'payments: ' || SQLERRM); END;
  BEGIN PERFORM public.purge_old_notifications(); EXCEPTION WHEN others THEN err := concat_ws('; ', err, 'cleanup: ' || SQLERRM); END;

  INSERT INTO public.job_runs (job, last_run_at, last_ok_at, last_error, runs)
  VALUES ('notifications', now(), CASE WHEN err IS NULL THEN now() END, err, 1)
  ON CONFLICT (job) DO UPDATE
    SET last_run_at = now(),
        last_ok_at = CASE WHEN err IS NULL THEN now() ELSE public.job_runs.last_ok_at END,
        last_error = err,
        runs = public.job_runs.runs + 1;
END;
$$;
REVOKE ALL ON FUNCTION public.send_scheduled_notifications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_deadline_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_opening_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_document_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_profile_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_receipt_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_old_notifications() FROM PUBLIC;

-- Try to schedule it daily at 09:00 Manila time (01:00 UTC). If pg_cron isn't available the status
-- function below says so, and the schedule can be added by hand:
--   SELECT cron.schedule('sbsj-reminders', '0 1 * * *', 'SELECT public.send_scheduled_notifications()');
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule('sbsj-reminders', '0 1 * * *', 'SELECT public.send_scheduled_notifications()');
EXCEPTION WHEN others THEN
  RAISE NOTICE 'pg_cron not available (%). Schedule public.send_scheduled_notifications() manually.', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION public.notification_jobs_status()
RETURNS TABLE (cron_available BOOLEAN, scheduled BOOLEAN, schedule TEXT, last_run_at TIMESTAMPTZ, last_ok_at TIMESTAMPTZ, last_error TEXT, runs BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sched TEXT;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  cron_available := to_regclass('cron.job') IS NOT NULL;
  scheduled := false;
  IF cron_available THEN
    EXECUTE 'SELECT schedule FROM cron.job WHERE jobname = $1 LIMIT 1' INTO sched USING 'sbsj-reminders';
    scheduled := sched IS NOT NULL;
  END IF;
  schedule := sched;
  SELECT j.last_run_at, j.last_ok_at, j.last_error, j.runs INTO last_run_at, last_ok_at, last_error, runs
    FROM public.job_runs j WHERE j.job = 'notifications';
  runs := COALESCE(runs, 0);
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.notification_jobs_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notification_jobs_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.run_notification_jobs_now()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  PERFORM public.send_scheduled_notifications();
END;
$$;
REVOKE ALL ON FUNCTION public.run_notification_jobs_now() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.run_notification_jobs_now() TO authenticated;

-- ── 7. Announcements ──
CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 120),
  message TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 3 AND 1000),
  audience TEXT NOT NULL CHECK (audience IN ('all', 'scholars', 'applicants', 'no_application')),
  link TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff view announcements" ON public.announcements;
CREATE POLICY "Staff view announcements" ON public.announcements FOR SELECT USING (public.is_admin(auth.uid()));

-- audience: all = active students; scholars = ever approved; applicants = pending / waitlisted this year;
--           no_application = haven't applied this year
CREATE OR REPLACE FUNCTION public.send_announcement(_title TEXT, _message TEXT, _audience TEXT, _link TEXT DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ann UUID;
  st UUID;
  n INTEGER := 0;
  lnk TEXT := NULLIF(btrim(COALESCE(_link, '')), '');
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  IF _audience NOT IN ('all', 'scholars', 'applicants', 'no_application') THEN RAISE EXCEPTION 'Choose who should receive this'; END IF;
  IF char_length(btrim(COALESCE(_title, ''))) < 3 OR char_length(_title) > 120 THEN RAISE EXCEPTION 'The title must be 3 to 120 characters'; END IF;
  IF char_length(btrim(COALESCE(_message, ''))) < 3 OR char_length(_message) > 1000 THEN RAISE EXCEPTION 'The message must be 3 to 1000 characters'; END IF;
  IF lnk IS NOT NULL AND lnk !~ '^/[A-Za-z0-9/_?&=.#-]*$' THEN RAISE EXCEPTION 'The link must be a page on this site, like /student-dashboard?section=documents'; END IF;

  INSERT INTO public.announcements (title, message, audience, link, created_by)
  VALUES (btrim(_title), btrim(_message), _audience, lnk, auth.uid())
  RETURNING id INTO ann;

  FOR st IN
    SELECT ur.user_id FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role::text = 'student' AND p.is_active
       AND CASE _audience
             WHEN 'all' THEN true
             WHEN 'scholars' THEN EXISTS (SELECT 1 FROM public.applications a WHERE a.user_id = ur.user_id AND a.status = 'Approved')
             WHEN 'applicants' THEN EXISTS (SELECT 1 FROM public.applications a WHERE a.user_id = ur.user_id AND a.status IN ('Pending', 'Waitlisted')
                                             AND EXTRACT(YEAR FROM a.created_at) = EXTRACT(YEAR FROM now()))
             ELSE NOT public.has_application_this_year(ur.user_id)
           END
  LOOP
    PERFORM public.notify(st, btrim(_title), btrim(_message), 'info', 'program', lnk, 'announcements', ann, 'announce-' || ann::text);
    n := n + 1;
  END LOOP;

  UPDATE public.announcements SET recipient_count = n WHERE id = ann;
  PERFORM public.write_audit('send_announcement', 'announcements', ann, NULL,
    jsonb_build_object('audience', _audience, 'recipients', n, 'title', btrim(_title)));
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.send_announcement(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_announcement(TEXT, TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
