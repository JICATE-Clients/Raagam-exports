-- ============================================================================
-- Raagam ERP — 0619 Order Amendment: MODULE categories, derived-only BOM
-- recalculation, REVERT on reject, frozen V_final reports
--
-- `doc/order/amenment update.md` (2026-09-23) on top of 0604 · 0616–0618.
-- Plan and the spec-line map: `doc/order/amenment-update-plan.md`.
--
--   1. MODULE CATEGORIES (spec §2). The merchandiser picks WHICH MODULES the
--      amendment opens — Order Entry · Material BOM · Fabric BOM · Order
--      Budget — and "selecting Order Entry and Fabric BOM keeps Material BOM
--      read-only". Until now a quantity or combo change opened BOTH BOMs whole
--      (0604 · 0618) and the budget was never scoped at all.
--
--      THE MODULE IS DERIVED FROM THE KIND, never a second column: the five
--      order kinds are Order Entry's detail ("PO Qty, Delivery Date, FOB
--      Price, Color Combos"), and three new kinds name the other modules —
--      `fabric_bom_revision`, `material_bom_revision`, `budget_revision`. One
--      array, so "which modules" and "which kinds" cannot disagree.
--      `bom_revision` stays readable (both BOMs) and is no longer offered.
--
--   2. A BOM THAT IS NOT PICKED STILL RECALCULATES (spec §3.1 "automatic
--      recalculation … across all locations"). Its AUTHORED rows stay locked;
--      its DERIVED rows — requirements, the yarn purchase / process weights,
--      the header's basis stamp — are opened by the order kinds that move
--      quantities or colourways, and ONLY those rows. The recalculation writes
--      exactly them (lib/orders/*/recalc), so this is still a static allowlist
--      the trigger enforces, not a lock lifted for the occasion.
--
--      The budget is not trigger-locked, so `budget_revision` opens a MARKER
--      table (`order_budget_lines`) in the frozen scope. The trigger never
--      reads it (no trg_order_lock there); the budget action and screen do, so
--      the frozen scope stays the one description of what an entry opens.
--
--   3. REJECT REVERTS (spec §4A: "REJECTED: denied by MD; order reverts to
--      previous approved baseline (V_previous)"). 0616 declined a generic
--      restore for fear of cascading through T&A; the FK map says otherwise —
--      every T&A / production table hangs off the order HEADER, which a
--      restore never deletes, and the BOM children that reference BOM rows are
--      themselves snapshotted. So `order_amendment_revert` puts the order,
--      both BOMs and the budget back exactly as V0 in one transaction:
--        - rows added since V0 are deleted, children first;
--        - V0 rows are upserted by id, parents first (a delete-and-reinsert
--          grid comes back with its ORIGINAL ids);
--        - the header keeps its live bookkeeping (re_status …);
--        - the budget's lines, orders and header come back from a NEW budget
--          snapshot frozen at open (`budget_snapshot`), status approved with
--          V0's decision — which re-locks the RE through the budget's own
--          trigger.
--      It runs INSIDE approval_apply_terminal, so a reject by push, by the
--      inbox or by the sweeper all revert. A revert that cannot complete
--      NEVER loses the reject: the sub-block rolls back to its savepoint, the
--      entry stays open on a rejected budget (the 0616 behaviour) and
--      `revert_error` says why.
--
--      Abandon uses the same revert. "Abandon with changes leaves the RE
--      open" (0616) was a workaround for the restore not existing.
--
--      THE LOCK DURING A REVERT: the trigger stands down for an order whose
--      open entry carries `reverting_txid = txid_current()`. Only this
--      SECURITY DEFINER function writes that column (the table has no UPDATE
--      policy), and it is cleared before the function returns — so no client
--      can reach the bypass, and it cannot outlive the transaction.
--
--   4. V_FINAL REPORTS (spec §4B). `order_amendment_report_snapshots` holds
--      each per-order report as its own loader rendered it at raise — the one
--      moment the live rows ARE the approved version. Written by the raise
--      action, copied on supersede, read by every report route while the
--      order is amending.
--
--   5. `amended_kpis` / `submitted_at`: the revised budget's figures at submit,
--      kept ON THE ENTRY — after a reject the budget is V0 again, and the
--      register must still say what was refused.
--
-- Status vocabulary (spec §4A): DRAFT · PENDING_MD_APPROVAL · APPROVED ·
-- REJECTED are DERIVED in TypeScript (`entryStatusOf`) from `outcome` + the
-- budget's status; `outcome` gains 'rejected'.
-- ============================================================================


-- ---------- 1. The kinds ------------------------------------------------------

alter table public.order_budget_revisions drop constraint if exists chk_obr_types_known;
alter table public.order_budget_revisions drop constraint if exists order_budget_revisions_amendment_type_check;
alter table public.order_budget_revisions
  add constraint chk_obr_types_known check (
    array_length(amendment_types, 1) >= 1
    and amendment_types <@ array[
      'qty_addition', 'qty_cancellation', 'price_change', 'delivery_date_ext',
      'combo_colour_change', 'fabric_bom_revision', 'material_bom_revision', 'budget_revision',
      'bom_revision',
      'quantity', 'colour', 'price', 'sizes', 'delivery_date',
      'consignee', 'packing', 'style', 'internal_error', 'other'
    ]
    and amendment_type = amendment_types[1]
  );

alter table public.order_amendment_scopes drop constraint if exists chk_oas_type;
alter table public.order_amendment_scopes
  add constraint chk_oas_type check (amendment_type in (
    'qty_addition', 'qty_cancellation', 'price_change', 'delivery_date_ext',
    'combo_colour_change', 'fabric_bom_revision', 'material_bom_revision', 'budget_revision',
    'bom_revision'
  ));

create or replace function public.order_amendment_type_label(p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'qty_addition'          then 'Quantity Addition'
    when 'qty_cancellation'      then 'Quantity Cancellation'
    when 'price_change'          then 'Price Change'
    when 'delivery_date_ext'     then 'Delivery Date Extension'
    when 'combo_colour_change'   then 'Combo / Color Change'
    when 'fabric_bom_revision'   then 'Fabric BOM'
    when 'material_bom_revision' then 'Material BOM'
    when 'budget_revision'       then 'Order Budget'
    when 'bom_revision'          then 'BOM Revision'
    else coalesce(nullif(btrim(p_type), ''), 'an amendment')
  end;
$$;

create or replace function public.order_amendment_area_label(p_table name)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_table = 'garment_order_amendments'                     then 'the order header'
    when p_table = 'garment_order_amendment_styles'                then 'Style(s)'
    when p_table like 'garment_order_amendment_style_price%'       then 'Prices'
    when p_table like 'garment_order_amendment_style_component%'   then 'Style Components'
    when p_table like 'garment_order_amendment_style_coordinate%'  then 'Style Components'
    when p_table like 'garment_order_amendment_style_process%'     then 'Style Processes'
    when p_table like 'garment_order_amendment_style_size%'        then 'Sizes'
    when p_table like 'garment_order_amendment_price_detail%'      then 'Price Details'
    when p_table like 'garment_order_amendment_charge%'            then 'Logistic charges'
    when p_table like 'garment_order_amendment_quantit%'           then 'Quantities'
    when p_table like 'garment_order_amendment_assort%'            then 'Assortment'
    when p_table like 'garment_order_amendment_approval_qty%'      then 'Approval Qty'
    when p_table like 'garment_order_amendment_combo%'             then 'Combos'
    when p_table like 'garment_order_amendment_dyeing%'            then 'Colour / Print Details'
    when p_table like 'garment_order_amendment_print%'             then 'Colour / Print Details'
    when p_table like 'garment_order_amendment_structure%'         then 'Structures'
    when p_table like 'garment_order_amendment_country_size%'      then 'Country / Sizewise'
    when p_table like 'garment_order_amendment_pack%'              then 'Pack type(s)'
    when p_table like 'garment_order_amendment_file%'              then 'Attachments'
    when p_table like 'order_fabric_bom%'                          then 'the Fabric BOM'
    when p_table like 'material_bom_amendment%'                    then 'the Material BOM'
    when p_table like 'order_budget%'                              then 'the Order Budget'
    else 'that section'
  end;
$$;


-- ---------- 2. The scope seed, re-cut by module --------------------------------

-- The three module kinds. Fabric / Material: every table of that BOM, as
-- `bom_revision` opens it (the parent may be inserted, never deleted).
insert into public.order_amendment_scopes (amendment_type, table_name, columns, allows_insert, allows_delete)
select 'fabric_bom_revision', s.table_name, s.columns, s.allows_insert, s.allows_delete
  from public.order_amendment_scopes s
 where s.amendment_type = 'bom_revision' and s.table_name::text like 'order_fabric_bom%'
on conflict (amendment_type, table_name) do update
  set columns = excluded.columns, allows_insert = excluded.allows_insert, allows_delete = excluded.allows_delete;

insert into public.order_amendment_scopes (amendment_type, table_name, columns, allows_insert, allows_delete)
select 'material_bom_revision', s.table_name, s.columns, s.allows_insert, s.allows_delete
  from public.order_amendment_scopes s
 where s.amendment_type = 'bom_revision' and s.table_name::text like 'material_bom_amendment%'
on conflict (amendment_type, table_name) do update
  set columns = excluded.columns, allows_insert = excluded.allows_insert, allows_delete = excluded.allows_delete;

-- The budget's marker: read by the budget action and screen, never by the
-- trigger (order_budget_lines carries no trg_order_lock).
insert into public.order_amendment_scopes (amendment_type, table_name, columns, allows_insert, allows_delete)
values ('budget_revision', 'order_budget_lines', null, true, true)
on conflict (amendment_type, table_name) do update
  set columns = excluded.columns, allows_insert = excluded.allows_insert, allows_delete = excluded.allows_delete;

-- The order kinds that move quantities or colourways no longer open the BOMs
-- WHOLE — only the rows a recalculation writes.
delete from public.order_amendment_scopes
 where amendment_type in ('qty_addition', 'qty_cancellation', 'combo_colour_change')
   and (table_name::text like 'order_fabric_bom%' or table_name::text like 'material_bom_amendment%');

insert into public.order_amendment_scopes (amendment_type, table_name, columns, allows_insert, allows_delete)
select k.t, d.tbl::name, d.cols, d.ins, d.del
  from (values ('qty_addition'), ('qty_cancellation'), ('combo_colour_change')) k(t)
 cross join (values
   ('order_fabric_boms',                   array['computed_at', 'computed_for_qty', 'computed_basis_hash'], false, false),
   ('order_fabric_bom_requirements',       null::text[],                                                     true,  true),
   ('order_fabric_bom_yarns',              array['purchase_qty', 'uom_id', 'refusal_reason'],                false, false),
   ('order_fabric_bom_yarn_stages',        array['process_qty', 'uom_id', 'refusal_reason'],                 false, false),
   ('material_bom_amendments',             array['computed_at', 'computed_for_qty', 'computed_basis_hash'], false, false),
   ('material_bom_amendment_requirements', null::text[],                                                     true,  true)
 ) d(tbl, cols, ins, del)
on conflict (amendment_type, table_name) do update
  set columns = excluded.columns, allows_insert = excluded.allows_insert, allows_delete = excluded.allows_delete;


-- ---------- 3. The entry's new columns ----------------------------------------

alter table public.order_budget_revisions
  add column if not exists budget_snapshot  jsonb,
  add column if not exists rejection_reason text,
  add column if not exists revert_error     text,
  add column if not exists reverting_txid   bigint,
  add column if not exists amended_kpis     jsonb,
  add column if not exists submitted_at     timestamptz;

comment on column public.order_budget_revisions.budget_snapshot is
  'V0 of the BUDGET: { budget: row, lines: [rows], orders: [rows] } as it stood '
  'approved when the entry opened. What a reject / abandon restores. 0619.';
comment on column public.order_budget_revisions.reverting_txid is
  'Set by order_amendment_revert for the length of its own transaction only; '
  'refuse_when_order_locked stands down for the order while it equals '
  'txid_current(). Never written by a client (no UPDATE policy). 0619.';
comment on column public.order_budget_revisions.amended_kpis is
  'The revised budget''s budgetKpis as SUBMITTED — kept on the entry because a '
  'reject restores the budget to V0 and the register must still show what was '
  'refused. 0619.';

create index if not exists ix_obr_reverting on public.order_budget_revisions (reverting_txid)
  where reverting_txid is not null;

alter table public.order_budget_revisions drop constraint if exists chk_obr_outcome;
alter table public.order_budget_revisions
  add constraint chk_obr_outcome check (outcome in ('open', 'reapproved', 'abandoned', 'superseded', 'rejected'));

comment on column public.order_budget_revisions.outcome is
  'open | reapproved | abandoned | superseded | rejected. REJECTED = the MD '
  'refused the revised budget and the order, both BOMs and the budget were '
  'reverted to V0 (0619).';

-- The open entries raised before this migration opened the budget whole (it
-- was never scoped): record that in their frozen scope, so the budget does not
-- lock under an operator mid-amendment.
update public.order_budget_revisions r
   set scope = r.scope || jsonb_build_object('order_budget_lines',
                 jsonb_build_object('columns', null, 'insert', true, 'delete', true))
 where r.outcome = 'open' and r.scope is not null and not (r.scope ? 'order_budget_lines');


-- ---------- 4. Scope helpers ----------------------------------------------------

/** The union of kinds' seed scopes — the one rule every door freezes by. */
create or replace function public.order_amendment_scope_union(p_types text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(t.tbl, jsonb_build_object(
           'columns', case when t.whole then null else to_jsonb(t.cols) end,
           'insert', t.ins, 'delete', t.del)), '{}'::jsonb)
    from (
      select s.table_name::text as tbl,
             bool_or(s.columns is null) as whole,
             array_remove(array_agg(distinct c order by c), null) as cols,
             bool_or(s.allows_insert) as ins,
             bool_or(s.allows_delete) as del
        from public.order_amendment_scopes s
        left join lateral unnest(coalesce(s.columns, array[]::text[])) c on true
       where s.amendment_type = any(p_types)
       group by s.table_name
    ) t;
$$;

/** Two frozen scopes merged by the same rule — a superseding entry keeps
 *  everything its predecessor had open (0618) even where the seed has since
 *  narrowed (0619 took the BOMs off the quantity kinds). */
create or replace function public.order_amendment_scope_merge(a jsonb, b jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object(
           'columns',
             case when (a -> k) is not null and jsonb_typeof(a -> k -> 'columns') is distinct from 'array' then null
                  when (b -> k) is not null and jsonb_typeof(b -> k -> 'columns') is distinct from 'array' then null
                  else (select coalesce(jsonb_agg(distinct x order by x), '[]'::jsonb)
                          from (select jsonb_array_elements_text(coalesce(a -> k -> 'columns', '[]'::jsonb)) as x
                                union
                                select jsonb_array_elements_text(coalesce(b -> k -> 'columns', '[]'::jsonb))) u)
             end,
           'insert', coalesce((a -> k ->> 'insert')::boolean, false) or coalesce((b -> k ->> 'insert')::boolean, false),
           'delete', coalesce((a -> k ->> 'delete')::boolean, false) or coalesce((b -> k ->> 'delete')::boolean, false))),
         '{}'::jsonb)
    from (select jsonb_object_keys(coalesce(a, '{}'::jsonb)) as k
          union
          select jsonb_object_keys(coalesce(b, '{}'::jsonb))) keys;
$$;

/** Every offered kind must carry a scope — named when one does not. */
create or replace function public.order_amendment_check_kinds(p_types text[])
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_types text[];
  v_t     text;
begin
  select array_agg(t order by ord) into v_types
    from (select t, min(ord) as ord from unnest(p_types) with ordinality as u(t, ord)
           where nullif(btrim(t), '') is not null group by t) d;
  if v_types is null then
    raise exception using message = 'Pick at least one module to amend', errcode = '22023';
  end if;
  foreach v_t in array v_types loop
    if not exists (select 1 from public.order_amendment_scopes s where s.amendment_type = v_t) then
      raise exception using
        message = format('%s has no field scope declared — it cannot be raised', public.order_amendment_type_label(v_t)),
        errcode = '22023';
    end if;
  end loop;
  return v_types;
end;
$$;

/** V0 of the budget — the rows a revert puts back. Internal. */
create or replace function public.order_amendment_budget_snapshot(p_budget uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'budget', (select to_jsonb(b) from public.order_budgets b where b.id = p_budget),
    'lines',  (select coalesce(jsonb_agg(to_jsonb(l) order by l.id), '[]'::jsonb)
                 from public.order_budget_lines l where l.budget_id = p_budget),
    'orders', (select coalesce(jsonb_agg(to_jsonb(o) order by o.id), '[]'::jsonb)
                 from public.order_budget_orders o where o.budget_id = p_budget)
  );
$$;


-- ---------- 5. The doors, re-cut --------------------------------------------

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
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception using message = 'Say why this order is being amended', errcode = '22023';
  end if;
  if p_baseline is null then
    raise exception using message = 'The approved baseline is missing — nothing was amended', errcode = '22023';
  end if;

  if p_scoped then
    v_types := public.order_amendment_check_kinds(p_types);
    v_scope := public.order_amendment_scope_union(v_types);
  else
    select array_agg(t order by ord) into v_types
      from (select t, min(ord) as ord from unnest(p_types) with ordinality as u(t, ord)
             where nullif(btrim(t), '') is not null group by t) d;
    if v_types is null then
      raise exception using message = 'Pick at least one Change Category', errcode = '22023';
    end if;
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

  select coalesce(max(rv.revision_no), 0) + 1 into v_no
    from public.order_budget_revisions rv
   where rv.budget_id = p_budget_id;

  insert into public.order_budget_revisions (
    budget_id, garment_order_id, revision_no, entry_no, source, amendment_type, amendment_types,
    reason, baseline, scope, order_snapshot, budget_snapshot,
    baseline_approved_by, baseline_approved_at, reopened_by
  ) values (
    p_budget_id, p_order_id, v_no, public.next_order_amendment_no(),
    p_source, v_types[1], v_types, btrim(p_reason), p_baseline, v_scope,
    case when p_order_id is not null then public.order_amendment_snapshot(p_order_id) end,
    public.order_amendment_budget_snapshot(p_budget_id),
    v_by, v_at, auth.uid()
  ) returning id into v_entry;

  return v_entry;
end;
$$;

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
  v_so      uuid;
  v_budget  uuid;
  v_status  text;
  v_entry   uuid;
  v_old     record;
  v_bstatus text;
  v_types   text[];
  v_scope   jsonb;
  v_no      int;
begin
  if not public.has_permission('orders', 'edit') then
    raise exception using message = 'You do not have permission to amend an order', errcode = '42501';
  end if;

  select a.sales_order_id, a.re_status into v_so, v_status
    from public.garment_order_amendments a where a.id = p_order;
  if not found then
    raise exception using message = 'That order no longer exists', errcode = 'P0002';
  end if;

  -- ---- AMENDING: supersede the open entry (0618) --------------------------
  if v_status = 'amending' then
    select r2.* into v_old
      from public.order_budget_revisions r2
      join public.garment_order_amendments a on a.re_amendment_id = r2.id
     where a.id = p_order and r2.outcome = 'open';
    if not found then
      raise exception using
        message = 'This order reads amending but its open entry cannot be read — nothing was amended',
        errcode = 'P0001';
    end if;
    if p_reason is null or btrim(p_reason) = '' then
      raise exception using message = 'Say why this order is being amended', errcode = '22023';
    end if;
    select b.status into v_bstatus from public.order_budgets b where b.id = v_old.budget_id for update;
    if v_bstatus = 'submitted' then
      raise exception using
        message = format('Amendment %s is with the MD — wait for the decision before amending again', coalesce(v_old.entry_no, '')),
        errcode = 'P0001';
    end if;

    v_types := public.order_amendment_check_kinds(v_old.amendment_types || coalesce(p_types, array[]::text[]));
    -- What was open stays open: the old FROZEN scope merged with the seed's
    -- union for the new kinds.
    v_scope := public.order_amendment_scope_merge(
      coalesce(v_old.scope, '{}'::jsonb),
      public.order_amendment_scope_union(v_types)
    );

    update public.order_budget_revisions
       set outcome = 'superseded', closed_at = now(), closed_by = auth.uid()
     where id = v_old.id;

    select coalesce(max(rv.revision_no), 0) + 1 into v_no
      from public.order_budget_revisions rv where rv.budget_id = v_old.budget_id;

    insert into public.order_budget_revisions (
      budget_id, garment_order_id, revision_no, entry_no, source, amendment_type, amendment_types,
      reason, baseline, scope, order_snapshot, budget_snapshot,
      baseline_approved_by, baseline_approved_at, reopened_by
    ) values (
      v_old.budget_id, p_order, v_no, public.next_order_amendment_no(),
      p_source, v_types[1], v_types, btrim(p_reason),
      v_old.baseline, v_scope, v_old.order_snapshot, v_old.budget_snapshot,
      v_old.baseline_approved_by, v_old.baseline_approved_at, auth.uid()
    ) returning id into v_entry;

    -- V_final is still V0: the frozen reports travel with the snapshot.
    insert into public.order_amendment_report_snapshots (entry_id, report_key, payload, captured_at, captured_by)
    select v_entry, s.report_key, s.payload, s.captured_at, s.captured_by
      from public.order_amendment_report_snapshots s where s.entry_id = v_old.id;

    update public.garment_order_amendments a
       set re_amendment_id = v_entry, re_status_at = now()
     where a.re_amendment_id = v_old.id;

    return query
      select r3.id, r3.entry_no from public.order_budget_revisions r3 where r3.id = v_entry;
    return;
  end if;

  -- ---- APPROVED: the first entry --------------------------------------------
  if v_status <> 'approved' then
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

  update public.garment_order_amendments a
     set re_status = 'amending', re_status_at = now(), re_amendment_id = v_entry
   where (a.id = p_order or (v_so is not null and a.sales_order_id = v_so))
     and a.re_status = 'approved';

  update public.order_budgets
     set status = 'draft', decided_at = null, decided_by = null, decision_remark = null, updated_at = now()
   where id = v_budget;

  return query
    select r3.id, r3.entry_no from public.order_budget_revisions r3 where r3.id = v_entry;
end;
$$;


-- ---------- 6. V_final report snapshots ---------------------------------------

create table if not exists public.order_amendment_report_snapshots (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references public.order_budget_revisions(id) on delete cascade,
  report_key  text not null check (btrim(report_key) <> ''),
  payload     jsonb not null,
  captured_at timestamptz not null default now(),
  captured_by uuid default auth.uid(),
  constraint uq_oars_entry_report unique (entry_id, report_key)
);

comment on table public.order_amendment_report_snapshots is
  'V_final (spec §4B): each per-order report (ORDER_REPORTS) as its own loader '
  'rendered it when the entry was raised — the approved version. Served by the '
  'report routes while the order is amending. Append-only. 0619.';

alter table public.order_amendment_report_snapshots enable row level security;

drop policy if exists oars_read on public.order_amendment_report_snapshots;
create policy oars_read on public.order_amendment_report_snapshots
  for select to authenticated
  using (public.has_permission('orders', 'view'));

-- Captured once, while the entry is open; never updated, never deleted by a
-- client (the cascade from the entry is the only delete).
drop policy if exists oars_capture on public.order_amendment_report_snapshots;
create policy oars_capture on public.order_amendment_report_snapshots
  for insert to authenticated
  with check (
    public.has_permission('orders', 'edit')
    and exists (select 1 from public.order_budget_revisions r
                 where r.id = entry_id and r.outcome = 'open')
  );

grant select, insert on public.order_amendment_report_snapshots to authenticated;


-- ---------- 7. The revert -------------------------------------------------------

/**
 * Put the order document (every trg_order_lock table in the V0 snapshot) and
 * the budget back exactly as they stood when the entry opened, then close the
 * entry with p_outcome ('rejected' | 'abandoned'). Raises on anything it
 * cannot do — the caller decides whether that is fatal.
 *
 * INTERNAL: not granted. Reached through approval_apply_terminal (reject) and
 * abandon_order_amendment.
 */
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
        select k.conrelid::regclass::text as child, max(p.depth) + 1 as d
          from pg_catalog.pg_constraint k
          join pg_temp.oar_tables p on p.tbl = k.confrelid::regclass::text
         where k.contype = 'f' and k.conrelid <> k.confrelid
           and k.conrelid::regclass::text in (select tbl from pg_temp.oar_tables)
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
  'close it (rejected | abandoned). Internal. 0619.';

create or replace function public.close_order_amendment(p_entry uuid, p_outcome text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  v_n     int;
begin
  if p_outcome not in ('reapproved', 'abandoned', 'rejected') then
    raise exception using message = format('Unknown amendment outcome %s', p_outcome), errcode = '22023';
  end if;

  select r.garment_order_id into v_order
    from public.order_budget_revisions r
   where r.id = p_entry and r.outcome = 'open';
  if not found then
    return 0;
  end if;
  update public.order_budget_revisions
     set outcome = p_outcome, closed_at = now(), closed_by = auth.uid()
   where id = p_entry;

  with covered as (
    select a.id,
           exists (
             select 1 from public.order_budget_orders o
               join public.order_budgets b on b.id = o.budget_id
              where o.garment_order_id = a.id and b.status = 'approved'
           ) as has_approved
      from public.garment_order_amendments a
     where a.re_amendment_id = p_entry
  )
  update public.garment_order_amendments a
     set re_status = case when c.has_approved then 'approved' else 'open' end,
         re_status_at = now(),
         re_amendment_id = null
    from covered c
   where a.id = c.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;


-- ---------- 8. The lock stands down during a revert -----------------------------

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

    -- 0. A REVERT IN PROGRESS (0619): this transaction is putting V0 back.
    if v_order is not null and exists (
         select 1 from public.order_budget_revisions r
           join public.garment_order_amendments a on a.re_amendment_id = r.id
          where r.reverting_txid = txid_current() and a.id = v_order) then
      continue;
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


-- ---------- 9. Abandon reverts ----------------------------------------------------

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
  v_snap    boolean;
begin
  if not public.has_permission('orders', 'edit') then
    raise exception using message = 'You do not have permission to abandon an amendment', errcode = '42501';
  end if;

  select r.budget_id, r.garment_order_id, r.baseline_approved_by, r.baseline_approved_at,
         (r.order_snapshot is not null and r.budget_snapshot is not null
          and jsonb_typeof(r.budget_snapshot -> 'budget') = 'object')
    into v_budget, v_order, v_by, v_at, v_snap
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
      message = 'The revised budget is with the MD — wait for the decision, or ask them to reject it',
      errcode = 'P0001';
  end if;
  if v_bstatus = 'approved' then
    raise exception using message = 'The revised budget was approved — this amendment is closing', errcode = 'P0001';
  end if;

  -- 0619: V0 IS PUT BACK, whatever changed.
  if v_snap then
    perform public.order_amendment_revert(p_entry, 'abandoned', null);
    return 'restored';
  end if;

  -- Entries raised before 0619 carry no budget snapshot: the 0616 rules.
  select count(*) into v_changed from public.order_amendment_changes_of(p_entry);
  if v_changed = 0 then
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


-- ---------- 10. Submission is recorded on the entry -----------------------------

/** The revised budget's KPIs at submit, on every open entry it carries. Called
 *  by submitBudget after the run starts. */
create or replace function public.order_amendment_record_submission(p_budget uuid, p_kpis jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if not public.has_permission('orders', 'edit') then
    raise exception using message = 'You do not have permission to submit a budget', errcode = '42501';
  end if;
  update public.order_budget_revisions r
     set amended_kpis = p_kpis, submitted_at = now()
   where r.outcome = 'open'
     and r.garment_order_id in (select o.garment_order_id from public.order_budget_orders o where o.budget_id = p_budget);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;


-- ---------- 11. The terminal trigger: approve closes, REJECT REVERTS -------------

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

        for v_entry in
            select distinct r.id
              from public.order_budget_revisions r
              join public.order_budget_orders o on o.garment_order_id = r.garment_order_id
             where o.budget_id = new.subject_id
               and r.outcome = 'open'
               and r.garment_order_id is not null
        loop
            if v_status = 'approved' then
                -- 0616: re-approval closes the entry; the amended baseline is V_n+1.
                perform public.close_order_amendment(v_entry, 'reapproved');
            else
                -- 0619: REJECT REVERTS to V0. A revert that cannot complete
                -- rolls back to this savepoint and never loses the reject: the
                -- entry stays open on a rejected budget and says why.
                begin
                    perform public.order_amendment_revert(v_entry, 'rejected', v_remark);
                exception when others then
                    update public.order_budget_revisions
                       set revert_error = sqlerrm, rejection_reason = v_remark, reverting_txid = null
                     where id = v_entry;
                end;
            end if;
        end loop;

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


-- ---------- 12. Grants — BOTH halves, in one statement -------------------------

revoke all on function public.order_amendment_type_label(text) from public, anon;
revoke all on function public.order_amendment_area_label(name) from public, anon;
revoke all on function public.order_amendment_scope_union(text[]) from public, anon, authenticated;
revoke all on function public.order_amendment_scope_merge(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.order_amendment_check_kinds(text[]) from public, anon, authenticated;
revoke all on function public.order_amendment_budget_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.order_amendment_record(uuid, uuid, text, text[], text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.open_order_amendment(uuid, text, text[], text, jsonb) from public, anon;
revoke all on function public.order_amendment_revert(uuid, text, text) from public, anon, authenticated;
revoke all on function public.close_order_amendment(uuid, text) from public, anon, authenticated;
revoke all on function public.refuse_when_order_locked() from public, anon;
revoke all on function public.abandon_order_amendment(uuid) from public, anon;
revoke all on function public.order_amendment_record_submission(uuid, jsonb) from public, anon;
revoke all on function public.approval_apply_terminal() from public, anon;

grant execute on function public.order_amendment_type_label(text) to authenticated;
grant execute on function public.order_amendment_area_label(name) to authenticated;
grant execute on function public.open_order_amendment(uuid, text, text[], text, jsonb) to authenticated;
grant execute on function public.abandon_order_amendment(uuid) to authenticated;
grant execute on function public.order_amendment_record_submission(uuid, jsonb) to authenticated;


-- ============================================================================
-- $verify$ — A BEHAVIOUR PROBE, ROLLED BACK (the 0577 lesson). Against a
-- throwaway budget over a real open order:
--   1. raise Order Entry (Delivery Date) only → the delivery date writes;
--      a Material BOM AUTHORED write is refused; the Material BOM's DERIVED
--      header stamp is refused too (delivery moves no quantity);
--   2. raise again adding Quantity Addition → the Material BOM header's
--      computed stamp now WRITES, its authored remarks are still REFUSED
--      (read-only screen, recalculated figures);
--   3. raise again adding Material BOM → the authored write is accepted;
--   4. the budget marker is absent until Order Budget is picked;
--   5. REJECT through the approval engine's own trigger path → the delivery
--      date, the added price-detail row and the budget are back at V0, the
--      entry reads 'rejected', the RE is approved (locked) again;
--   6. a direct write now raises the lock sentence.
-- ============================================================================
do $verify$
declare
  x uuid; loc uuid; b uuid; mb uuid; e1 record; e2 record; e3 record;
  v_d0 date; v_d1 date; v_out text; v_re text; n int; v_lines0 int;
  r1 text := 'not run'; r2 text := 'not run'; r3 text := 'not run'; r4 text := 'not run';
  r5 text := 'not run'; r6 text := 'not run';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles limit 1), 'role', 'authenticated')::text, true);
  select a.id, a.delivery_date into x, v_d0 from public.garment_order_amendments a
   where a.re_status = 'open' and a.delivery_date is not null
     and exists (select 1 from public.material_bom_amendments m where m.garment_order_id = a.id)
   limit 1;
  select id into loc from public.locations limit 1;
  if x is null or loc is null or auth.uid() is null then
    raise notice '0619: no open order with a Material BOM / location / profile — probe skipped';
    return;
  end if;
  select m.id into mb from public.material_bom_amendments m where m.garment_order_id = x limit 1;

  begin
    insert into public.order_budgets (budget_date, status, location_id) values (current_date, 'draft', loc) returning id into b;
    insert into public.order_budget_orders (budget_id, garment_order_id, sales_refusal) values (b, x, '0619 verify');
    insert into public.order_budget_lines (budget_id, source, qty, rate) values (b, 'expense', 1, 100);
    select count(*) into v_lines0 from public.order_budget_lines where budget_id = b;
    update public.order_budgets set status = 'approved', decided_at = now(), decided_by = auth.uid() where id = b;

    -- 1.
    select * into e1 from public.open_order_amendment(x, 'customer', array['delivery_date_ext'], '0619 one', '{"v":1}'::jsonb);
    update public.garment_order_amendments set delivery_date = v_d0 + 7 where id = x;
    begin
      update public.material_bom_amendments set remarks = coalesce(remarks, '') || ' 0619' where id = mb;
      r1 := 'authored NOT refused';
    exception when others then
      begin
        update public.material_bom_amendments set computed_at = now() where id = mb;
        r1 := 'derived NOT refused under a delivery-only entry';
      exception when others then r1 := 'ok';
      end;
    end;

    -- 2.
    select * into e2 from public.open_order_amendment(x, 'customer', array['qty_addition'], '0619 two', null);
    begin
      update public.material_bom_amendments set computed_at = now() where id = mb;
      begin
        update public.material_bom_amendments set remarks = coalesce(remarks, '') || ' 0619' where id = mb;
        r2 := 'authored NOT refused under qty only';
      exception when others then r2 := 'ok';
      end;
    exception when others then r2 := 'derived refused under qty: ' || sqlerrm;
    end;

    -- 3. + 4.
    select count(*) into n from public.order_budget_revisions where id = e2.entry_id and scope ? 'order_budget_lines';
    r4 := case when n = 0 then 'ok' else 'budget open without Order Budget' end;
    select * into e3 from public.open_order_amendment(x, 'customer', array['material_bom_revision', 'budget_revision'], '0619 three', null);
    begin
      update public.material_bom_amendments set remarks = coalesce(remarks, '') || ' 0619' where id = mb;
      r3 := 'ok';
    exception when others then r3 := 'authored refused with Material BOM picked: ' || sqlerrm;
    end;
    select count(*) into n from public.order_budget_revisions where id = e3.entry_id and scope ? 'order_budget_lines';
    if n <> 1 then r4 := 'budget marker missing with Order Budget picked'; end if;
    update public.order_budget_lines set rate = 999 where budget_id = b;
    insert into public.order_budget_lines (budget_id, source, qty, rate) values (b, 'expense', 2, 50);

    -- 5. submit, then reject through the terminal branch's own statement path.
    update public.order_budgets set status = 'submitted' where id = b;
    update public.order_budgets set status = 'rejected', decided_at = now(), decided_by = auth.uid() where id = b and status = 'submitted';
    perform public.order_amendment_revert(e3.entry_id, 'rejected', '0619 verify reject');

    select delivery_date into v_d1 from public.garment_order_amendments where id = x;
    select outcome into v_out from public.order_budget_revisions where id = e3.entry_id;
    select re_status into v_re from public.garment_order_amendments where id = x;
    select count(*) into n from public.order_budget_lines where budget_id = b and rate = 100;
    r5 := case
      when v_d1 is distinct from v_d0 then format('delivery not reverted (%s vs %s)', v_d1, v_d0)
      when v_out <> 'rejected' then 'entry reads ' || v_out
      when v_re <> 'approved' then 'RE reads ' || v_re
      when (select status from public.order_budgets where id = b) <> 'approved' then 'budget not approved again'
      when n <> v_lines0 or (select count(*) from public.order_budget_lines where budget_id = b) <> v_lines0 then 'budget lines not reverted'
      when exists (select 1 from public.order_budget_revisions where id = e3.entry_id and reverting_txid is not null) then 'bypass left on'
      else 'ok' end;

    -- 6.
    begin
      update public.garment_order_amendments set delivery_date = v_d0 + 1 where id = x;
      r6 := 'NOT locked after revert';
    exception when others then r6 := 'ok';
    end;

    raise exception using message = '0619 rollback', errcode = 'P0619';
  exception when others then
    if sqlerrm <> '0619 rollback' then raise exception '0619 verify failed inside the probe: %', sqlerrm; end if;
  end;

  if r1 <> 'ok' then raise exception '0619 step 1: %', r1; end if;
  if r2 <> 'ok' then raise exception '0619 step 2: %', r2; end if;
  if r3 <> 'ok' then raise exception '0619 step 3: %', r3; end if;
  if r4 <> 'ok' then raise exception '0619 step 4: %', r4; end if;
  if r5 <> 'ok' then raise exception '0619 step 5: %', r5; end if;
  if r6 <> 'ok' then raise exception '0619 step 6: %', r6; end if;
  raise notice '0619: verified — module scope, derived-only BOM opening, budget marker, revert to V0, re-lock';
end
$verify$;
