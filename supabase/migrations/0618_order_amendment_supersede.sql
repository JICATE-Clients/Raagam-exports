-- ============================================================================
-- Raagam ERP — 0618 Amend again while an amendment is open: SUPERSEDE
--
-- User 2026-09-22 (screenshot 3023): "i think one time only can do amend for
-- the order — no need this restriction". After AMD/26-27/0001 was raised on
-- HO/RE/26-27/0001 the order read `amending` and left the Raise picker; the
-- only way to a second change was to abandon or get the first re-approved.
--
-- THE RULE THAT STAYS: one OPEN entry per RE (`uq_obr_one_open_per_order`).
-- The trigger reads ONE frozen scope off `re_amendment_id`, `abandon` restores
-- V0 off ONE snapshot, and the register's status is ONE budget's — two open
-- entries would have no answer to "which scope", "which V0", "which status".
--
-- THE RULE THAT GOES: "an amending order cannot be amended again". A new entry
-- raised on an amending order now SUPERSEDES the open one:
--
--   - the open entry closes with `outcome = 'superseded'` (dated, like every
--     closed entry) — the audit record of what was asked first, kept;
--   - the new entry is Amend #n+1 with ITS OWN entry no, `amendment_types` =
--     the union of the old entry's and the new picks, and the frozen scope
--     recomputed from that union — so what was already open stays open and
--     the new categories are added; nothing typed under the first entry is
--     lost or re-locked;
--   - `baseline` and `order_snapshot` are COPIED from the superseded entry:
--     V0 is what was APPROVED, not the half-amended state, so the variance
--     matrix and "what changed" still compare against the approval, and an
--     abandon with no net change still restores it;
--   - `re_amendment_id` on every document of the RE moves to the new entry;
--     `re_status` stays `amending`; the budget stays draft.
--
-- Refused while the revised budget is WITH THE APPROVER (submitted): the
-- decision is theirs — reject brings it back, approve closes it.
-- ============================================================================

alter table public.order_budget_revisions drop constraint if exists chk_obr_outcome;
alter table public.order_budget_revisions
  add constraint chk_obr_outcome check (outcome in ('open', 'reapproved', 'abandoned', 'superseded'));

comment on column public.order_budget_revisions.outcome is
  'open | reapproved | abandoned | superseded. SUPERSEDED = a later entry was '
  'raised on the same order while this one was open and took over its scope '
  '(0618); the later entry carries the union of both categories.';

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
  v_t       text;
  v_scope   jsonb;
  r         record;
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
        message = format('Amendment %s is with the approver — wait for the decision before amending again', coalesce(v_old.entry_no, '')),
        errcode = 'P0001';
    end if;

    -- The union of categories, the old ones first, de-duplicated.
    select array_agg(t order by ord) into v_types
      from (select t, min(ord) as ord
              from unnest(v_old.amendment_types || coalesce(p_types, array[]::text[])) with ordinality as u(t, ord)
             where nullif(btrim(t), '') is not null
             group by t) d;
    foreach v_t in array v_types loop
      if not exists (select 1 from public.order_amendment_scopes s where s.amendment_type = v_t) then
        raise exception using
          message = format('%s has no field scope declared — it cannot be raised', public.order_amendment_type_label(v_t)),
          errcode = '22023';
      end if;
    end loop;
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

    -- Close the old one FIRST: uq_obr_one_open_per_order admits one open entry.
    update public.order_budget_revisions
       set outcome = 'superseded', closed_at = now(), closed_by = auth.uid()
     where id = v_old.id;

    select coalesce(max(rv.revision_no), 0) + 1 into v_no
      from public.order_budget_revisions rv where rv.budget_id = v_old.budget_id;

    insert into public.order_budget_revisions (
      budget_id, garment_order_id, revision_no, entry_no, source, amendment_type, amendment_types,
      reason, baseline, scope, order_snapshot, baseline_approved_by, baseline_approved_at, reopened_by
    ) values (
      v_old.budget_id, p_order, v_no, public.next_order_amendment_no(),
      p_source, v_types[1], v_types, btrim(p_reason),
      v_old.baseline, v_scope, v_old.order_snapshot,
      v_old.baseline_approved_by, v_old.baseline_approved_at, auth.uid()
    ) returning id into v_entry;

    update public.garment_order_amendments a
       set re_amendment_id = v_entry, re_status_at = now()
     where a.re_amendment_id = v_old.id;

    return query
      select r3.id, r3.entry_no from public.order_budget_revisions r3 where r3.id = v_entry;
    return;
  end if;

  -- ---- APPROVED: the first entry (0604 · 0616) ----------------------------
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

revoke all on function public.open_order_amendment(uuid, text, text[], text, jsonb) from public, anon;
grant execute on function public.open_order_amendment(uuid, text, text[], text, jsonb) to authenticated;

-- ---------- A COMBO / COLOUR CHANGE OPENS BOTH BOMs (seed correction) -------
-- Found the same afternoon: AMD/26-27/0001 (Combo / Color Change) added a
-- combo, the Approval Qty rows moved with it, both BOMs read Recalculate —
-- and the scope did not open them, so the operator could neither re-save the
-- BOMs nor send the budget (the freshness gate refuses a stale BOM). A new
-- colourway with no fabric plan is an order that cannot be made — the reason
-- 0604 already gives for the quantity types — so the seed gains both BOMs for
-- combo_colour_change, and the TS mirror + check:amendment-scope follow.
insert into public.order_amendment_scopes (amendment_type, table_name, columns, allows_insert, allows_delete) values
  ('combo_colour_change', 'order_fabric_boms',                      null, true, false),
  ('combo_colour_change', 'order_fabric_bom_dias',                  null, true, true),
  ('combo_colour_change', 'order_fabric_bom_lines',                 null, true, true),
  ('combo_colour_change', 'order_fabric_bom_manual_entries',        null, true, true),
  ('combo_colour_change', 'order_fabric_bom_manual_combos',         null, true, true),
  ('combo_colour_change', 'order_fabric_bom_manual_components',     null, true, true),
  ('combo_colour_change', 'order_fabric_bom_manual_sizes',          null, true, true),
  ('combo_colour_change', 'order_fabric_bom_process_scope',         null, true, true),
  ('combo_colour_change', 'order_fabric_bom_processes',             null, true, true),
  ('combo_colour_change', 'order_fabric_bom_requirements',          null, true, true),
  ('combo_colour_change', 'order_fabric_bom_yarns',                 null, true, true),
  ('combo_colour_change', 'order_fabric_bom_yarn_stages',           null, true, true),
  ('combo_colour_change', 'order_fabric_bom_yd_combinations',       null, true, true),
  ('combo_colour_change', 'order_fabric_bom_yd_combination_colors', null, true, true),
  ('combo_colour_change', 'order_fabric_bom_yd_repeats',            null, true, true),
  ('combo_colour_change', 'material_bom_amendments',                null, true, false),
  ('combo_colour_change', 'material_bom_amendment_items',           null, true, true),
  ('combo_colour_change', 'material_bom_amendment_item_components', null, true, true),
  ('combo_colour_change', 'material_bom_amendment_item_slices',     null, true, true),
  ('combo_colour_change', 'material_bom_amendment_processes',       null, true, true),
  ('combo_colour_change', 'material_bom_amendment_requirements',    null, true, true)
on conflict (amendment_type, table_name) do update
  set columns = excluded.columns, allows_insert = excluded.allows_insert, allows_delete = excluded.allows_delete;

-- RE-FREEZE THE OPEN ENTRIES THAT CARRY IT. A frozen scope exists so a seed
-- edit cannot quietly widen an open entry; this is the one deliberate,
-- written-down exception — the seed was WRONG and the open entry is stuck
-- because of it. Only open entries, only those naming the type.
update public.order_budget_revisions r
   set scope = (
     select jsonb_object_agg(t.tbl, jsonb_build_object(
              'columns', case when t.whole then null else to_jsonb(t.cols) end,
              'insert', t.ins, 'delete', t.del))
       from (
         select s.table_name::text as tbl,
                bool_or(s.columns is null) as whole,
                array_remove(array_agg(distinct c), null) as cols,
                bool_or(s.allows_insert) as ins,
                bool_or(s.allows_delete) as del
           from public.order_amendment_scopes s
           left join lateral unnest(coalesce(s.columns, array[]::text[])) c on true
          where s.amendment_type = any(r.amendment_types)
          group by s.table_name
       ) t)
 where r.outcome = 'open'
   and r.scope is not null
   and 'combo_colour_change' = any(r.amendment_types);


-- ---------- "What changed" v2: a rewritten grid is not a changed grid ---------
-- Order Entry saves a child grid by deleting every row and reinserting it, so
-- every row gets a NEW id — and the v1 diff (0616), matching rows by id, read
-- an untouched grid of 8 rows as "8 removed, 8 added". Now: rows that still
-- match by id are compared as before (a changed row is a changed row); the
-- rest are compared as BODIES with the volatile keys stripped — the row's own
-- id, its parent links (which were reinserted too) and the timestamps — and
-- identical bodies cancel. What is left is what was really added or removed.
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
  -- keys that change on a delete-and-reinsert without the row meaning anything different
  v_vol   constant text[] := array[
    'id', 'created_at', 'updated_at', 'created_by',
    'amendment_id', 'bom_id', 'entry_id', 'combo_id', 'structure_id', 'quantity_id',
    'line_id', 'yarn_id', 'combination_id', 'item_line_id', 'garment_order_id'
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
      with o as (select e ->> 'id' as rid, e - v_bk as body, (e - v_bk) - v_vol as shape from jsonb_array_elements(v_old) e),
           n as (select e ->> 'id' as rid, e - v_bk as body, (e - v_bk) - v_vol as shape from jsonb_array_elements(v_new) e),
           kept as (select o.rid, o.body as o_body, n.body as n_body from o join n on n.rid = o.rid),
           o_rest as (select o.shape, row_number() over (partition by o.shape) as k from o where not exists (select 1 from n where n.rid = o.rid)),
           n_rest as (select n.shape, row_number() over (partition by n.shape) as k from n where not exists (select 1 from o where o.rid = n.rid)),
           added   as (select count(*) as c from n_rest nr where not exists (select 1 from o_rest orr where orr.shape = nr.shape and orr.k = nr.k)),
           removed as (select count(*) as c from o_rest orr where not exists (select 1 from n_rest nr where nr.shape = orr.shape and nr.k = orr.k)),
           changed as (select count(*) as c from kept where kept.o_body <> kept.n_body)
      select v_tbl,
             public.order_amendment_area_label(v_tbl::name)::text,
             (select c from added)::int,
             (select c from removed)::int,
             (select c from changed)::int,
             case when v_tbl = 'garment_order_amendments' then
               (select array_agg(k order by k)
                  from kept, jsonb_object_keys(kept.n_body) k
                 where (kept.n_body -> k) is distinct from (kept.o_body -> k))
             end
       where (select c from added) > 0 or (select c from removed) > 0 or (select c from changed) > 0;
  end loop;
end;
$$;

revoke all on function public.order_amendment_changes_of(uuid) from public, anon, authenticated;


-- $verify$ — rolled back: raise on an approved order, raise AGAIN with another
-- category → the first is superseded, the second carries the union, the RE is
-- still amending and points at the second, and a write the first did not open
-- but the second does is now accepted.
do $verify$
declare
  x uuid; st uuid; loc uuid; b uuid; e1 record; e2 record; v_out text; n int;
  r_super text := 'not run'; r_union text := 'not run'; r_price text := 'not run';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles limit 1), 'role', 'authenticated')::text, true);
  select a.id into x from public.garment_order_amendments a
   where a.re_status = 'open' and a.delivery_date is not null
     and exists (select 1 from public.garment_order_amendment_styles s where s.amendment_id = a.id) limit 1;
  select id into loc from public.locations limit 1;
  if x is null or loc is null or auth.uid() is null then
    raise notice '0618: no open order / location / profile — probe skipped';
    return;
  end if;
  select s.id into st from public.garment_order_amendment_styles s where s.amendment_id = x limit 1;
  begin
    insert into public.order_budgets (budget_date, status, location_id) values (current_date, 'draft', loc) returning id into b;
    insert into public.order_budget_orders (budget_id, garment_order_id, sales_refusal) values (b, x, '0618 verify');
    update public.order_budgets set status = 'approved', decided_at = now(), decided_by = auth.uid() where id = b;

    select * into e1 from public.open_order_amendment(x, 'customer', array['delivery_date_ext'], '0618 first', '{"v":1}'::jsonb);
    -- a Prices write is refused under the first entry
    begin
      update public.garment_order_amendment_price_details set updated_at = now() where amendment_id = x;
      insert into public.garment_order_amendment_price_details (amendment_id, sno) values (x, 9903);
      r_price := 'NOT refused';
    exception when others then r_price := 'refused';
    end;
    -- raise again: Price Change on top
    select * into e2 from public.open_order_amendment(x, 'internal', array['price_change'], '0618 second', null);
    select outcome into v_out from public.order_budget_revisions where id = e1.entry_id;
    r_super := case when v_out = 'superseded' then 'superseded' else 'wrong: ' || v_out end;
    select count(*) into n from public.order_budget_revisions r where r.id = e2.entry_id
       and r.amendment_types = array['delivery_date_ext', 'price_change'] and r.outcome = 'open'
       and (r.scope ? 'garment_order_amendment_price_details') and (r.scope -> 'garment_order_amendments' -> 'columns' @> '["delivery_date"]');
    select a.re_status into v_out from public.garment_order_amendments a where a.id = x;
    r_union := case when n = 1 and v_out = 'amending' then 'union' else format('wrong: n=%s re=%s', n, v_out) end;
    if (select a.re_amendment_id from public.garment_order_amendments a where a.id = x) <> e2.entry_id then
      raise exception '0618: the RE does not point at the superseding entry';
    end if;
    -- …and the Prices write is accepted now
    if r_price = 'refused' then
      insert into public.garment_order_amendment_price_details (amendment_id, sno) values (x, 9903);
      r_price := 'refused then allowed';
    end if;
    raise exception using message = '0618 rollback', errcode = 'P0618';
  exception when others then
    if sqlerrm <> '0618 rollback' then raise exception '0618 verify failed inside the probe: %', sqlerrm; end if;
  end;
  if r_super <> 'superseded' then raise exception '0618: first entry %', r_super; end if;
  if r_union <> 'union' then raise exception '0618: second entry %', r_union; end if;
  if r_price <> 'refused then allowed' then raise exception '0618: prices write %', r_price; end if;
  if not exists (select 1 from public.order_amendment_scopes where amendment_type = 'combo_colour_change' and table_name = 'order_fabric_boms') then
    raise exception '0618: combo_colour_change still does not open the Fabric BOM';
  end if;
  if exists (select 1 from public.order_budget_revisions r where r.outcome = 'open' and 'combo_colour_change' = any(r.amendment_types) and not (r.scope ? 'order_fabric_boms')) then
    raise exception '0618: an open Combo / Colour entry was not re-frozen with the BOMs';
  end if;
  raise notice '0618: verified — supersede, union scope, RE repointed, newly opened write accepted';
end
$verify$;
