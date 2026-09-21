-- Lets admin-level staff activate/deactivate a student without granting
-- them a general UPDATE policy on public.profiles.
CREATE OR REPLACE FUNCTION public.set_student_active(_user_id UUID, _active BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.has_role('admin', auth.uid())
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF public.is_admin(_user_id) THEN
    RAISE EXCEPTION 'Only student accounts can be activated or deactivated here';
  END IF;

  UPDATE public.profiles SET is_active = _active WHERE id = _user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_student_active(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_student_active(UUID, BOOLEAN) TO authenticated;
