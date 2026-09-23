-- Close the two-factor bypass: the AAL2 check previously lived only in Next.js middleware and four
-- API routes. Everything else (NotificationInbox, ProfileSection, AccountSettings, the admin panels,
-- and any other component calling supabase.from(...) directly) talks straight to PostgREST, which
-- never looked at the session's authentication assurance level. A stolen or replayed password-only
-- (AAL1) session cookie for an account with a verified authenticator could read and write that
-- person's own data through those direct calls, bypassing the 2FA gate entirely.
--
-- public.mfa_ok(_user) is added to every "own row" policy below. It is a no-op (always true) for the
-- large majority of accounts that have never enrolled a second factor, so this changes nothing for
-- them. For an account with a VERIFIED factor, it additionally requires the current request's JWT to
-- carry aal2 — i.e. the second step must have been completed in this session.
--
-- Run after 031. Safe to re-run. Test with a real 2FA-enrolled account before relying on this: it
-- reads Supabase Auth's internal auth.mfa_factors table and the auth.jwt() claims, both standard but
-- unverified against a live project in this environment.

CREATE OR REPLACE FUNCTION public.mfa_ok(_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    NOT EXISTS (SELECT 1 FROM auth.mfa_factors WHERE user_id = _user AND status = 'verified')
    OR COALESCE((auth.jwt() ->> 'aal') = 'aal2', false);
$$;
GRANT EXECUTE ON FUNCTION public.mfa_ok(UUID) TO authenticated;

-- ── profiles ──
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id AND public.mfa_ok(id));
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id AND public.mfa_ok(id));
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id AND public.mfa_ok(id));

-- ── applications ──
DROP POLICY IF EXISTS "Users can view own applications" ON public.applications;
CREATE POLICY "Users can view own applications" ON public.applications
  FOR SELECT USING (auth.uid() = user_id AND public.mfa_ok(user_id));
DROP POLICY IF EXISTS "Users can insert own applications" ON public.applications;
CREATE POLICY "Users can insert own applications" ON public.applications
  FOR INSERT WITH CHECK (auth.uid() = user_id AND public.mfa_ok(user_id));
DROP POLICY IF EXISTS "Users can update own open applications" ON public.applications;
CREATE POLICY "Users can update own open applications" ON public.applications
  FOR UPDATE
  USING (auth.uid() = user_id AND status IN ('Pending', 'Waitlisted') AND public.mfa_ok(user_id))
  WITH CHECK (auth.uid() = user_id AND status IN ('Pending', 'Waitlisted', 'Withdrawn') AND public.mfa_ok(user_id));

-- ── documents ──
DROP POLICY IF EXISTS "Users can view own documents" ON public.documents;
CREATE POLICY "Users can view own documents" ON public.documents
  FOR SELECT USING (auth.uid() = user_id AND public.mfa_ok(user_id));
DROP POLICY IF EXISTS "Users can insert own documents" ON public.documents;
CREATE POLICY "Users can insert own documents" ON public.documents
  FOR INSERT WITH CHECK (auth.uid() = user_id AND public.mfa_ok(user_id));
DROP POLICY IF EXISTS "Users can delete own documents" ON public.documents;
CREATE POLICY "Users can delete own documents" ON public.documents
  FOR DELETE USING (
    auth.uid() = user_id
    AND public.mfa_ok(user_id)
    AND NOT public.documents_locked(user_id)
    AND (
      application_id IS NULL
      OR status = 'Rejected'
      OR EXISTS (
        SELECT 1 FROM public.documents n
         WHERE n.user_id = documents.user_id
           AND n.document_type = documents.document_type
           AND n.uploaded_at > documents.uploaded_at
      )
    )
  );

-- ── payments (read-only for the owner; writes go through SECURITY DEFINER functions) ──
DROP POLICY IF EXISTS "Users can view own payments" ON public.payments;
CREATE POLICY "Users can view own payments" ON public.payments
  FOR SELECT USING (auth.uid() = user_id AND public.mfa_ok(user_id));

-- ── notifications ──
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id AND public.mfa_ok(user_id));
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id AND public.mfa_ok(user_id));
DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
CREATE POLICY "Users can delete own notifications" ON public.notifications
  FOR DELETE USING (auth.uid() = user_id AND public.mfa_ok(user_id));

-- ── notification_preferences / user_settings ──
DROP POLICY IF EXISTS "Users manage own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users manage own notification preferences" ON public.notification_preferences
  FOR ALL USING (auth.uid() = user_id AND public.mfa_ok(user_id))
  WITH CHECK (auth.uid() = user_id AND public.mfa_ok(user_id));

DROP POLICY IF EXISTS "Users manage own settings" ON public.user_settings;
CREATE POLICY "Users manage own settings" ON public.user_settings
  FOR ALL USING (auth.uid() = user_id AND public.mfa_ok(user_id))
  WITH CHECK (auth.uid() = user_id AND public.mfa_ok(user_id));

-- ── grade_updates / data_requests / payment_issues (read-only for the owner) ──
DROP POLICY IF EXISTS "Students view own grade updates" ON public.grade_updates;
CREATE POLICY "Students view own grade updates" ON public.grade_updates
  FOR SELECT USING (auth.uid() = user_id AND public.mfa_ok(user_id));

DROP POLICY IF EXISTS "Students view own data requests" ON public.data_requests;
CREATE POLICY "Students view own data requests" ON public.data_requests
  FOR SELECT USING (auth.uid() = user_id AND public.mfa_ok(user_id));

DROP POLICY IF EXISTS "Students view own payment issues" ON public.payment_issues;
CREATE POLICY "Students view own payment issues" ON public.payment_issues
  FOR SELECT USING (auth.uid() = user_id AND public.mfa_ok(user_id));

-- ── scholar_verifications (identity/verification data) ──
DROP POLICY IF EXISTS "Users can view own verifications" ON public.scholar_verifications;
CREATE POLICY "Users can view own verifications" ON public.scholar_verifications
  FOR SELECT USING (auth.uid() = user_id AND public.mfa_ok(user_id));

NOTIFY pgrst, 'reload schema';
