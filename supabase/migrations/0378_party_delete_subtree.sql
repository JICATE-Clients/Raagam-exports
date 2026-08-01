-- ============================================================================
-- Raagam ERP — 0378 Deleting a party takes its published subtree with it
--
-- 0371 gave the "Also …" tick boxes teeth: ticking Also Customer on an Applicant
-- publishes a REAL row into the Customer master. What it did not settle is what
-- happens when the Applicant is deleted. 0371 chose "the published customer
-- survives", and its header says so:
--
--     "ON DELETE SET NULL, deliberately NOT CASCADE. If someone deletes the
--      applicant, the customer it published must survive."
--
-- That rationale is now REVERSED (client, 2026-07-31; open question P3 in
-- doc/masters-open-questions.md). It left the operator with no way out: the
-- published Customer refuses to be deleted from its own screen — "this came from
-- Applicant ABC, untick Also Customer there" — so once ABC is gone, nothing can
-- remove it. A published row exists only as an expression of the tick box that
-- made it; kill the box and the row goes too.
--
--   Applicant ─┬─ Customer ─┬─ Consignee ── Notify
--              │            └─ Notify
--              └─ Consignee ── Notify
--
-- ONE FATE. If the root or ANY node of that subtree is genuinely in use, nothing
-- is hard-deleted: every node is marked inactive and the publish links are left
-- intact, so the tick boxes keep telling the truth. Otherwise the whole subtree
-- goes. Half of it going is the one outcome that must never happen — a source
-- left alive with its boxes ticked and its subtree destroyed republishes fresh,
-- empty rows on the very next save, losing the GST, contacts and grids that
-- belong to those rows and not to the source.
--
-- Which is why this is SQL and not TypeScript: supabase-js has no transaction,
-- so "one fate" could only ever be an intention there. Here it is a fact.
--
-- The SET NULL / NOT CASCADE mechanism from 0371 is still right, and stays. The
-- fate is CONDITIONAL — deleted or deactivated, decided at run time — and a
-- CASCADE cannot express a condition. Only the reasoning changed.
--
-- ADD-ONLY: 0371 and 0344 are untouched. `first_referencing_table` (0344) still
-- serves ~70 other masters and must keep behaving exactly as it does.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Why 0344 cannot answer this question
--
-- `first_referencing_table` asks "does ANY non-cascade FK still point at this
-- row?". For a party subtree that is the wrong question, because three of the
-- pointers come from inside the delete set itself:
--
--   consignees.customer_id        → the published consignee's OWNING-CUSTOMER
--                                   picker, which publishParty deliberately
--                                   seeds to the publishing customer
--                                   (lib/masters/customer-actions.ts).
--   customer_applicants.applicant_id  → cascades away with the customer node.
--   consignee_notifies.notify_id      → cascades away with the consignee node.
--
-- The first of those is not hypothetical and not new: TODAY, deleting any
-- customer with Also Consignee ticked reports "used by Consignees" and refuses
-- to delete, naming the very row the customer created. Verified on live data
-- (customer OXBOW, 2026-07-31).
--
-- Enumerating those three FKs in code is exactly the hand-maintained list that
-- 0344 was written to abolish; it would rot the next time someone adds a column.
-- So we do not ask a catalog question at all. We DELETE, then look at what is
-- still standing:
--
--   a referring row that SURVIVED the delete was silently SET NULL   → real use
--   a referring row that VANISHED went with the subtree              → not use
--
-- RESTRICT / NO ACTION referrers (garment_styles, ta_styles, packing_advices,
-- internal_work_orders, material_bom_amendments …) never get that far: they
-- raise 23503 on the delete itself. Both paths land in the same handler, and a
-- subtransaction puts everything back before anyone sees it.
-- ----------------------------------------------------------------------------


-- "consignees" → "Consignee". Table names surface in error messages and in the
-- toast, and the operator never typed a table name in their life.
create or replace function public.party_label(p_table text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_table
           when 'applicants' then 'Applicant'
           when 'customers'  then 'Customer'
           when 'consignees' then 'Consignee'
           when 'notifies'   then 'Notify Party'
           else p_table
         end;
$$;

grant execute on function public.party_label(text) to authenticated;


-- Referring rows whose FK would SET NULL — the silent ones, the whole reason
-- 0344 exists. Snapshotted BEFORE the deletes so we can ask afterwards which of
-- them are still there.
--
-- SECURITY DEFINER for the same reason as 0344: the check must see every
-- referring row, not just the ones the caller's RLS lets it read. Its exposure
-- is 0344's exposure — it reveals that a row referencing a known id exists.
create or replace function public.party_setnull_referrers(p_table text, p_id uuid)
returns table (ref_schema text, ref_table text, ref_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select
      ns.nspname  as child_schema,
      cl.relname  as child_table,
      att.attname as child_column,
      exists (
        select 1
        from pg_catalog.pg_attribute a
        join pg_catalog.pg_type ty on ty.oid = a.atttypid
        where a.attrelid = con.conrelid
          and a.attname  = 'id'
          and a.attnum   > 0
          and not a.attisdropped
          and ty.typname = 'uuid'
      ) as has_uuid_id
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class cl        on cl.oid = con.conrelid
    join pg_catalog.pg_namespace ns    on ns.oid = cl.relnamespace
    join pg_catalog.pg_attribute att   on att.attrelid = con.conrelid
                                      and att.attnum   = con.conkey[1]
    where con.contype = 'f'
      and con.confrelid = ('public.' || p_table)::regclass
      and con.confdeltype in ('n', 'd')     -- SET NULL / SET DEFAULT only.
      and array_length(con.conkey, 1) = 1   -- single-column FKs, as 0344.
  loop
    if r.has_uuid_id then
      return query execute format(
        'select $1::text, $2::text, k.id from %I.%I k where k.%I = $3',
        r.child_schema, r.child_table, r.child_column
      ) using r.child_schema, r.child_table, p_id;
    else
      -- No uuid id to track this row by, so we could never tell afterwards
      -- whether it survived. Emit a NULL id, which the caller reads as
      -- "assume in use" — the safe direction: deactivate rather than delete.
      return query execute format(
        'select $1::text, $2::text, null::uuid from %I.%I k where k.%I = $3 limit 1',
        r.child_schema, r.child_table, r.child_column
      ) using r.child_schema, r.child_table, p_id;
    end if;
  end loop;
end;
$$;

grant execute on function public.party_setnull_referrers(text, uuid) to authenticated;


-- Is that snapshotted row still there? DEFINER for the same reason: a row hidden
-- by the caller's RLS would otherwise read as "gone", i.e. as "not in use", and
-- we would delete something we should have kept.
create or replace function public.party_row_exists(p_schema text, p_table text, p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  hit int;
begin
  execute format('select 1 from %I.%I where id = $1 limit 1', p_schema, p_table)
    using p_id into hit;
  return hit is not null;
end;
$$;

grant execute on function public.party_row_exists(text, text, uuid) to authenticated;


-- ----------------------------------------------------------------------------
-- The operation itself.
--
-- SECURITY INVOKER, deliberately: every delete and every update in here must
-- obey the caller's RLS. Only the two read-only helpers above are DEFINER.
--
-- Returns:
--   { "inactive": bool,          -- true = nothing deleted, everything deactivated
--     "used_by":  text | null,   -- the table that blocked it
--     "nodes":    [ { "table", "label", "name" }, … ] }   -- root first
-- ----------------------------------------------------------------------------
create or replace function public.party_delete_subtree(p_table text, p_id uuid)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  -- The subtree, root first. Parallel arrays because a function cannot declare
  -- a composite type of its own.
  v_tables text[] := array[p_table];
  v_ids    uuid[] := array[p_id];
  v_names  text[];

  -- Every SET NULL referrer of every node, as it stood before we touched
  -- anything.
  v_ref_schemas text[] := '{}';
  v_ref_tables  text[] := '{}';
  v_ref_ids     uuid[] := '{}';

  v_cursor  int := 1;
  v_name    text;
  v_used_by text;
  v_in_use  boolean := false;
  v_rows    int;
  v_detail  text;
  r_link    record;
  r_child   record;
  r_ref     record;
  i         int;
begin
  if p_table not in ('applicants', 'customers', 'consignees', 'notifies') then
    raise exception 'party_delete_subtree: % is not a party master', p_table
      using errcode = 'invalid_parameter_value';
  end if;

  -- row_count, not FOUND: EXECUTE deliberately leaves FOUND alone, so a missing
  -- row would otherwise sail through carrying whatever the last statement set.
  execute format('select name from public.%I where id = $1', p_table)
    using p_id into v_name;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'party_delete_subtree: no % row with id %', p_table, p_id
      using errcode = 'no_data_found';
  end if;
  v_names := array[v_name];

  -- ---- 1. Walk the publish links, breadth-first, so the list comes out
  --         root-first without a second sort. ------------------------------
  while v_cursor <= coalesce(array_length(v_tables, 1), 0) loop
    for r_link in
      -- The five links, mirroring PARTY_LINKS in lib/masters/party-publish.ts.
      -- Two copies of one five-row table is the price of doing this
      -- atomically; keep them in the same order and change them together.
      select *
      from (values
        ('applicants', 'customers',  'source_applicant_id'),
        ('applicants', 'consignees', 'source_applicant_id'),
        ('customers',  'consignees', 'source_customer_id'),
        ('customers',  'notifies',   'source_customer_id'),
        ('consignees', 'notifies',   'source_consignee_id')
      ) as l(parent_table, child_table, child_column)
      where l.parent_table = v_tables[v_cursor]
    loop
      for r_child in execute format(
        'select id, name from public.%I where %I = $1',
        r_link.child_table, r_link.child_column
      ) using v_ids[v_cursor]
      loop
        v_tables := v_tables || r_link.child_table;
        v_ids    := v_ids    || r_child.id;
        v_names  := v_names  || r_child.name;
      end loop;
    end loop;

    -- Tripwire, not load-bearing. The links only ever run downhill
    -- (applicant → customer → consignee → notify) and the 0371 CHECKs forbid a
    -- row having two sources, so the walk cannot loop. If it ever does, stop
    -- here rather than delete an unbounded set of records.
    if array_length(v_tables, 1) > 16 then
      raise exception 'party_delete_subtree: subtree too large from % % — publish links may be cyclic', p_table, p_id
        using errcode = 'program_limit_exceeded';
    end if;

    v_cursor := v_cursor + 1;
  end loop;

  -- ---- 2. Snapshot the silent referrers, before anything changes. --------
  for i in 1 .. array_length(v_tables, 1) loop
    for r_ref in
      select * from public.party_setnull_referrers(v_tables[i], v_ids[i])
    loop
      v_ref_schemas := v_ref_schemas || r_ref.ref_schema;
      v_ref_tables  := v_ref_tables  || r_ref.ref_table;
      v_ref_ids     := v_ref_ids     || r_ref.ref_id;
    end loop;
  end loop;

  -- ---- 3. Try it for real, inside a subtransaction. Every exit from this
  --         block either committed the whole subtree or restored it. -------
  begin
    -- Root first. All five publish FKs are SET NULL, so deleting the parent
    -- only blanks the child's link — we already hold every id we need.
    -- Each node's own grids (contacts, markings, …) CASCADE away with it.
    for i in 1 .. array_length(v_tables, 1) loop
      execute format('delete from public.%I where id = $1', v_tables[i])
        using v_ids[i];
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        -- An RLS DELETE policy FILTERS rows rather than raising, so without
        -- this check a caller lacking permission would get a cheerful
        -- "deleted" for a row that is still sitting there. Deliberately NOT
        -- caught below: this is a permission fault, not an in-use verdict,
        -- and it must reach the operator as an error.
        raise exception 'You do not have permission to delete this %.',
          public.party_label(v_tables[i])
          using errcode = 'insufficient_privilege';
      end if;
    end loop;

    -- Nothing raised, so no RESTRICT/NO ACTION referrer exists. What is left
    -- is the silent half: a snapshotted row that is STILL HERE was quietly
    -- SET NULL by the deletes, which means something outside the subtree was
    -- pointing at it. One that has vanished went down with the subtree and
    -- never counted.
    for i in 1 .. coalesce(array_length(v_ref_ids, 1), 0) loop
      if v_ref_ids[i] is null
         or public.party_row_exists(v_ref_schemas[i], v_ref_tables[i], v_ref_ids[i])
      then
        v_used_by := v_ref_tables[i];
        raise exception 'in use by %', v_ref_tables[i] using errcode = 'PT001';
      end if;
    end loop;

  exception
    -- Our own signal from the survivor scan. plpgsql variables are memory, not
    -- table state, so v_used_by survives the rollback.
    when sqlstate 'PT001' then
      v_in_use := true;

    -- A RESTRICT / NO ACTION referrer — an order, a packing advice, a plan.
    -- The DETAIL line names it.
    when foreign_key_violation or restrict_violation then
      get stacked diagnostics v_detail = pg_exception_detail;
      v_used_by := coalesce(
        substring(v_detail from 'referenced from table "([^"]+)"'),
        'another record'
      );
      v_in_use := true;
  end;

  -- ---- 4. In use: one fate. Everything the delete would have taken goes
  --         inactive instead, links untouched so the tick boxes stay true. --
  if v_in_use then
    for i in 1 .. array_length(v_tables, 1) loop
      execute format('update public.%I set inactive = true where id = $1', v_tables[i])
        using v_ids[i];
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        -- Same trap as the delete, and this one really fires: DELETE is gated
        -- on masters.delete but UPDATE on masters.edit, so a delete-only role
        -- reaching the in-use path silently changes nothing. A "marked
        -- inactive" toast over a row that did not move is worse than an error,
        -- so say what happened and why it needs the other permission.
        raise exception
          'This % is in use, so deleting it means marking it inactive — and you do not have permission to edit it.',
          public.party_label(v_tables[i])
          using errcode = 'insufficient_privilege';
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'inactive', v_in_use,
    'used_by',  v_used_by,
    'nodes', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'table', u.t,
            'label', public.party_label(u.t),
            'name', u.n
          )
          order by u.ord
        ),
        '[]'::jsonb
      )
      from unnest(v_tables, v_names) with ordinality as u(t, n, ord)
    )
  );
end;
$$;

grant execute on function public.party_delete_subtree(text, uuid) to authenticated;


-- The 0371 column comments describe the old, now-inverted rule. Rewrite them
-- here rather than editing 0371, which is add-only history.
comment on column public.customers.source_applicant_id is
  'Set when this row was published by ticking Also Customer on an Applicant. Deleting that applicant deletes this row too (0378) — or, if either is in use, marks both inactive.';
comment on column public.consignees.source_applicant_id is
  'Set when this row was published by ticking Also Consignee on an Applicant. Deleting that applicant deletes this row too (0378) — or, if either is in use, marks both inactive.';
comment on column public.consignees.source_customer_id is
  'Set when this row was published by ticking Also Consignee on a Customer. Deleting that customer deletes this row too (0378) — or, if either is in use, marks both inactive.';
comment on column public.notifies.source_customer_id is
  'Set when this row was published by ticking Also Notify on a Customer. Deleting that customer deletes this row too (0378) — or, if either is in use, marks both inactive.';
comment on column public.notifies.source_consignee_id is
  'Set when this row was published by ticking Also Notify on a Consignee. Deleting that consignee deletes this row too (0378) — or, if either is in use, marks both inactive.';
