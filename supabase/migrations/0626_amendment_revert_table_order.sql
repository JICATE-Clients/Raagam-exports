-- 0626 — THE REVERT RESTORES PARENTS BEFORE CHILDREN (found 2026-09-24 by a
-- rolled-back dry run of the HO/RE/26-27/0001 repair, 0625).
--
-- `order_amendment_revert` (0619) ranks the order's locked tables by foreign-key
-- depth so it can delete deepest-first and upsert parents-first. It compared
-- `k.confrelid::regclass::text` against the bare table names it had collected —
-- but the function runs with `search_path = ''`, where a regclass prints
-- SCHEMA-QUALIFIED (`public.garment_order_amendment_assort_lines`). The two
-- never matched, every table ranked 0, and the upsert ran in plain alphabetical
-- order: `…_assort_line_sizes` sorts before `…_assort_lines` ('_' < 's'), so
-- the sizes were written before the lines they belong to and the foreign key
-- refused the whole revert:
--
--   insert or update on table "garment_order_amendment_assort_line_sizes"
--   violates foreign key constraint "…_line_id_fkey"
--
-- So EVERY reject and every abandon of an order with an assortment has failed
-- since 0619 — a reject lands in its savepoint and records `revert_error`, an
-- abandon errors. Nothing had reached this code path successfully yet: the only
-- entries in the register had no budget snapshot and never called it (0625).
--
-- The one change is the ranking query: both sides compared as bare `relname`,
-- scoped to schema public. Everything else is 0619's function verbatim.

create or replace function public.order_amendment_revert(p_entry uuid, p_outcome text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bk constant text[] := array[
    're_status', 're_status_at', 're_amendment_id', 'approval_status',
    'approved_by', 'approved_at', 'approval_reason'
  ];
  e       record;
  t       record;
  v_n     int;
  v_i     int;
  v_expr  text;
  v_rows  jsonb;
  v_ids   uuid[];
  v_cols  text;
  v_set   text;
  v_bud   jsonb;
begin
  if p_outcome not in ('rejected', 'abandoned') then
    raise exception using message = format('Unknown revert outcome %s', p_outcome), errcode = '22023';
  end if;

  select r.* into e from public.order_budget_revisions r
   where r.id = p_entry and r.outcome = 'open'
     for update;
  if not found then
    raise exception using message = 'That amendment is not open', errcode = 'P0001';
  end if;
  if e.garment_order_id is null or e.order_snapshot is null or e.budget_snapshot is null
     or (e.budget_snapshot -> 'budget') is null or jsonb_typeof(e.budget_snapshot -> 'budget') = 'null' then
    raise exception using
      message = format('Amendment %s has no approved snapshot to revert to (raised before 0619)', coalesce(e.entry_no, '')),
      errcode = 'P0001';
  end if;

  -- The lock stands down for THIS order, for THIS transaction.
  update public.order_budget_revisions set reverting_txid = txid_current() where id = p_entry;

  -- ---- The order document: the snapshot's tables, parents before children ----
  create temporary table if not exists oar_tables (
    tbl text primary key, path text[], depth int
  ) on commit drop;
  truncate pg_temp.oar_tables;

  insert into pg_temp.oar_tables (tbl, path, depth)
  select c.relname::text,
         array_remove(string_to_array(encode(g.tgargs, 'escape'), '\000'), ''),
         0
    from pg_catalog.pg_trigger g
    join pg_catalog.pg_class c on c.oid = g.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where g.tgname = 'trg_order_lock' and n.nspname = 'public'
     and e.order_snapshot ? c.relname::text;

  -- Depth = longest FK chain from a parent inside the set (self-references,
  -- such as a process row's prev_row_uid, are not a chain).
  for v_i in 1..20 loop
    update pg_temp.oar_tables x
       set depth = sub.d
      from (
        -- BARE relnames on both sides (0626). `regclass::text` under this
        -- function's `search_path = ''` is `public.<name>`, which never equals
        -- the bare `tbl` — so every table ranked 0 and restored alphabetically.
        select cc.relname::text as child, max(p.depth) + 1 as d
          from pg_catalog.pg_constraint k
          join pg_catalog.pg_class cc on cc.oid = k.conrelid
          join pg_catalog.pg_class pc on pc.oid = k.confrelid
          join pg_temp.oar_tables p on p.tbl = pc.relname::text
         where k.contype = 'f' and k.conrelid <> k.confrelid
           and cc.relnamespace = 'public'::regnamespace
           and pc.relnamespace = 'public'::regnamespace
           and cc.relname::text in (select tbl from pg_temp.oar_tables)
         group by 1
      ) sub
     where x.tbl = sub.child and x.depth < sub.d;
    get diagnostics v_n = row_count;
    exit when v_n = 0;
  end loop;

  -- Delete what V0 did not have, deepest first.
  for t in select * from pg_temp.oar_tables order by depth desc, tbl loop
    v_n := coalesce(array_length(t.path, 1), 0);
    if v_n = 0 or v_n % 2 = 0 then
      raise exception 'order_amendment_revert: trg_order_lock on % carries an unreadable path %', t.tbl, t.path;
    end if;
    v_expr := format('%I = $1', t.path[v_n]);
    v_i := v_n - 2;
    while v_i >= 1 loop
      v_expr := format('%I in (select id from public.%I where %s)', t.path[v_i], t.path[v_i + 1], v_expr);
      v_i := v_i - 2;
    end loop;
    if t.tbl = 'garment_order_amendments' then continue; end if;
    select coalesce(array_agg((x ->> 'id')::uuid), array[]::uuid[]) into v_ids
      from jsonb_array_elements(e.order_snapshot -> t.tbl) x;
    execute format('delete from public.%I t where (%s) and not (t.id = any($2))', t.tbl, v_expr)
      using e.garment_order_id, v_ids;
  end loop;

  -- Upsert V0, parents first, by id.
  for t in select * from pg_temp.oar_tables order by depth, tbl loop
    v_rows := e.order_snapshot -> t.tbl;
    if v_rows is null or jsonb_array_length(v_rows) = 0 then continue; end if;
    -- Only columns that exist today AND were captured (a column added after
    -- the snapshot keeps its default rather than an explicit NULL).
    select string_agg(format('%I', a.attname), ', ' order by a.attnum),
           string_agg(format('%1$I = excluded.%1$I', a.attname), ', ' order by a.attnum)
             filter (where a.attname <> 'id'
                       and not (t.tbl = 'garment_order_amendments' and a.attname = any(v_bk)))
      into v_cols, v_set
      from pg_catalog.pg_attribute a
     where a.attrelid = format('public.%I', t.tbl)::regclass
       and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
       and (v_rows -> 0) ? a.attname::text;
    execute format(
      'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) '
      'on conflict (id) do update set %3$s',
      t.tbl, v_cols, v_set
    ) using v_rows;
  end loop;

  -- ---- The budget: lines and orders while it is not approved, then its row ----
  v_bud := e.budget_snapshot;

  delete from public.order_budget_lines l
   where l.budget_id = e.budget_id
     and not (l.id = any(coalesce((select array_agg((x ->> 'id')::uuid) from jsonb_array_elements(v_bud -> 'lines') x), array[]::uuid[])));
  delete from public.order_budget_orders o
   where o.budget_id = e.budget_id
     and not (o.id = any(coalesce((select array_agg((x ->> 'id')::uuid) from jsonb_array_elements(v_bud -> 'orders') x), array[]::uuid[])));

  foreach v_expr in array array['order_budget_orders', 'order_budget_lines'] loop
    v_rows := v_bud -> (case v_expr when 'order_budget_orders' then 'orders' else 'lines' end);
    if v_rows is null or jsonb_array_length(v_rows) = 0 then continue; end if;
    select string_agg(format('%I', a.attname), ', ' order by a.attnum),
           string_agg(format('%1$I = excluded.%1$I', a.attname), ', ' order by a.attnum) filter (where a.attname <> 'id')
      into v_cols, v_set
      from pg_catalog.pg_attribute a
     where a.attrelid = format('public.%I', v_expr)::regclass
       and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
       and (v_rows -> 0) ? a.attname::text;
    execute format(
      'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) '
      'on conflict (id) do update set %3$s',
      v_expr, v_cols, v_set
    ) using v_rows;
  end loop;

  -- The budget row LAST: its status going back to approved (V0's decision) is
  -- what re-locks the RE, through sync_re_status_from_budget.
  select string_agg(format('%I', a.attname), ', ' order by a.attnum)
    into v_cols
    from pg_catalog.pg_attribute a
   where a.attrelid = 'public.order_budgets'::regclass
     and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
     and a.attname not in ('id', 'code', 'created_at', 'created_by')
     and (v_bud -> 'budget') ? a.attname::text;
  execute format(
    'update public.order_budgets b set (%1$s) = (select %1$s from jsonb_populate_record(null::public.order_budgets, $1)) where b.id = $2',
    v_cols
  ) using v_bud -> 'budget', e.budget_id;

  -- ---- Close ------------------------------------------------------------------
  update public.order_budget_revisions
     set reverting_txid = null,
         rejection_reason = case when p_outcome = 'rejected' then nullif(btrim(coalesce(p_reason, '')), '') else rejection_reason end,
         revert_error = null
   where id = p_entry;
  perform public.close_order_amendment(p_entry, p_outcome);
end;
$$;

comment on function public.order_amendment_revert(uuid, text, text) is
  'Restore the order, both BOMs and the budget to the entry''s V0 snapshots and '
  'close it (rejected | abandoned). Internal. 0619; table ranking fixed 0626.';

revoke all on function public.order_amendment_revert(uuid, text, text) from public, anon, authenticated;
