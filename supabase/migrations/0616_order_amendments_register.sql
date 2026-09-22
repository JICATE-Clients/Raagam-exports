-- ============================================================================
-- Raagam ERP — 0616 Orders ▸ Order Amendments: the sub-module's database half
--
-- `doc/order/amedment.md` (the register, the variance audit, the MD gate) on
-- top of 0604 (the scoped unlock). 0615 is `store_keeper_grants`, applied by a
-- parallel session — read the LEDGER, not the directory, before choosing a
-- number (raagam-migration-number-collision).
--
-- WHAT 0604 LEFT, AND THIS CLOSES
--
--   1. AN ENTRY CARRIES ONE TYPE; THE SPEC'S CHANGE CATEGORY IS A MULTI-SELECT.
--      A buyer who cuts the quantity AND moves the date is one amendment, not
--      two. `amendment_types text[]` joins `amendment_type`, and the frozen
--      scope becomes the UNION of the types' scopes. `amendment_type` stays —
--      it is `amendment_types[1]`, kept by trigger, so every reader written
--      against 0576/0604 still reads back, and the legacy CHECK still holds.
--
--   2. THE TRIGGER READ THE SEED, NOT THE FROZEN SCOPE. 0604 froze `scope` on
--      the entry "so editing the seed cannot widen an open entry" and then had
--      `order_amendment_refusal` look the type up in `order_amendment_scopes`
--      anyway. The refusal now takes the entry's own `scope` jsonb — which is
--      what makes a union-of-types scope enforceable without a second table.
--
--   3. NO V0 OF THE ORDER. 0604 froze the BUDGET's baseline (the money); the
--      spec's §2 wants Order Entry + Material BOM + Fabric BOM too, and the
--      register's "what changed" needs it. `order_amendment_snapshot(order)`
--      walks every table carrying `trg_order_lock` — its path back to the order
--      is already declared in the trigger's own arguments (0576) — so a locked
--      table added later is snapshotted without anyone remembering this file.
--      `order_amendment_changes(entry)` diffs that snapshot against a fresh
--      one: the spec's field-level log, DERIVED rather than logged — a logging
--      trigger would fire once per row of the ~20 child grids Order Entry
--      deletes and reinserts on every save, most of them unchanged.
--
--   4. NOTHING CLOSED THE ENTRY. `close_order_amendment(…, 'reapproved')` was
--      written for `approval_apply_terminal` (0505) to call, and the call was
--      never added. It is added here, IN THE TRIGGER — a callback in the action
--      bar covers the happy path and strands a cancelled or swept run.
--
--   5. NO WAY OUT BUT RE-APPROVAL. `abandon_order_amendment` is the
--      merchandiser's door back. Two outcomes, decided by the diff above:
--        - NOTHING CHANGED  -> the V0 approval is restored exactly (the budget
--          goes back to approved with its original decision, the RE re-locks).
--          The spec's "REJECT: amendment reverted, active baseline remains V0".
--        - SOMETHING CHANGED -> the entry closes and the RE stays OPEN with its
--          budget in draft — the approver's own reopen state. The approval no
--          longer describes the data, so re-locking would be a lie; the way
--          back is a fresh budget approval. A generic table-by-table RESTORE
--          from the snapshot is deliberately NOT built here: unlocked tables
--          (T&A) reference the locked rows, and a delete-and-reinsert restore
--          would cascade through them. Refusing to guess is the safer half.
--      An entry whose budget is WITH THE APPROVER cannot be abandoned — the
--      decision is theirs now; a reject brings it back.
--
-- THE MD GATE (spec §5) NEEDS NOTHING HERE. The budget's submit already starts
-- an approval run, the push already goes to the step's approvers, and the PO
-- gate (`refuseReopenedBudget`) already refuses to buy for an order whose
-- budget carries a revision and is not approved — which is exactly the state
-- `open_order_amendment` puts it in. The margin figures ride in the run's
-- context from TypeScript (`submitBudget`), where the budget's own engine
-- computes them; a second profit calculation in SQL would be a second answer.
-- ============================================================================


-- ---------- 1. Change Category is a multi-select --------------------------------

alter table public.order_budget_revisions
  add column if not exists amendment_types text[],
  add column if not exists order_snapshot  jsonb;

update public.order_budget_revisions
   set amendment_types = array[amendment_type]
 where amendment_types is null;

-- `amendment_type` is the FIRST of `amendment_types`, always. A reader that
-- never learned about the array reads the leading category; the array is the
-- whole answer. Kept by trigger rather than trusted to every writer.
create or replace function public.order_budget_revision_types_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if NEW.amendment_types is null or coalesce(array_length(NEW.amendment_types, 1), 0) = 0 then
    NEW.amendment_types := array[NEW.amendment_type];
  end if;
  NEW.amendment_type := NEW.amendment_types[1];
  return NEW;
end;
$$;

drop trigger if exists trg_obr_types_sync on public.order_budget_revisions;
create trigger trg_obr_types_sync
  before insert or update on public.order_budget_revisions
  for each row execute function public.order_budget_revision_types_sync();

alter table public.order_budget_revisions alter column amendment_types set not null;

alter table public.order_budget_revisions drop constraint if exists chk_obr_types_known;
alter table public.order_budget_revisions
  add constraint chk_obr_types_known check (
    array_length(amendment_types, 1) >= 1
    and amendment_types <@ array[
      'qty_addition', 'qty_cancellation', 'price_change', 'delivery_date_ext',
      'combo_colour_change', 'bom_revision',
      'quantity', 'colour', 'price', 'sizes', 'delivery_date',
      'consignee', 'packing', 'style', 'internal_error', 'other'
    ]
    and amendment_type = amendment_types[1]
  );

comment on column public.order_budget_revisions.amendment_types is
  'The Change Category — one or more of the six scoped types (0604), or one '
  'legacy type from Budget ▸ Reopen. amendment_type is always the first. The '
  'frozen scope is the UNION of the types'' scopes. 0616.';
comment on column public.order_budget_revisions.order_snapshot is
  'V0 of the ORDER: every row of every table trg_order_lock guards, keyed by '
  'table, as it stood when the entry opened (order_amendment_snapshot). The '
  'money baseline is `baseline`; this is the document. NULL from the '
  'approver''s door and on rows before 0616. 0616.';

-- Labels for a set of types: "Quantity Addition + Delivery Date Extension".
create or replace function public.order_amendment_types_label(p_types text[])
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (select string_agg(public.order_amendment_type_label(t), ' + ' order by ord)
       from unnest(p_types) with ordinality as u(t, ord)),
    'an amendment');
$$;


-- ---------- 2. V0 of the order — generic over trg_order_lock -----------------------

/**
 * Every row of every locked table that belongs to this order document, keyed by
 * table name. The path from each table back to the order is READ OFF THE
 * TRIGGER'S OWN ARGUMENTS (0576 declares it there for the lock), so this is one
 * declaration with two readers rather than a second list that rots.
 *
 * INTERNAL: reads every locked table past RLS. Called by order_amendment_record
 * and order_amendment_changes, never granted to a role.
 */
create or replace function public.order_amendment_snapshot(p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t      record;
  v_path text[];
  v_n    int;
  v_i    int;
  v_expr text;
  v_rows jsonb;
  v_out  jsonb := '{}'::jsonb;
begin
  for t in
    select c.relname::text as tbl,
           array_remove(string_to_array(encode(g.tgargs, 'escape'), '\000'), '') as path
      from pg_catalog.pg_trigger g
      join pg_catalog.pg_class c on c.oid = g.tgrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where g.tgname = 'trg_order_lock' and n.nspname = 'public'
     order by c.relname
  loop
    v_path := t.path;
    v_n := coalesce(array_length(v_path, 1), 0);
    if v_n = 0 or v_n % 2 = 0 then
      raise exception '0616: trg_order_lock on % carries an unreadable path %', t.tbl, v_path;
    end if;
    -- Innermost: the last column names the order. Then each (column, parent)
    -- pair outward: this table's column is in the parent's ids that satisfy
    -- the condition built so far.
    v_expr := format('%I = $1', v_path[v_n]);
    v_i := v_n - 2;
    while v_i >= 1 loop
      v_expr := format('%I in (select id from public.%I where %s)', v_path[v_i], v_path[v_i + 1], v_expr);
      v_i := v_i - 2;
    end loop;
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(t) order by t.id), ''[]''::jsonb) from public.%I t where %s',
      t.tbl, v_expr
    ) into v_rows using p_order;
    v_out := v_out || jsonb_build_object(t.tbl, v_rows);
  end loop;
  return v_out;
end;
$$;

comment on function public.order_amendment_snapshot(uuid) is
  'V0 of an order document — every locked table''s rows, keyed by table, the '
  'path read from trg_order_lock''s own arguments. Internal. 0616.';

/**
 * What an open (or closed) entry changed, table by table: rows added, removed
 * and changed against the frozen V0, and — for the order header — WHICH
 * columns moved. Bookkeeping columns (the lock allowlist + updated_at) are not
 * changes.
 *
 * The spec's "field-level change log", derived. Read by the register, the
 * variance screen and `abandon_order_amendment` (which restores V0 only when
 * this returns nothing).
 */
create or replace function public.order_amendment_changes_of(p_entry uuid)
returns table (
  table_name      text,
  area            text,
  rows_added      int,
  rows_removed    int,
  rows_changed    int,
  changed_columns text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bk    constant text[] := array[
    're_status', 're_status_at', 're_amendment_id', 'approval_status',
    'approved_by', 'approved_at', 'approval_reason', 'updated_at'
  ];
  v_order uuid;
  v_v0    jsonb;
  v_now   jsonb;
  v_tbl   text;
  v_old   jsonb;
  v_new   jsonb;
begin
  select r.garment_order_id, r.order_snapshot into v_order, v_v0
    from public.order_budget_revisions r where r.id = p_entry;
  if v_order is null or v_v0 is null then
    return;
  end if;
  v_now := public.order_amendment_snapshot(v_order);

  for v_tbl in select k from jsonb_object_keys(v_v0) k order by k loop
    v_old := coalesce(v_v0 -> v_tbl, '[]'::jsonb);
    v_new := coalesce(v_now -> v_tbl, '[]'::jsonb);
    return query
      with o as (select e ->> 'id' as rid, e - v_bk as body from jsonb_array_elements(v_old) e),
           n as (select e ->> 'id' as rid, e - v_bk as body from jsonb_array_elements(v_new) e),
           j as (select o.rid as o_id, n.rid as n_id, o.body as o_body, n.body as n_body
                   from o full outer join n on n.rid = o.rid)
      select v_tbl,
             public.order_amendment_area_label(v_tbl::name)::text,
             count(*) filter (where j.o_id is null)::int,
             count(*) filter (where j.n_id is null)::int,
             count(*) filter (where j.o_id is not null and j.n_id is not null and j.o_body <> j.n_body)::int,
             case when v_tbl = 'garment_order_amendments' then
               (select array_agg(k order by k)
                  from j j2, jsonb_object_keys(j2.n_body) k
                 where j2.o_id is not null and j2.n_id is not null
                   and (j2.n_body -> k) is distinct from (j2.o_body -> k))
             end
        from j
      having count(*) filter (where j.o_id is null) > 0
          or count(*) filter (where j.n_id is null) > 0
          or count(*) filter (where j.o_id is not null and j.n_id is not null and j.o_body <> j.n_body) > 0;
  end loop;
end;
$$;

-- INTERNAL (no permission check, not granted): abandon_order_amendment and the
-- $verify$ probe read it. The screen reads the gated wrapper below.
comment on function public.order_amendment_changes_of(uuid) is
  'Rows added / removed / changed per locked table since the entry''s V0, and '
  'the header''s changed columns. Empty = nothing changed. Internal. 0616.';

create or replace function public.order_amendment_changes(p_entry uuid)
returns table (
  table_name      text,
  area            text,
  rows_added      int,
  rows_removed    int,
  rows_changed    int,
  changed_columns text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('orders', 'view') then
    raise exception using message = 'You do not have permission to read amendments', errcode = '42501';
  end if;
  return query select * from public.order_amendment_changes_of(p_entry);
end;
$$;

comment on function public.order_amendment_changes(uuid) is
  'The screen''s door onto order_amendment_changes_of — orders:view. 0616.';


-- ---------- 3. The trigger reads the FROZEN scope -------------------------------

drop function if exists public.order_amendment_of(uuid, uuid);
create or replace function public.order_amendment_of(p_order uuid, p_sales_order uuid default null)
returns table (
  amending_order_id uuid,
  entry_id          uuid,
  entry_no          text,
  amendment_type    text,
  amendment_types   text[],
  scope             jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select coalesce(
      p_sales_order,
      (select a.sales_order_id from public.garment_order_amendments a where a.id = p_order)
    ) as so
  )
  select a.id, r.id, r.entry_no, r.amendment_type, r.amendment_types, r.scope
    from public.garment_order_amendments a
    cross join me
    join public.order_budget_revisions r on r.id = a.re_amendment_id
   where a.re_status = 'amending'
     and (a.id = p_order or (me.so is not null and a.sales_order_id = me.so))
   order by (a.id = p_order) desc
   limit 1;
$$;

comment on function public.order_amendment_of(uuid, uuid) is
  'The open Amendment Entry scoping this order''s RE No, with its frozen scope '
  '— no row when none is open. Same grain as order_lock_of(). 0604 · 0616.';

drop function if exists public.order_amendment_refusal(text, text, name, text, text[]);
/**
 * Why a write is refused while an order is AMENDING — NULL to allow.
 *
 * `p_scope` is the ENTRY's frozen scope: `{ table: { columns, insert, delete } }`,
 * `columns` null = the whole table. A table absent from it refuses everything
 * (an allowlist). `p_changed` is the columns an UPDATE actually changed, with
 * bookkeeping removed; NULL for INSERT / DELETE.
 */
create or replace function public.order_amendment_refusal(
  p_entry_no text,
  p_label    text,
  p_scope    jsonb,
  p_table    name,
  p_op       text,
  p_changed  text[]
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_t       jsonb := p_scope -> p_table::text;
  v_cols    text[];
  v_outside text[];
  v_head    text;
begin
  v_head := 'This amendment (' || coalesce(nullif(btrim(p_entry_no), ''), 'open') || ') is a '
            || coalesce(nullif(btrim(p_label), ''), 'an amendment') || ' — ';

  if v_t is null then
    return v_head || public.order_amendment_area_label(p_table)
           || ' is not open to it. Close it and raise the right kind of amendment, or change the type.';
  end if;

  if p_op = 'INSERT' then
    if coalesce((v_t ->> 'insert')::boolean, false) then return null; end if;
    return v_head || 'a new ' || public.order_amendment_area_label(p_table)
           || ' row cannot be added under it.';
  elsif p_op = 'DELETE' then
    if coalesce((v_t ->> 'delete')::boolean, false) then return null; end if;
    return v_head || 'a ' || public.order_amendment_area_label(p_table)
           || ' row cannot be removed under it.';
  end if;

  if v_t -> 'columns' is null or jsonb_typeof(v_t -> 'columns') = 'null' then return null; end if;
  select array_agg(x) into v_cols from jsonb_array_elements_text(v_t -> 'columns') x;
  select array_agg(c order by c) into v_outside
    from unnest(coalesce(p_changed, array[]::text[])) c
   where not (c = any(coalesce(v_cols, array[]::text[])));
  if v_outside is null then return null; end if;

  return v_head || array_to_string(v_outside, ', ')
         || case when array_length(v_outside, 1) = 1 then ' is' else ' are' end
         || ' not open to it. Only ' || array_to_string(v_cols, ', ')
         || ' can be changed on ' || public.order_amendment_area_label(p_table) || '.';
end;
$$;

create or replace function public.refuse_when_order_locked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allow constant text[] := array[
    're_status', 're_status_at', 're_amendment_id', 'approval_status',
    'approved_by', 'approved_at', 'approval_reason', 'updated_at'
  ];
  v_rows    jsonb[];
  v_row     jsonb;
  v_msg     text;
  v_order   uuid;
  v_so      uuid;
  v_changed text[];
  v_am      record;
begin
  if TG_OP = 'UPDATE' then
    if (to_jsonb(NEW) - v_allow) = (to_jsonb(OLD) - v_allow) then
      return NEW;
    end if;
    select array_agg(k order by k) into v_changed
      from jsonb_object_keys(to_jsonb(NEW)) as k
     where not (k = any(v_allow))
       and (to_jsonb(NEW) -> k) is distinct from (to_jsonb(OLD) -> k);
    v_rows := array[to_jsonb(OLD), to_jsonb(NEW)];
  elsif TG_OP = 'INSERT' then
    v_rows := array[to_jsonb(NEW)];
  else
    v_rows := array[to_jsonb(OLD)];
  end if;

  foreach v_row in array v_rows loop
    if TG_TABLE_NAME = 'garment_order_amendments' then
      v_order := (v_row ->> 'id')::uuid;
      v_so    := (v_row ->> 'sales_order_id')::uuid;
    else
      v_order := public.order_lock_row_order(v_row, TG_ARGV);
      v_so    := null;
    end if;

    -- 1. THE HARD LOCK FIRST.
    v_msg := public.order_lock_message(v_order, v_so);
    if v_msg is not null then
      raise exception using message = v_msg, errcode = 'P0001', hint = 'order_locked';
    end if;

    -- 2. THEN THE FROZEN SCOPE (0616: the entry's own, not the seed's).
    select * into v_am from public.order_amendment_of(v_order, v_so);
    if v_am.entry_id is not null then
      v_msg := public.order_amendment_refusal(
        v_am.entry_no,
        public.order_amendment_types_label(v_am.amendment_types),
        coalesce(v_am.scope, '{}'::jsonb),
        TG_TABLE_NAME, TG_OP, v_changed
      );
      if v_msg is not null then
        raise exception using message = v_msg, errcode = 'P0001', hint = 'order_out_of_amendment_scope';
      end if;
    end if;
  end loop;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

drop function if exists public.order_amendment_scope_of(uuid);
create or replace function public.order_amendment_scope_of(p_order uuid)
returns table (
  entry_id        uuid,
  entry_no        text,
  amendment_type  text,
  amendment_types text[],
  scope           jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.entry_id, m.entry_no, m.amendment_type, m.amendment_types, m.scope
    from public.order_amendment_of(p_order) m;
$$;


-- ---------- 4. The union scope, and the multi-type door ---------------------------

drop function if exists public.order_amendment_record(uuid, uuid, text, text, text, jsonb, boolean);
create or replace function public.order_amendment_record(
  p_budget_id uuid,
  p_order_id  uuid,
  p_source    text,
  p_types     text[],
  p_reason    text,
  p_baseline  jsonb,
  p_scoped    boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_by     uuid;
  v_at     timestamptz;
  v_no     int;
  v_entry  uuid;
  v_scope  jsonb;
  v_types  text[];
  v_t      text;
  r        record;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception using message = 'Say why this order is being amended', errcode = '22023';
  end if;
  if p_baseline is null then
    raise exception using message = 'The approved baseline is missing — nothing was amended', errcode = '22023';
  end if;
  -- De-duplicated, order kept: the first is `amendment_type`.
  select array_agg(t order by ord) into v_types
    from (select t, min(ord) as ord from unnest(p_types) with ordinality as u(t, ord)
           where nullif(btrim(t), '') is not null group by t) d;
  if v_types is null then
    raise exception using message = 'Pick at least one Change Category', errcode = '22023';
  end if;

  select b.status, b.decided_by, b.decided_at
    into v_status, v_by, v_at
    from public.order_budgets b
   where b.id = p_budget_id
     for update;
  if not found then
    raise exception using message = 'That budget no longer exists', errcode = 'P0002';
  end if;
  if v_status <> 'approved' then
    raise exception using
      message = format('Only an approved budget can be amended — this one is %s', v_status),
      errcode = 'P0001';
  end if;

  if p_scoped then
    -- EVERY TYPE MUST CARRY A SCOPE, named when it does not.
    foreach v_t in array v_types loop
      if not exists (select 1 from public.order_amendment_scopes s where s.amendment_type = v_t) then
        raise exception using
          message = format('%s has no field scope declared — it cannot be raised', public.order_amendment_type_label(v_t)),
          errcode = '22023';
      end if;
    end loop;
    -- THE UNION, FROZEN. A table any type opens whole is open whole; otherwise
    -- the columns are the union; insert / delete if any type allows it.
    v_scope := '{}'::jsonb;
    for r in
      select s.table_name::text as tbl,
             bool_or(s.columns is null) as whole,
             array_remove(array_agg(distinct c), null) as cols,
             bool_or(s.allows_insert) as ins,
             bool_or(s.allows_delete) as del
        from public.order_amendment_scopes s
        left join lateral unnest(coalesce(s.columns, array[]::text[])) c on true
       where s.amendment_type = any(v_types)
       group by s.table_name
    loop
      v_scope := v_scope || jsonb_build_object(r.tbl, jsonb_build_object(
        'columns', case when r.whole then null else to_jsonb(r.cols) end,
        'insert', r.ins, 'delete', r.del));
    end loop;
  end if;

  select coalesce(max(rv.revision_no), 0) + 1 into v_no
    from public.order_budget_revisions rv
   where rv.budget_id = p_budget_id;

  insert into public.order_budget_revisions (
    budget_id, garment_order_id, revision_no, entry_no, source, amendment_type, amendment_types,
    reason, baseline, scope, order_snapshot, baseline_approved_by, baseline_approved_at, reopened_by
  ) values (
    p_budget_id, p_order_id, v_no, public.next_order_amendment_no(),
    p_source, v_types[1], v_types, btrim(p_reason), p_baseline, v_scope,
    case when p_order_id is not null then public.order_amendment_snapshot(p_order_id) end,
    v_by, v_at, auth.uid()
  ) returning id into v_entry;

  return v_entry;
end;
$$;

-- The multi-category door. The single-type signature below delegates to it so
-- 0604's callers keep working.
create or replace function public.open_order_amendment(
  p_order    uuid,
  p_source   text,
  p_types    text[],
  p_reason   text,
  p_baseline jsonb
)
returns table (entry_id uuid, entry_no text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_so     uuid;
  v_budget uuid;
  v_status text;
  v_open   text;
  v_entry  uuid;
begin
  if not public.has_permission('orders', 'edit') then
    raise exception using message = 'You do not have permission to amend an order', errcode = '42501';
  end if;

  select a.sales_order_id, a.re_status into v_so, v_status
    from public.garment_order_amendments a where a.id = p_order;
  if not found then
    raise exception using message = 'That order no longer exists', errcode = 'P0002';
  end if;

  if v_status = 'amending' then
    select r.entry_no into v_open
      from public.order_budget_revisions r
      join public.garment_order_amendments a on a.re_amendment_id = r.id
     where a.id = p_order;
    raise exception using
      message = format('Amendment %s is already open on this order — close it first', coalesce(v_open, '')),
      errcode = 'P0001';
  elsif v_status <> 'approved' then
    raise exception using
      message = 'This order is not approved, so it needs no amendment — edit it directly',
      errcode = 'P0001';
  end if;

  select l.budget_id into v_budget from public.order_lock_of(p_order, v_so) l;
  if v_budget is null then
    raise exception using
      message = 'This order is locked but its approved budget cannot be read — nothing was amended',
      errcode = 'P0001';
  end if;

  v_entry := public.order_amendment_record(
    v_budget, p_order, p_source, p_types, p_reason, p_baseline, true
  );

  -- 1. THE RE FIRST (0604: `sync_re_status_from_budget` only moves documents
  --    still reading `approved`, so the budget's own trigger cannot unlock it).
  update public.garment_order_amendments a
     set re_status = 'amending', re_status_at = now(), re_amendment_id = v_entry
   where (a.id = p_order or (v_so is not null and a.sales_order_id = v_so))
     and a.re_status = 'approved';

  -- 2. THEN THE BUDGET — back to draft for its fresh cycle.
  update public.order_budgets
     set status = 'draft', decided_at = null, decided_by = null, decision_remark = null, updated_at = now()
   where id = v_budget;

  return query
    select r.id, r.entry_no from public.order_budget_revisions r where r.id = v_entry;
end;
$$;

create or replace function public.open_order_amendment(
  p_order    uuid,
  p_source   text,
  p_type     text,
  p_reason   text,
  p_baseline jsonb
)
returns table (entry_id uuid, entry_no text)
language sql
security definer
set search_path = ''
as $$
  select * from public.open_order_amendment(p_order, p_source, array[p_type], p_reason, p_baseline);
$$;


-- ---------- 5. The merchandiser's way back -------------------------------------

/**
 * Abandon an open entry. Returns 'restored' when nothing had changed (V0's
 * approval is put back exactly and the RE re-locks) or 'reopened' when
 * something had (the entry closes; the RE stays open with its budget in draft,
 * the approver's own reopen state — a fresh approval is the way back).
 *
 * Refused while the budget is with the approver: the decision is theirs.
 */
create or replace function public.abandon_order_amendment(p_entry uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_budget  uuid;
  v_order   uuid;
  v_by      uuid;
  v_at      timestamptz;
  v_bstatus text;
  v_changed int;
begin
  if not public.has_permission('orders', 'edit') then
    raise exception using message = 'You do not have permission to abandon an amendment', errcode = '42501';
  end if;

  select r.budget_id, r.garment_order_id, r.baseline_approved_by, r.baseline_approved_at
    into v_budget, v_order, v_by, v_at
    from public.order_budget_revisions r
   where r.id = p_entry and r.outcome = 'open'
     for update;
  if not found then
    raise exception using message = 'That amendment is not open', errcode = 'P0001';
  end if;
  if v_order is null then
    raise exception using
      message = 'This entry was raised from Budget ▸ Reopen — close it by approving the budget again',
      errcode = 'P0001';
  end if;

  select b.status into v_bstatus from public.order_budgets b where b.id = v_budget for update;
  if v_bstatus = 'submitted' then
    raise exception using
      message = 'The revised budget is with the approver — wait for the decision, or ask them to reject it',
      errcode = 'P0001';
  end if;
  if v_bstatus = 'approved' then
    -- Re-approved under our feet: the terminal trigger closes it; nothing to abandon.
    raise exception using message = 'The revised budget was approved — this amendment is closing', errcode = 'P0001';
  end if;

  select count(*) into v_changed from public.order_amendment_changes_of(p_entry);

  if v_changed = 0 then
    -- V0 STANDS. The budget's original decision goes back on it, which
    -- re-locks the RE through sync_re_status_from_budget; then the entry closes
    -- and close_order_amendment reads `approved` off the covering budget.
    update public.order_budgets
       set status = 'approved', decided_at = v_at, decided_by = v_by, updated_at = now()
     where id = v_budget;
    perform public.close_order_amendment(p_entry, 'abandoned');
    return 'restored';
  end if;

  perform public.close_order_amendment(p_entry, 'abandoned');
  return 'reopened';
end;
$$;

comment on function public.abandon_order_amendment(uuid) is
  'Close an open Amendment Entry without re-approval. ''restored'' = nothing '
  'changed, the V0 approval is back and the RE re-locked; ''reopened'' = '
  'something changed, the RE stays open with its budget in draft. 0616.';


-- ---------- 6. Re-approval closes the entry — in the trigger ----------------------

create or replace function public.approval_apply_terminal()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
    v_remark text;
    v_rows   int;
    v_status text;
    v_entry  uuid;
begin
    if new.status = old.status or new.status = 'in_progress' then
        return new;
    end if;

    select e.comment into v_remark
    from public.approval_run_events e
    where e.run_id = new.id
      and e.action in ('approve', 'reject', 'cancel')
    order by e.created_at desc
    limit 1;

    if new.subject_table = 'order_budgets' then
        if new.status not in ('completed', 'rejected') then
            return new;
        end if;

        v_status := case new.status when 'completed' then 'approved' else 'rejected' end;

        update public.order_budgets b
        set status          = v_status,
            decided_at      = coalesce(new.completed_at, now()),
            decided_by      = new.final_actor_id,
            decision_remark = v_remark,
            updated_at      = now()
        where b.id = new.subject_id
          and b.status = 'submitted';

        get diagnostics v_rows = row_count;

        if v_rows = 0 then
            raise exception
                'approval_apply_terminal: order_budget % is not awaiting a decision, so this approval could not be applied. Reload the budget — it may already have been decided another way.',
                new.subject_id
                using errcode = '55000';
        end if;

        -- 0616: an APPROVED revised budget closes the Amendment Entry open on
        -- any of its orders. The RE is already `approved` again through
        -- sync_re_status_from_budget; this records the outcome and clears the
        -- entry off the documents. A REJECTED one leaves the entry open — the
        -- merchandiser revises and resubmits, or abandons.
        if v_status = 'approved' then
            for v_entry in
                select distinct r.id
                  from public.order_budget_revisions r
                  join public.order_budget_orders o on o.garment_order_id = r.garment_order_id
                 where o.budget_id = new.subject_id
                   and r.outcome = 'open'
                   and r.garment_order_id is not null
            loop
                perform public.close_order_amendment(v_entry, 'reapproved');
            end loop;
        end if;

        return new;
    end if;

    if new.subject_table = 'iwo_budgets' then
        if new.status not in ('completed', 'rejected') then
            return new;
        end if;

        update public.iwo_budgets b
        set status          = case new.status when 'completed' then 'approved' else 'rejected' end,
            decided_at      = coalesce(new.completed_at, now()),
            decided_by      = new.final_actor_id,
            decision_remark = v_remark,
            updated_at      = now()
        where b.id = new.subject_id
          and b.status = 'submitted';

        get diagnostics v_rows = row_count;

        if v_rows = 0 then
            raise exception
                'approval_apply_terminal: iwo_budget % is not awaiting a decision, so this approval could not be applied. Reload the budget — it may already have been decided another way.',
                new.subject_id
                using errcode = '55000';
        end if;

        return new;
    end if;

    raise exception
        'approval_apply_terminal: no terminal callback is implemented for subject_table %. Add a branch in 0505 before starting runs for it.',
        new.subject_table
        using errcode = '0A000';
end $function$;

-- `close_order_amendment` also reads `approved` off the covering budget when the
-- entry is closed by the trigger above — its `has_approved` question — so an
-- amending document whose budget is approved again ends `approved` with no
-- entry on it. Restated here so the two files agree on the sequence.


-- ---------- 7. Grants — BOTH halves, in one statement -------------------------

revoke all on function public.order_budget_revision_types_sync() from public, anon;
revoke all on function public.order_amendment_types_label(text[]) from public, anon;
revoke all on function public.order_amendment_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.order_amendment_changes_of(uuid) from public, anon, authenticated;
revoke all on function public.order_amendment_changes(uuid) from public, anon;
revoke all on function public.order_amendment_of(uuid, uuid) from public, anon;
revoke all on function public.order_amendment_refusal(text, text, jsonb, name, text, text[]) from public, anon;
revoke all on function public.order_amendment_scope_of(uuid) from public, anon;
revoke all on function public.order_amendment_record(uuid, uuid, text, text[], text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.open_order_amendment(uuid, text, text[], text, jsonb) from public, anon;
revoke all on function public.open_order_amendment(uuid, text, text, text, jsonb) from public, anon;
revoke all on function public.abandon_order_amendment(uuid) from public, anon;
revoke all on function public.approval_apply_terminal() from public, anon;

grant execute on function public.order_amendment_types_label(text[]) to authenticated;
grant execute on function public.order_amendment_changes(uuid) to authenticated;
grant execute on function public.order_amendment_of(uuid, uuid) to authenticated;
grant execute on function public.order_amendment_refusal(text, text, jsonb, name, text, text[]) to authenticated;
grant execute on function public.order_amendment_scope_of(uuid) to authenticated;
grant execute on function public.open_order_amendment(uuid, text, text[], text, jsonb) to authenticated;
grant execute on function public.open_order_amendment(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.abandon_order_amendment(uuid) to authenticated;


-- ============================================================================
-- $verify$ — A BEHAVIOUR PROBE, ROLLED BACK (the 0577 lesson).
-- ============================================================================
do $verify$
declare
  x        uuid;
  st       uuid;
  loc      uuid;
  b        uuid;
  e        uuid;
  n        int;
  v_scope  jsonb;
  v_out    text;
  r_union  text := 'not run';
  r_date   text := 'not run';
  r_qty    text := 'not run';
  r_price  text := 'not run';
  r_chg    text := 'not run';
  r_aband  text := 'not run';
  r_lock   text := 'not run';
begin
  -- ---- structure ----------------------------------------------------------
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'order_budget_revisions'
                    and column_name = 'amendment_types') then
    raise exception '0616: amendment_types was not added';
  end if;
  if exists (select 1 from public.order_budget_revisions where amendment_type <> amendment_types[1]) then
    raise exception '0616: a revision''s amendment_type is not its first amendment_types';
  end if;
  if public.order_amendment_types_label(array['qty_addition', 'delivery_date_ext'])
     <> 'Quantity Addition + Delivery Date Extension' then
    raise exception '0616: order_amendment_types_label joins wrongly';
  end if;
  -- The refusal reads the FROZEN scope: a table absent from it refuses.
  if public.order_amendment_refusal('AMD/x', 'Price Change',
       '{"garment_order_amendments":{"columns":["delivery_date"],"insert":false,"delete":false}}'::jsonb,
       'garment_order_amendment_quantities', 'INSERT', null) is null then
    raise exception '0616: a table absent from the frozen scope was allowed';
  end if;
  if public.order_amendment_refusal('AMD/x', 'Price Change',
       '{"garment_order_amendments":{"columns":["delivery_date"],"insert":false,"delete":false}}'::jsonb,
       'garment_order_amendments', 'UPDATE', array['delivery_date']) is not null then
    raise exception '0616: an in-scope column was refused';
  end if;
  if public.order_amendment_refusal('AMD/x', 'Price Change',
       '{"garment_order_amendments":{"columns":["delivery_date"],"insert":false,"delete":false}}'::jsonb,
       'garment_order_amendments', 'UPDATE', array['delivery_date', 'ex_rate']) is null then
    raise exception '0616: an out-of-scope column was allowed';
  end if;
  if has_function_privilege('authenticated', 'public.order_amendment_snapshot(uuid)', 'execute') then
    raise exception '0616: authenticated can execute order_amendment_snapshot — it reads every locked table past RLS';
  end if;
  if has_function_privilege('anon', 'public.abandon_order_amendment(uuid)', 'execute') then
    raise exception '0616: anon can abandon an amendment';
  end if;

  -- ---- behaviour, on a real order — skipped on an empty database ------------
  select a.id into x from public.garment_order_amendments a
   where exists (select 1 from public.garment_order_amendment_styles s where s.amendment_id = a.id)
     and a.re_status = 'open'
     and a.delivery_date is not null
   limit 1;
  select id into loc from public.locations limit 1;
  if x is null or loc is null then
    raise notice '0616: no open order with styles — behaviour probe skipped';
    return;
  end if;
  select s.id into st from public.garment_order_amendment_styles s where s.amendment_id = x limit 1;

  begin
    insert into public.order_budgets (budget_date, status, location_id)
    values (current_date, 'draft', loc) returning id into b;
    insert into public.order_budget_orders (budget_id, garment_order_id, sales_refusal)
    values (b, x, '0616 verify');
    update public.order_budgets
       set status = 'approved', decided_at = now(), decided_by = gen_random_uuid()
     where id = b;

    -- 1. A TWO-TYPE ENTRY: Delivery Date Extension + Quantity Addition. The
    --    frozen scope is the union, and the snapshot is taken.
    e := public.order_amendment_record(b, x, 'customer',
           array['delivery_date_ext', 'qty_addition'], '0616 verify', '{"v":1}'::jsonb, true);
    select r.scope into v_scope from public.order_budget_revisions r where r.id = e;
    r_union := case
      when v_scope -> 'garment_order_amendments' -> 'columns' @> '["delivery_date"]'
       and v_scope -> 'garment_order_amendments' -> 'columns' @> '["excess_pct"]'
       and (v_scope -> 'garment_order_amendment_quantities' ->> 'insert')::boolean
      then 'union' else 'wrong: ' || coalesce(v_scope::text, 'null') end;
    if (select r.order_snapshot -> 'garment_order_amendments' from public.order_budget_revisions r where r.id = e) is null then
      raise exception '0616: the entry froze no order snapshot';
    end if;

    update public.garment_order_amendments a
       set re_status = 'amending', re_status_at = now(), re_amendment_id = e
     where a.id = x and a.re_status = 'approved';
    update public.order_budgets set status = 'draft', decided_at = null, decided_by = null where id = b;

    -- 2. Nothing changed yet.
    select count(*) into n from public.order_amendment_changes_of(e);
    r_chg := case when n = 0 then 'none' else 'wrong: ' || n end;

    -- 3. The date IS open (from the first type)…
    begin
      update public.garment_order_amendments set delivery_date = delivery_date + 1 where id = x;
      r_date := 'allowed';
    exception when others then r_date := 'refused: ' || sqlerrm;
    end;
    -- 4. …a quantities INSERT IS open (from the second)…
    begin
      insert into public.garment_order_amendment_quantities (amendment_id, sno) values (x, 9902);
      r_qty := 'allowed';
    exception when others then r_qty := 'refused: ' || sqlerrm;
    end;
    -- 5. …and a style-price write is NOT, and the refusal names BOTH types.
    begin
      update public.garment_order_amendment_styles
         set description = coalesce(description, '') || ' 0616' where id = st;
      r_price := 'NOT refused';
    exception when others then
      r_price := case when sqlerrm like '%Delivery Date Extension + Quantity Addition%'
                      then 'refused' else 'wrong error: ' || sqlerrm end;
    end;

    -- 6. The diff now sees the header column and the added row.
    if not exists (select 1 from public.order_amendment_changes_of(e) c
                    where c.table_name = 'garment_order_amendments' and 'delivery_date' = any(c.changed_columns)) then
      raise exception '0616: the changes diff missed the delivery_date update';
    end if;
    if not exists (select 1 from public.order_amendment_changes_of(e) c
                    where c.table_name = 'garment_order_amendment_quantities' and c.rows_added = 1) then
      raise exception '0616: the changes diff missed the added quantities row';
    end if;

    -- 7. Abandon WITH changes: the RE goes open, the budget stays draft.
    --    (has_permission is not readable here; the body after the gate is
    --    exercised through close_order_amendment, which abandon calls.)
    perform public.close_order_amendment(e, 'abandoned');
    select a.re_status into v_out from public.garment_order_amendments a where a.id = x;
    r_aband := case when v_out = 'open' then 'reopened' else 'wrong: ' || v_out end;

    -- 8. The restore path: re-approve, open a second entry, change nothing,
    --    restore the approval — the RE re-locks and the entry is closed.
    update public.order_budgets set status = 'approved', decided_at = now(), decided_by = gen_random_uuid() where id = b;
    e := public.order_amendment_record(b, x, 'internal', array['price_change'], '0616 verify 2', '{"v":1}'::jsonb, true);
    update public.garment_order_amendments a
       set re_status = 'amending', re_status_at = now(), re_amendment_id = e
     where a.id = x and a.re_status = 'approved';
    update public.order_budgets set status = 'draft', decided_at = null, decided_by = null where id = b;
    select count(*) into n from public.order_amendment_changes_of(e);
    if n <> 0 then raise exception '0616: a fresh entry reports % changed tables', n; end if;
    update public.order_budgets set status = 'approved', decided_at = now(), decided_by = gen_random_uuid() where id = b;
    perform public.close_order_amendment(e, 'abandoned');
    select a.re_status into v_out from public.garment_order_amendments a where a.id = x;
    begin
      update public.garment_order_amendments set po_no = coalesce(po_no, '') || ' 0616' where id = x;
      r_lock := 'NOT refused';
    exception when others then
      r_lock := case when sqlerrm like '%Please use Garment Order Amendment%' then 'refused' else 'wrong error: ' || sqlerrm end;
    end;
    if v_out <> 'approved' then raise exception '0616: restore left the RE %', v_out; end if;

    raise exception using message = '0616 rollback', errcode = 'P0616';
  exception when others then
    if sqlerrm <> '0616 rollback' then
      raise exception '0616 verify failed inside the probe: %', sqlerrm;
    end if;
  end;

  if r_union <> 'union' then raise exception '0616: the scope was not a union — %', r_union; end if;
  if r_chg <> 'none' then raise exception '0616: a fresh entry reported changes — %', r_chg; end if;
  if r_date <> 'allowed' then raise exception '0616: the delivery date was %', r_date; end if;
  if r_qty <> 'allowed' then raise exception '0616: the quantities insert was %', r_qty; end if;
  if r_price <> 'refused' then raise exception '0616: the style write was %', r_price; end if;
  if r_aband <> 'reopened' then raise exception '0616: abandon with changes — %', r_aband; end if;
  if r_lock <> 'refused' then raise exception '0616: after the restore the order was %', r_lock; end if;
  raise notice '0616: verified — union scope, frozen-scope refusal, diff, abandon (reopened), restore (re-locked)';
end
$verify$;
