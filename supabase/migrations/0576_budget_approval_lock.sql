-- ============================================================================
-- Raagam ERP — 0576 Budget approval LOCKS the order; the Amendment Protocol
-- unlocks it
--
-- `doc/order/budget-purchase-rates.md` "Phase 5 — CONTRACT", doc/order/budget.md
-- §4, and the user's restatement of the Hard Lock Rules:
--
--   "When approved, set RE Status = APPROVED. Execute database lock triggers to
--    set Order Entry, Fabric PLM and Material PLM to Read-Only / Locked for this
--    RE No. This protects the projected profit margin from unauthorized edits to
--    quantities, price, or fabric weight."
--
--
-- 1. `re_status` IS STORED, AND HAS ONE WRITER
--
-- `garment_order_amendments.re_status` ('open' | 'approved') + `re_status_at`.
-- The spec says "set", and it is right: every lock trigger below, the order
-- list and the three editors read ONE column with no join. Its only writer is
-- `sync_re_status_from_budget()`, AFTER UPDATE OF status ON order_budgets:
-- → approved sets the budget's orders approved; approved → anything sets them
-- open again. SECURITY DEFINER because the approver may hold `orders:approve`
-- without `orders:edit` — an invoker-rights update would be filtered to zero
-- rows by RLS, and the order would stay unlocked with no error at all.
--
--
-- 2. THE LOCK IS PER RE NO, NOT PER DOCUMENT
--
-- A garment order is one `sales_orders` row (the RE No) and one or more
-- `garment_order_amendments` documents — an amendment is another document on
-- the same `sales_order_id` (0517). A budget names ONE document. Locking only
-- that row would leave the RE editable by raising an amendment beside it, so
-- "locked" means: this document, or any document of the same RE No, is
-- approved. `order_lock_of()` is that one definition; the triggers and
-- `lib/orders/budget/lock.ts` both call it.
--
--
-- 3. PARENTS AND CHILDREN, FROM THE CATALOG
--
-- Order Entry saves by deleting and re-inserting ~20 child grids, so a
-- parent-only lock leaves quantities and prices writable through a child
-- table. ONE trigger function, `refuse_when_order_locked()`, is attached to
-- the three parents and to every child found by walking the foreign keys INTO
-- them (measured on the live catalog 2026-09-18 — one, two and three hops). Its
-- TG_ARGV is the path from the row to the garment order:
--
--     ('amendment_id')                                    a direct child
--     ('bom_id', 'order_fabric_boms', 'garment_order_id') one table up, then
--                                                         that table's column
--     … and so on, in (table, column) pairs.
--
-- ATTACHED (47):
--   garment_order_amendments (I/U/D — an INSERT is a new document of an RE)
--   order_fabric_boms, material_bom_amendments (I/U/D, via garment_order_id;
--     a Material BOM with no order passes)
--   Order Entry, by amendment_id: approval_qtys, charges, combos,
--     country_sizes, dyeings, files, pack_components, pack_type_lines,
--     pack_types, price_details, prints, quantities, structures,
--     style_components, style_coordinates, style_prices, style_processes,
--     style_sizes, styles
--   Order Entry, deeper: combo_structures (combo_id), combo_components
--     (structure_id → combo_structures), assort_lines (quantity_id),
--     assort_line_sizes (line_id → assort_lines)
--   Fabric BOM, by bom_id: dias, lines, manual_entries, process_scope,
--     processes, requirements, yarns, yd_combinations, yd_repeats
--   Fabric BOM, deeper: manual_combos, manual_components, manual_sizes
--     (entry_id), yarn_stages (yarn_id), yd_combination_colors (combination_id)
--   Material BOM, by amendment_id: items, processes, requirements
--   Material BOM, deeper: item_components, item_slices (item_line_id)
--
-- EXCLUDED, each for a reason:
--   garment_order_amendment_ta_activities / _ta_approvals / _ta_approval_history
--     (0481 · 0537 · 0544) — T&A is EXECUTION, not plan. Its whole life starts
--     after approval; locking it would freeze the calendar the approval opens.
--   production_entries — the floor's output. Execution.
--   dc_line_items — delivery challans raised off Material BOM processes.
--     Execution (it READS the process rows, which are locked).
--   order_budget_orders / order_budget_lines — the budget itself. Guarded
--     separately below: frozen while their budget is approved.
--   order_cad_markers / _marker_layouts / order_cad_component_weights — CAD's
--     own worksheets. They change no costed figure until APPLIED, and applying
--     writes the Fabric BOM, which is locked; blocking the worksheet would stop
--     a cutting-room marker being drawn for an order already in production.
--   order_fabric_plans / _plan_lines / _plan_stages (0427) — nothing in the
--     budget reads them, so they cannot move the margin the lock protects.
--
--
-- 4. AN ALLOWLIST, NOT A BLANKET
--
-- An UPDATE whose only changed columns are bookkeeping passes:
-- re_status, re_status_at, approval_status, approved_by, approved_at,
-- approval_reason (decideAmendment), updated_at. Compared as
-- `to_jsonb(NEW) - allow = to_jsonb(OLD) - allow`. Without it the status
-- trigger would be refused by the very lock it is setting.
--
--
-- 5. DELETING A LOCKED ORDER SAYS "LOCKED", NOT A FOREIGN-KEY ERROR
--
-- `delete_garment_order_document()` (0517) deletes the document and lets the
-- children cascade. The parent's BEFORE DELETE trigger fires BEFORE any cascade
-- (cascades are the RI's AFTER action), so a locked order is refused with the
-- lock sentence and nothing is removed. On an UNLOCKED order the cascade runs
-- and each child's lookup finds its parent already gone — which reads as "not
-- locked", correctly: a child can only be orphaned by a parent that passed.
--
--
-- 6. ONE APPROVED BUDGET PER RE — the uniqueness guard
--
-- 0428 put this in `decideBudget` because a partial unique index cannot see a
-- status on the parent. There are now TWO approval paths — the legacy action
-- and the engine's terminal trigger (0505) — so the rule moves to a BEFORE
-- UPDATE trigger on `order_budgets` that both pass through, and names the
-- other budget. And an approved budget is FROZEN in the database, not only in
-- `assertEditable`: its orders may not change (that would lock or unlock an
-- order behind the status), its lines may not change (they are the approved
-- figures), and it may not be deleted (that would strand its orders locked
-- with no budget to reopen). Nor may a budget that was EVER approved: once
-- reopened it is a draft again, but its revisions are the Amendment Protocol's
-- audit record, so a budget with revisions refuses DELETE and the revisions'
-- FK is ON DELETE RESTRICT behind it.
--
--
-- 7. THE AMENDMENT PROTOCOL — `order_budget_revisions` + `reopen_order_budget`
--
-- Reopening an approved budget records WHO, WHY (source 'customer' | 'internal'
-- — the order module's own "By Customer" / "By Us"; amendment_type from the
-- legacy order-amendment list + internal_error + other; a non-blank reason) and
-- the APPROVED baseline as it stood — then sends the budget back to draft,
-- which unlocks its orders. ONE RPC, ONE transaction: two PostgREST calls could
-- leave a revision with no reopen, or a reopen with no revision. Gated on
-- `orders:approve`: undoing an approval is the approver's act. Append-only —
-- no UPDATE or DELETE policy, and no INSERT policy either: the RPC is the only
-- door.
--
--
-- 8. `order_budgets.submitted_summary` — the KPIs the approver approved against
-- (`budgetKpis()`), stored at submit.
-- ============================================================================


-- ---------- 1. The RE status -------------------------------------------------

alter table public.garment_order_amendments
  add column if not exists re_status text not null default 'open',
  add column if not exists re_status_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_goa_re_status') then
    alter table public.garment_order_amendments
      add constraint chk_goa_re_status check (re_status in ('open', 'approved'));
  end if;
end
$$;

comment on column public.garment_order_amendments.re_status is
  'open | approved. APPROVED = an approved budget covers this document, and '
  '0576''s triggers refuse every write to it, its RE''s other documents, its '
  'Fabric BOM and its Material BOM. ONE writer: sync_re_status_from_budget() on '
  'order_budgets. Reopening the budget (Amendment Protocol) sets it open. 0576.';
comment on column public.garment_order_amendments.re_status_at is
  'When re_status last changed. 0576.';

-- BACKFILL from budgets approved today (0 live on 2026-09-18 — written anyway,
-- for any environment that has them). Before the lock triggers exist, so it
-- cannot be refused by them; on a re-run it changes only allowlisted columns.
update public.garment_order_amendments a
   set re_status = 'approved',
       re_status_at = b.decided_at
  from public.order_budget_orders o
  join public.order_budgets b on b.id = o.budget_id
 where o.garment_order_id = a.id
   and b.status = 'approved'
   and a.re_status <> 'approved';

create index if not exists idx_goa_re_status_approved
  on public.garment_order_amendments(sales_order_id) where re_status = 'approved';


-- ---------- 2. What "locked" means — ONE definition ---------------------------

create or replace function public.order_lock_of(p_order uuid, p_sales_order uuid default null)
returns table (
  locked_order_id uuid,
  re_no           text,
  budget_id       uuid,
  budget_code     text,
  approved_at     timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  -- This document, or any document of the same RE No, that is approved — see
  -- the header (2). SECURITY DEFINER so RLS cannot hide the approved sibling
  -- and make a locked order read as open.
  with me as (
    select coalesce(
      p_sales_order,
      (select a.sales_order_id from public.garment_order_amendments a where a.id = p_order)
    ) as so
  )
  select a.id,
         so.order_number,
         b.id,
         b.code,
         b.decided_at
    from public.garment_order_amendments a
    cross join me
    left join public.sales_orders so on so.id = a.sales_order_id
    left join lateral (
      select bb.id, bb.code, bb.decided_at
        from public.order_budget_orders o
        join public.order_budgets bb on bb.id = o.budget_id
       where o.garment_order_id = a.id
         and bb.status = 'approved'
       order by bb.decided_at desc nulls last
       limit 1
    ) b on true
   where a.re_status = 'approved'
     and (a.id = p_order or (me.so is not null and a.sales_order_id = me.so))
   order by (a.id = p_order) desc
   limit 1;
$$;

comment on function public.order_lock_of(uuid, uuid) is
  'The approved document locking this order''s RE No, with its budget — no row '
  'when unlocked. The ONE definition of "locked": the triggers and '
  'lib/orders/budget/lock.ts both read it. 0576.';

-- THE SENTENCE — one wording everywhere, and the SAME fallbacks as
-- `orderLockMessage()` (lib/orders/budget/amendment.ts), a blank counting as
-- missing:
--   no RE No         → "This order is locked — …"
--   no budget code   → "… its budget was approved on …"  (codes are not
--                      generated today, so this is the COMMON case)
--   no approval date → "… its budget <code> has been approved. …"
-- The date is the IST calendar day (`at time zone 'Asia/Kolkata'`), as the app
-- pins it, so the trigger and the toast name the same day.
create or replace function public.order_lock_message(p_order uuid, p_sales_order uuid default null)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when nullif(btrim(l.re_no), '') is not null
         then 'RE ' || btrim(l.re_no) || ' is locked'
         else 'This order is locked' end
    || ' — '
    || case when nullif(btrim(l.budget_code), '') is not null
            then 'its budget ' || btrim(l.budget_code)
            else 'its budget' end
    || ' '
    || case when l.approved_at is not null
            then 'was approved on ' || to_char(l.approved_at at time zone 'Asia/Kolkata', 'DD/MM/YYYY')
            else 'has been approved' end
    || '. Reopen the budget (Amendment Protocol) to change it.'
  from public.order_lock_of(p_order, p_sales_order) l;
$$;

-- The row → garment order walk. TG_ARGV's shape: the row's own column, then
-- (table, column) pairs. A step that finds nothing (its parent already deleted
-- by a cascade) ends the walk at NULL, which is "not locked" — see (5).
create or replace function public.order_lock_row_order(p_row jsonb, p_path text[])
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text := p_row ->> p_path[1];
  i int := 2;
begin
  while v is not null and i + 1 <= coalesce(array_length(p_path, 1), 0) loop
    execute format('select (%I)::text from public.%I where id = $1::uuid', p_path[i + 1], p_path[i])
      into v
      using v;
    i := i + 2;
  end loop;
  return v::uuid;
end;
$$;


-- ---------- 3. The lock trigger -----------------------------------------------

create or replace function public.refuse_when_order_locked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- (4) Bookkeeping that must pass the lock.
  v_allow constant text[] := array[
    're_status', 're_status_at', 'approval_status', 'approved_by',
    'approved_at', 'approval_reason', 'updated_at'
  ];
  v_rows jsonb[];
  v_row  jsonb;
  v_msg  text;
begin
  if TG_OP = 'UPDATE' then
    if (to_jsonb(NEW) - v_allow) = (to_jsonb(OLD) - v_allow) then
      return NEW;
    end if;
    -- BOTH sides: a row moved OFF a locked order is a change to it, and a row
    -- moved ONTO one is too.
    v_rows := array[to_jsonb(OLD), to_jsonb(NEW)];
  elsif TG_OP = 'INSERT' then
    v_rows := array[to_jsonb(NEW)];
  else
    v_rows := array[to_jsonb(OLD)];
  end if;

  foreach v_row in array v_rows loop
    if TG_TABLE_NAME = 'garment_order_amendments' then
      -- The document itself: its own id, and its RE — an INSERT has no row to
      -- look the RE up from yet, so it is read off the new row.
      v_msg := public.order_lock_message((v_row ->> 'id')::uuid, (v_row ->> 'sales_order_id')::uuid);
    else
      v_msg := public.order_lock_message(public.order_lock_row_order(v_row, TG_ARGV));
    end if;
    if v_msg is not null then
      raise exception using message = v_msg, errcode = 'P0001', hint = 'order_locked';
    end if;
  end loop;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

do $attach$
declare
  -- (table, path) — the path is TG_ARGV, see the header (3).
  t record;
begin
  for t in
    select * from (values
      -- the three parents
      ('garment_order_amendments',               array['id']),
      ('order_fabric_boms',                      array['garment_order_id']),
      ('material_bom_amendments',                array['garment_order_id']),
      -- Order Entry, direct
      ('garment_order_amendment_approval_qtys',   array['amendment_id']),
      ('garment_order_amendment_charges',         array['amendment_id']),
      ('garment_order_amendment_combos',          array['amendment_id']),
      ('garment_order_amendment_country_sizes',   array['amendment_id']),
      ('garment_order_amendment_dyeings',         array['amendment_id']),
      ('garment_order_amendment_files',           array['amendment_id']),
      ('garment_order_amendment_pack_components', array['amendment_id']),
      ('garment_order_amendment_pack_type_lines', array['amendment_id']),
      ('garment_order_amendment_pack_types',      array['amendment_id']),
      ('garment_order_amendment_price_details',   array['amendment_id']),
      ('garment_order_amendment_prints',          array['amendment_id']),
      ('garment_order_amendment_quantities',      array['amendment_id']),
      ('garment_order_amendment_structures',      array['amendment_id']),
      ('garment_order_amendment_style_components', array['amendment_id']),
      ('garment_order_amendment_style_coordinates', array['amendment_id']),
      ('garment_order_amendment_style_prices',    array['amendment_id']),
      ('garment_order_amendment_style_processes', array['amendment_id']),
      ('garment_order_amendment_style_sizes',     array['amendment_id']),
      ('garment_order_amendment_styles',          array['amendment_id']),
      -- Order Entry, deeper
      ('garment_order_amendment_combo_structures',
         array['combo_id', 'garment_order_amendment_combos', 'amendment_id']),
      ('garment_order_amendment_combo_components',
         array['structure_id', 'garment_order_amendment_combo_structures', 'combo_id',
               'garment_order_amendment_combos', 'amendment_id']),
      ('garment_order_amendment_assort_lines',
         array['quantity_id', 'garment_order_amendment_quantities', 'amendment_id']),
      ('garment_order_amendment_assort_line_sizes',
         array['line_id', 'garment_order_amendment_assort_lines', 'quantity_id',
               'garment_order_amendment_quantities', 'amendment_id']),
      -- Fabric BOM
      ('order_fabric_bom_dias',            array['bom_id', 'order_fabric_boms', 'garment_order_id']),
      ('order_fabric_bom_lines',           array['bom_id', 'order_fabric_boms', 'garment_order_id']),
      ('order_fabric_bom_manual_entries',  array['bom_id', 'order_fabric_boms', 'garment_order_id']),
      ('order_fabric_bom_process_scope',   array['bom_id', 'order_fabric_boms', 'garment_order_id']),
      ('order_fabric_bom_processes',       array['bom_id', 'order_fabric_boms', 'garment_order_id']),
      ('order_fabric_bom_requirements',    array['bom_id', 'order_fabric_boms', 'garment_order_id']),
      ('order_fabric_bom_yarns',           array['bom_id', 'order_fabric_boms', 'garment_order_id']),
      ('order_fabric_bom_yd_combinations', array['bom_id', 'order_fabric_boms', 'garment_order_id']),
      ('order_fabric_bom_yd_repeats',      array['bom_id', 'order_fabric_boms', 'garment_order_id']),
      ('order_fabric_bom_manual_combos',
         array['entry_id', 'order_fabric_bom_manual_entries', 'bom_id', 'order_fabric_boms', 'garment_order_id']),
      ('order_fabric_bom_manual_components',
         array['entry_id', 'order_fabric_bom_manual_entries', 'bom_id', 'order_fabric_boms', 'garment_order_id']),
      ('order_fabric_bom_manual_sizes',
         array['entry_id', 'order_fabric_bom_manual_entries', 'bom_id', 'order_fabric_boms', 'garment_order_id']),
      ('order_fabric_bom_yarn_stages',
         array['yarn_id', 'order_fabric_bom_yarns', 'bom_id', 'order_fabric_boms', 'garment_order_id']),
      ('order_fabric_bom_yd_combination_colors',
         array['combination_id', 'order_fabric_bom_yd_combinations', 'bom_id', 'order_fabric_boms', 'garment_order_id']),
      -- Material BOM
      ('material_bom_amendment_items',
         array['amendment_id', 'material_bom_amendments', 'garment_order_id']),
      ('material_bom_amendment_processes',
         array['amendment_id', 'material_bom_amendments', 'garment_order_id']),
      ('material_bom_amendment_requirements',
         array['amendment_id', 'material_bom_amendments', 'garment_order_id']),
      ('material_bom_amendment_item_components',
         array['item_line_id', 'material_bom_amendment_items', 'amendment_id',
               'material_bom_amendments', 'garment_order_id']),
      ('material_bom_amendment_item_slices',
         array['item_line_id', 'material_bom_amendment_items', 'amendment_id',
               'material_bom_amendments', 'garment_order_id'])
    ) as v(tbl, path)
  loop
    execute format('drop trigger if exists trg_order_lock on public.%I', t.tbl);
    execute format(
      'create trigger trg_order_lock before insert or update or delete on public.%I '
      'for each row execute function public.refuse_when_order_locked(%s)',
      t.tbl,
      (select string_agg(quote_literal(p), ', ') from unnest(t.path) p)
    );
  end loop;
end
$attach$;


-- ---------- 4. The status → re_status sync (the ONE writer) -----------------

create or replace function public.sync_re_status_from_budget()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.status = 'approved' and OLD.status is distinct from 'approved' then
    update public.garment_order_amendments a
       set re_status = 'approved', re_status_at = now()
     where a.id in (select o.garment_order_id from public.order_budget_orders o where o.budget_id = NEW.id)
       and a.re_status <> 'approved';
  elsif OLD.status = 'approved' and NEW.status is distinct from 'approved' then
    update public.garment_order_amendments a
       set re_status = 'open', re_status_at = now()
     where a.id in (select o.garment_order_id from public.order_budget_orders o where o.budget_id = NEW.id)
       and a.re_status = 'approved'
       -- Never unlock an order another approved budget still covers. The
       -- uniqueness guard makes that impossible today; this keeps it true if
       -- the guard is ever relaxed.
       and not exists (
         select 1 from public.order_budget_orders o2
           join public.order_budgets b2 on b2.id = o2.budget_id
          where o2.garment_order_id = a.id and b2.id <> NEW.id and b2.status = 'approved'
       );
  end if;
  return NULL;
end;
$$;

drop trigger if exists trg_ob_sync_re_status on public.order_budgets;
create trigger trg_ob_sync_re_status
  after update of status on public.order_budgets
  for each row
  when (OLD.status is distinct from NEW.status)
  execute function public.sync_re_status_from_budget();


-- ---------- 5. One approved budget per RE; an approved budget is frozen -----

create or replace function public.guard_order_budget_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_re   text;
  v_code text;
  v_revs int;
begin
  if TG_OP = 'DELETE' then
    if OLD.status = 'approved' then
      raise exception using
        message = 'An approved budget cannot be deleted — its orders are locked by it. Reopen it (Amendment Protocol) first.',
        errcode = 'P0001';
    end if;
    -- A ONCE-APPROVED BUDGET KEEPS ITS HISTORY. Reopened, it is a draft again,
    -- and drafts are deletable — but its revisions ARE the Amendment
    -- Protocol's audit record (doc §4.4): who reopened an approved budget, why,
    -- and the approved baseline. Deleting the budget would erase that record.
    -- The FK below is `on delete restrict` as the backstop; this is the
    -- sentence.
    select count(*) into v_revs from public.order_budget_revisions r where r.budget_id = OLD.id;
    if v_revs > 0 then
      raise exception using
        message = format(
          'This budget has an approved history (%s revision%s) and cannot be deleted — keep it, or reopen and revise it.',
          v_revs, case when v_revs = 1 then '' else 's' end
        ),
        errcode = 'P0001';
    end if;
    return OLD;
  end if;

  -- UPDATE into approved: no order of this budget — nor any document of the
  -- same RE No — may already sit in another approved budget. Named, because
  -- "already budgeted" without saying where is a dead end (0428).
  if NEW.status = 'approved' and OLD.status is distinct from 'approved' then
    select coalesce(so.order_number, a.code), coalesce(b2.code, left(b2.id::text, 8))
      into v_re, v_code
      from public.order_budget_orders o
      join public.garment_order_amendments a on a.id = o.garment_order_id
      left join public.sales_orders so on so.id = a.sales_order_id
      join public.garment_order_amendments a2
        on a2.id = a.id or (a.sales_order_id is not null and a2.sales_order_id = a.sales_order_id)
      join public.order_budget_orders o2 on o2.garment_order_id = a2.id
      join public.order_budgets b2 on b2.id = o2.budget_id
     where o.budget_id = NEW.id
       and b2.id <> NEW.id
       and b2.status = 'approved'
     limit 1;
    if v_re is not null then
      raise exception using
        message = format('%s is already in approved budget %s. Remove it, or revise that budget instead', v_re, v_code),
        errcode = 'P0001';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_ob_approval_guard on public.order_budgets;
create trigger trg_ob_approval_guard
  before update or delete on public.order_budgets
  for each row
  execute function public.guard_order_budget_approval();

-- The budget's own children, frozen while it is approved. A budget row already
-- gone (a cascade from a DRAFT budget's delete) reads as "not approved".
create or replace function public.refuse_when_budget_approved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if TG_OP = 'INSERT' then
    v_ids := array[NEW.budget_id];
  elsif TG_OP = 'DELETE' then
    v_ids := array[OLD.budget_id];
  else
    v_ids := array[OLD.budget_id, NEW.budget_id];
  end if;
  if exists (select 1 from public.order_budgets b where b.id = any (v_ids) and b.status = 'approved') then
    raise exception using
      message = 'An approved budget cannot be changed. Reopen it (Amendment Protocol) to revise it',
      errcode = 'P0001';
  end if;
  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_obo_frozen on public.order_budget_orders;
create trigger trg_obo_frozen
  before insert or update or delete on public.order_budget_orders
  for each row execute function public.refuse_when_budget_approved();

drop trigger if exists trg_obl_frozen on public.order_budget_lines;
create trigger trg_obl_frozen
  before insert or update or delete on public.order_budget_lines
  for each row execute function public.refuse_when_budget_approved();


-- ---------- 6. The Amendment Protocol ----------------------------------------

create table if not exists public.order_budget_revisions (
  id                   uuid primary key default gen_random_uuid(),
  -- RESTRICT, not cascade: a revision is the audit record of an approval being
  -- undone, and must outlive any attempt to delete its budget. The guard on
  -- order_budgets refuses first, with a sentence; this is the backstop.
  budget_id            uuid not null references public.order_budgets(id) on delete restrict,
  revision_no          int  not null,
  -- "By Customer" / "By Us" — the order module's own INITIATED_OPTIONS.
  source               text not null check (source in ('customer', 'internal')),
  -- The legacy order-amendment list + internal_error (doc §4.4) + other.
  amendment_type       text not null check (amendment_type in (
                         'quantity', 'colour', 'price', 'sizes', 'delivery_date',
                         'consignee', 'packing', 'style', 'internal_error', 'other'
                       )),
  reason               text not null check (btrim(reason) <> ''),
  -- The APPROVED figures and lines as they stood (`budgetBaseline()`), so
  -- "Approved baseline vs Current" has something to compare against.
  baseline             jsonb not null,
  baseline_approved_by uuid,
  baseline_approved_at timestamptz,
  reopened_by          uuid default auth.uid(),
  reopened_at          timestamptz not null default now(),
  constraint uq_obr_budget_revision unique (budget_id, revision_no)
);

comment on table public.order_budget_revisions is
  'The Amendment Protocol: one row per reopen of an APPROVED budget — who, why, '
  'and the approved baseline as it stood. Append-only; written only by '
  'reopen_order_budget(). 0576.';

alter table public.order_budget_revisions enable row level security;

do $rls$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'order_budget_revisions'
  ) then
    -- READ follows the budget: the subquery runs under the reader's own RLS on
    -- order_budgets, so the unit scoping 0484 gave budgets carries over.
    create policy order_budget_revisions_read on public.order_budget_revisions
      for select to authenticated
      using (
        public.has_permission('orders', 'view')
        and exists (select 1 from public.order_budgets b where b.id = order_budget_revisions.budget_id)
      );
    -- NO insert / update / delete policy. The RPC below is the only writer.
  end if;
end
$rls$;

alter table public.order_budgets
  add column if not exists submitted_summary jsonb;

comment on column public.order_budgets.submitted_summary is
  'The KPIs (budgetKpis()) as they stood at submit — what the approver approved '
  'against. Also the approval run''s context. 0576.';

create or replace function public.reopen_order_budget(
  p_budget_id uuid,
  p_source    text,
  p_type      text,
  p_reason    text,
  p_baseline  jsonb
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_by     uuid;
  v_at     timestamptz;
  v_no     int;
begin
  if not public.has_permission('orders', 'approve') then
    raise exception using message = 'You do not have permission to reopen an approved budget', errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception using message = 'Say why this budget is being reopened', errcode = '22023';
  end if;
  if p_baseline is null then
    raise exception using message = 'The approved baseline is missing — nothing was reopened', errcode = '22023';
  end if;

  -- FOR UPDATE: two approvers reopening at once get one revision, not two.
  select b.status, b.decided_by, b.decided_at
    into v_status, v_by, v_at
    from public.order_budgets b
   where b.id = p_budget_id
     for update;
  if not found then
    raise exception using message = 'That budget no longer exists', errcode = 'P0002';
  end if;
  -- IDEMPOTENT BY REFUSAL: a second click finds it already reopened.
  if v_status <> 'approved' then
    raise exception using
      message = format('Only an approved budget can be reopened — this one is %s', v_status),
      errcode = 'P0001';
  end if;

  select coalesce(max(r.revision_no), 0) + 1 into v_no
    from public.order_budget_revisions r
   where r.budget_id = p_budget_id;

  insert into public.order_budget_revisions (
    budget_id, revision_no, source, amendment_type, reason, baseline,
    baseline_approved_by, baseline_approved_at, reopened_by
  ) values (
    p_budget_id, v_no, p_source, p_type, btrim(p_reason), p_baseline,
    v_by, v_at, auth.uid()
  );

  -- approved → draft, the decision cleared: chk_ob_decision_matches_status
  -- (0428) refuses a decided timestamp on an undecided status. The status
  -- trigger unlocks the orders in this same transaction.
  update public.order_budgets
     set status = 'draft',
         decided_at = null,
         decided_by = null,
         decision_remark = null,
         updated_at = now()
   where id = p_budget_id;

  return v_no;
end;
$$;

comment on function public.reopen_order_budget(uuid, text, text, text, jsonb) is
  'The Amendment Protocol: record the revision and send an APPROVED budget back '
  'to draft, in one transaction. Gated on orders:approve. Returns revision_no. 0576.';


-- ---------- 7. Grants (AGENTS.md "Function grants") --------------------------
--
-- Both grants, in one statement, on EVERY new function. The two the app calls
-- are then granted to `authenticated` alone. The rest are internal and stay
-- closed to `authenticated` too — `order_lock_row_order` runs dynamic SQL over
-- a table named in its argument as the definer, which exposed would read any
-- row of any table past RLS.

revoke all on function public.order_lock_of(uuid, uuid)                             from public, anon;
revoke all on function public.order_lock_message(uuid, uuid)                        from public, anon, authenticated;
revoke all on function public.order_lock_row_order(jsonb, text[])                   from public, anon, authenticated;
revoke all on function public.refuse_when_order_locked()                            from public, anon, authenticated;
revoke all on function public.sync_re_status_from_budget()                          from public, anon, authenticated;
revoke all on function public.guard_order_budget_approval()                         from public, anon, authenticated;
revoke all on function public.refuse_when_budget_approved()                         from public, anon, authenticated;
revoke all on function public.reopen_order_budget(uuid, text, text, text, jsonb)    from public, anon;

grant execute on function public.order_lock_of(uuid, uuid)                          to authenticated;
grant execute on function public.reopen_order_budget(uuid, text, text, text, jsonb) to authenticated;


-- ----------------------------------------------------------------------------
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal. Every
-- attached table is asserted to carry the trigger (a table renamed since the
-- catalog was measured would otherwise be silently unguarded); every new
-- function is asserted SECURITY DEFINER with a pinned search_path and NOT
-- executable by PUBLIC or anon (the 0383/0386 lesson — checked on the ACL, not
-- on the revoke having run).
-- ----------------------------------------------------------------------------

do $verify$
declare
  t    text;
  f    text;
  def  text;
  n    int;
begin
  -- the column and its vocabulary
  perform 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'garment_order_amendments'
     and column_name = 're_status' and is_nullable = 'NO' and column_default like '''open''%';
  if not found then
    raise exception '0576: garment_order_amendments.re_status is missing, nullable, or not defaulted to open';
  end if;
  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'chk_goa_re_status';
  if def is null or def not like '%''open''%' or def not like '%''approved''%' then
    raise exception '0576: chk_goa_re_status is missing or wrong (%)', def;
  end if;

  -- the backfill, by its own question
  if exists (
    select 1 from public.order_budget_orders o
      join public.order_budgets b on b.id = o.budget_id
      join public.garment_order_amendments a on a.id = o.garment_order_id
     where b.status = 'approved' and a.re_status <> 'approved'
  ) then
    raise exception '0576: an order in an approved budget is not re_status approved';
  end if;

  -- every attached table carries the lock trigger
  foreach t in array array[
    'garment_order_amendments', 'order_fabric_boms', 'material_bom_amendments',
    'garment_order_amendment_approval_qtys', 'garment_order_amendment_charges',
    'garment_order_amendment_combos', 'garment_order_amendment_country_sizes',
    'garment_order_amendment_dyeings', 'garment_order_amendment_files',
    'garment_order_amendment_pack_components', 'garment_order_amendment_pack_type_lines',
    'garment_order_amendment_pack_types', 'garment_order_amendment_price_details',
    'garment_order_amendment_prints', 'garment_order_amendment_quantities',
    'garment_order_amendment_structures', 'garment_order_amendment_style_components',
    'garment_order_amendment_style_coordinates', 'garment_order_amendment_style_prices',
    'garment_order_amendment_style_processes', 'garment_order_amendment_style_sizes',
    'garment_order_amendment_styles', 'garment_order_amendment_combo_structures',
    'garment_order_amendment_combo_components', 'garment_order_amendment_assort_lines',
    'garment_order_amendment_assort_line_sizes',
    'order_fabric_bom_dias', 'order_fabric_bom_lines', 'order_fabric_bom_manual_entries',
    'order_fabric_bom_process_scope', 'order_fabric_bom_processes',
    'order_fabric_bom_requirements', 'order_fabric_bom_yarns',
    'order_fabric_bom_yd_combinations', 'order_fabric_bom_yd_repeats',
    'order_fabric_bom_manual_combos', 'order_fabric_bom_manual_components',
    'order_fabric_bom_manual_sizes', 'order_fabric_bom_yarn_stages',
    'order_fabric_bom_yd_combination_colors',
    'material_bom_amendment_items', 'material_bom_amendment_processes',
    'material_bom_amendment_requirements', 'material_bom_amendment_item_components',
    'material_bom_amendment_item_slices'
  ] loop
    select count(*) into n
      from pg_trigger tg
      join pg_proc p on p.oid = tg.tgfoid
     where tg.tgrelid = ('public.' || t)::regclass
       and tg.tgname = 'trg_order_lock'
       and p.proname = 'refuse_when_order_locked'
       and not tg.tgisinternal;
    if n <> 1 then
      raise exception '0576: % does not carry trg_order_lock', t;
    end if;
  end loop;

  -- T&A stays unlocked, deliberately (header 3)
  if exists (
    select 1 from pg_trigger tg
     where tg.tgname = 'trg_order_lock'
       and tg.tgrelid::regclass::text like 'garment_order_amendment_ta_%'
  ) then
    raise exception '0576: a T&A table carries the order lock — T&A is execution, not plan';
  end if;

  -- the budget-side triggers
  foreach t in array array['trg_ob_sync_re_status', 'trg_ob_approval_guard'] loop
    if not exists (select 1 from pg_trigger where tgname = t and tgrelid = 'public.order_budgets'::regclass) then
      raise exception '0576: % is missing on order_budgets', t;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgname = 'trg_obo_frozen' and tgrelid = 'public.order_budget_orders'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'trg_obl_frozen' and tgrelid = 'public.order_budget_lines'::regclass) then
    raise exception '0576: the approved-budget freeze is missing on order_budget_orders or order_budget_lines';
  end if;

  -- the revisions table: shape, vocabularies, RLS, append-only
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'order_budget_revisions') then
    raise exception '0576: order_budget_revisions was not created';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.order_budget_revisions'::regclass) then
    raise exception '0576: RLS is off on order_budget_revisions';
  end if;
  if exists (select 1 from pg_policies where tablename = 'order_budget_revisions' and cmd <> 'SELECT') then
    raise exception '0576: order_budget_revisions has a write policy — it is append-only through the RPC';
  end if;
  select string_agg(pg_get_constraintdef(oid), ' ') into def
    from pg_constraint where conrelid = 'public.order_budget_revisions'::regclass and contype = 'c';
  foreach t in array array[
    'customer', 'internal', 'quantity', 'colour', 'price', 'sizes', 'delivery_date',
    'consignee', 'packing', 'style', 'internal_error', 'other'
  ] loop
    if def not like '%''' || t || '''%' then
      raise exception '0576: order_budget_revisions does not admit % (%)', t, def;
    end if;
  end loop;

  -- the history outlives its budget: RESTRICT, and the guard's sentence
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.order_budget_revisions'::regclass
       and confrelid = 'public.order_budgets'::regclass
       and contype = 'f'
       and confdeltype = 'r'
  ) then
    raise exception '0576: order_budget_revisions.budget_id is not ON DELETE RESTRICT — deleting a budget would erase its Amendment history';
  end if;
  if pg_get_functiondef('public.guard_order_budget_approval()'::regprocedure) not like '%order_budget_revisions%' then
    raise exception '0576: guard_order_budget_approval does not refuse deleting a budget that has revisions';
  end if;

  perform 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'order_budgets'
     and column_name = 'submitted_summary' and data_type = 'jsonb';
  if not found then
    raise exception '0576: order_budgets.submitted_summary is missing or not jsonb';
  end if;

  -- every new function: SECURITY DEFINER, search_path pinned, closed to PUBLIC and anon
  foreach f in array array[
    'order_lock_of', 'order_lock_message', 'order_lock_row_order', 'refuse_when_order_locked',
    'sync_re_status_from_budget', 'guard_order_budget_approval', 'refuse_when_budget_approved',
    'reopen_order_budget'
  ] loop
    select count(*) into n
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = f
       and p.prosecdef
       and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
       -- A NULL acl is the DEFAULT one, which grants PUBLIC — so it must not
       -- pass as "no PUBLIC entry found".
       and p.proacl is not null
       and not exists (select 1 from unnest(p.proacl) a where a::text like '=%')        -- PUBLIC
       and not exists (select 1 from unnest(p.proacl) a where a::text like 'anon=%');   -- anon
    if n <> 1 then
      raise exception '0576: % is not SECURITY DEFINER with a pinned search_path, or PUBLIC / anon can execute it', f;
    end if;
  end loop;

  -- and the one that runs dynamic SQL is closed to authenticated as well
  if has_function_privilege('authenticated', 'public.order_lock_row_order(jsonb, text[])', 'execute') then
    raise exception '0576: authenticated can execute order_lock_row_order — it reads any table past RLS';
  end if;
  if not has_function_privilege('authenticated', 'public.reopen_order_budget(uuid, text, text, text, jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.order_lock_of(uuid, uuid)', 'execute') then
    raise exception '0576: authenticated cannot execute reopen_order_budget / order_lock_of — the app calls both';
  end if;
end $verify$;
