-- Lets a super admin delete a program together with everything filed under it: its applications and
-- whatever hangs off them (documents, notes, verifications, payments, receipts).
--
-- A plain DELETE can't do this: payments.application_id has no ON DELETE CASCADE, and the payments
-- guard trigger refuses to delete disbursed payments. This function removes rows in dependency
-- order and turns that guard off only for its own transaction.
--
-- The live database was not built only from these migration files, so instead of naming the child
-- tables, it looks up every foreign key that points at applications, payments or the program and
-- clears the ones that don't cascade by themselves.
--
-- Uploaded files in Storage are not removed; only their database rows are.
--
-- Run in the Supabase SQL Editor after 058. Safe to re-run.

CREATE OR REPLACE FUNCTION public.delete_scholarship_cascade(_scholarship_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _app_ids UUID[];
  _pay_ids UUID[];
  _apps INT;
  _pays INT;
  _guarded BOOLEAN;
  fk record;
BEGIN
  IF NOT public.can_manage_settings(auth.uid()) THEN
    RAISE EXCEPTION 'Only the Mayor Office can delete programs' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.scholarships WHERE id = _scholarship_id) THEN
    RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO _app_ids FROM public.applications WHERE scholarship_id = _scholarship_id;
  SELECT coalesce(array_agg(id), '{}') INTO _pay_ids FROM public.payments WHERE application_id = ANY (_app_ids);
  _apps := cardinality(_app_ids);
  _pays := cardinality(_pay_ids);

  -- Rows pointing at these payments without ON DELETE CASCADE.
  FOR fk IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.confrelid = 'public.payments'::regclass
       AND c.confdeltype <> 'c' AND cardinality(c.conkey) = 1
  LOOP
    EXECUTE format('DELETE FROM %s WHERE %I = ANY ($1)', fk.tbl, fk.col) USING _pay_ids;
  END LOOP;

  -- Disbursed payments are normally locked; this delete is the super admin's explicit decision.
  IF _pays > 0 THEN
    _guarded := EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.payments'::regclass AND tgname = 'tr_guard_payments');
    IF _guarded THEN ALTER TABLE public.payments DISABLE TRIGGER tr_guard_payments; END IF;
    DELETE FROM public.payments WHERE id = ANY (_pay_ids);
    IF _guarded THEN ALTER TABLE public.payments ENABLE TRIGGER tr_guard_payments; END IF;
  END IF;

  -- Other rows pointing at these applications without ON DELETE CASCADE.
  FOR fk IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.confrelid = 'public.applications'::regclass
       AND c.confdeltype <> 'c' AND cardinality(c.conkey) = 1
  LOOP
    EXECUTE format('DELETE FROM %s WHERE %I = ANY ($1)', fk.tbl, fk.col) USING _app_ids;
  END LOOP;

  DELETE FROM public.applications WHERE id = ANY (_app_ids);

  -- Anything else pointing at the program itself.
  FOR fk IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND c.confrelid = 'public.scholarships'::regclass
       AND c.confdeltype <> 'c' AND cardinality(c.conkey) = 1
  LOOP
    EXECUTE format('DELETE FROM %s WHERE %I = $1', fk.tbl, fk.col) USING _scholarship_id;
  END LOOP;

  DELETE FROM public.scholarships WHERE id = _scholarship_id;

  RETURN jsonb_build_object('applications', _apps, 'payments', _pays);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_scholarship_cascade(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_scholarship_cascade(UUID) TO authenticated;
