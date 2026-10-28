-- Fixes the gaps in deleting a program (059's delete_scholarship_cascade).
--
--   * Rows that only point at a program's rows through another table (a row referencing a document or a
--     note of one of its applications) no longer make the delete fail: every table that points at the
--     deleted rows without ON DELETE CASCADE is cleared, all the way down.
--   * Foreign keys declared ON DELETE SET NULL / SET DEFAULT are left to do that, instead of having
--     their rows deleted as 059 did.
--   * The program row is locked first, so an application filed while it is being deleted waits and
--     then fails instead of leaving the delete half done.
--   * Notifications about the program, its applications, documents and payments are removed, so no
--     one is left with links to records that no longer exist.
--   * The audit entry is written in the same transaction (the admin panel used to write it afterwards).
--   * It returns the storage paths of uploaded files (documents, letters of intent, receipts) that
--     nothing uses any more; the admin panel removes those files from Storage.
--
-- Run in the Supabase SQL Editor after 059. Safe to re-run.

BEGIN;

-- Deletes the rows that point at _parent's rows _ids and wouldn't go by themselves, deepest first.
-- Tables that cascade are followed too, for whatever points at their rows without cascading.
CREATE OR REPLACE FUNCTION public.purge_rows_referencing(_parent REGCLASS, _ids UUID[], _depth INT DEFAULT 0)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fk record;
  _child UUID[];
BEGIN
  IF cardinality(_ids) = 0 OR _depth > 5 THEN RETURN; END IF;

  FOR fk IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col, c.confdeltype AS on_delete,
           EXISTS (SELECT 1 FROM pg_attribute i
                    WHERE i.attrelid = c.conrelid AND i.attname = 'id' AND NOT i.attisdropped
                      AND i.atttypid = 'uuid'::regtype) AS has_id
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_attribute r ON r.attrelid = c.confrelid AND r.attnum = c.confkey[1]
     WHERE c.contype = 'f' AND c.confrelid = _parent AND c.conrelid <> _parent
       AND cardinality(c.conkey) = 1 AND r.attname = 'id'
       AND c.confdeltype IN ('a', 'r', 'c')   -- no action, restrict, cascade; SET NULL/DEFAULT handle themselves
  LOOP
    IF fk.has_id THEN
      EXECUTE format('SELECT coalesce(array_agg(id), ''{}'') FROM %s WHERE %I = ANY ($1)', fk.tbl, fk.col)
         INTO _child USING _ids;
      PERFORM public.purge_rows_referencing(fk.tbl, _child, _depth + 1);
    END IF;
    IF fk.on_delete <> 'c' THEN
      EXECUTE format('DELETE FROM %s WHERE %I = ANY ($1)', fk.tbl, fk.col) USING _ids;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_rows_referencing(REGCLASS, UUID[], INT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.delete_scholarship_cascade(_scholarship_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name TEXT;
  _app_ids UUID[];
  _pay_ids UUID[];
  _doc_ids UUID[];
  _paths TEXT[];
  _guarded BOOLEAN;
BEGIN
  IF NOT public.can_manage_settings(auth.uid()) THEN
    RAISE EXCEPTION 'Only the Mayor Office can delete programs' USING ERRCODE = '42501';
  END IF;
  -- FOR UPDATE also holds off new applications (their foreign key check waits on this lock).
  SELECT name INTO _name FROM public.scholarships WHERE id = _scholarship_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Program not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO _app_ids FROM public.applications WHERE scholarship_id = _scholarship_id;
  SELECT coalesce(array_agg(id), '{}') INTO _pay_ids FROM public.payments WHERE application_id = ANY (_app_ids);
  SELECT coalesce(array_agg(id), '{}') INTO _doc_ids FROM public.documents WHERE application_id = ANY (_app_ids);

  SELECT coalesce(array_agg(DISTINCT p), '{}') INTO _paths FROM (
    SELECT storage_path AS p FROM public.documents WHERE id = ANY (_doc_ids)
    UNION ALL SELECT letter_of_intent_path FROM public.applications WHERE id = ANY (_app_ids)
    UNION ALL SELECT receipt_path FROM public.payments WHERE id = ANY (_pay_ids)
    UNION ALL SELECT student_receipt_path FROM public.payments WHERE id = ANY (_pay_ids)
  ) f WHERE p IS NOT NULL AND p <> '';

  -- Payments first: disbursed ones are normally locked, and this delete is the super admin's explicit decision.
  PERFORM public.purge_rows_referencing('public.payments'::regclass, _pay_ids);
  IF cardinality(_pay_ids) > 0 THEN
    _guarded := EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.payments'::regclass AND tgname = 'tr_guard_payments' AND tgenabled <> 'D');
    IF _guarded THEN ALTER TABLE public.payments DISABLE TRIGGER tr_guard_payments; END IF;
    DELETE FROM public.payments WHERE id = ANY (_pay_ids);
    IF _guarded THEN ALTER TABLE public.payments ENABLE TRIGGER tr_guard_payments; END IF;
  END IF;

  PERFORM public.purge_rows_referencing('public.applications'::regclass, _app_ids);
  DELETE FROM public.applications WHERE id = ANY (_app_ids);

  PERFORM public.purge_rows_referencing('public.scholarships'::regclass, ARRAY[_scholarship_id]);
  DELETE FROM public.notifications WHERE entity_id = ANY (_app_ids || _pay_ids || _doc_ids || _scholarship_id);
  DELETE FROM public.scholarships WHERE id = _scholarship_id;

  -- A file can be shared (073 copies documents per application), so keep the ones something still uses.
  SELECT coalesce(array_agg(p), '{}') INTO _paths FROM unnest(_paths) p
   WHERE NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.storage_path = p)
     AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.letter_of_intent_path = p)
     AND NOT EXISTS (SELECT 1 FROM public.payments y WHERE y.receipt_path = p OR y.student_receipt_path = p)
     AND NOT EXISTS (SELECT 1 FROM public.grade_updates g WHERE g.file_path = p);

  PERFORM public.write_audit('delete_scholarship', 'scholarships', _scholarship_id,
    jsonb_build_object('name', _name, 'applications', cardinality(_app_ids), 'payments', cardinality(_pay_ids),
                       'documents', cardinality(_doc_ids)),
    NULL);

  RETURN jsonb_build_object('applications', cardinality(_app_ids), 'payments', cardinality(_pay_ids),
                            'paths', to_jsonb(_paths));
END;
$$;

REVOKE ALL ON FUNCTION public.delete_scholarship_cascade(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_scholarship_cascade(UUID) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
