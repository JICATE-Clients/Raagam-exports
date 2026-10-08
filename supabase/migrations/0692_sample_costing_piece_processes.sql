-- 0692 · Sample Costing: CMT operations + Embellishment lines (2026-10-08).
--
-- A garment piece's CMT is EITHER one flat rate (the old `cmt` column, still
-- the Direct rate) OR a list of operation lines picked from the Process master
-- (kind 'cmt'); its Embellishment cost is a list of Process-master picks
-- (kind 'embellishment'), each with a ₹/piece rate. The fixed print_cost /
-- embroidery_cost / wash_cost columns are no longer written or read — left in
-- place (no drops; sample_costing_pieces held 0 rows when this ran).
--
-- Shape copied from the sibling children (sample_costing_trims,
-- sample_costing_fabric_processes): plain `sales` permission policies, because
-- cost_sheets itself is not unit-scoped, so there is no lv_ owner to follow.

alter table public.sample_costing_pieces
  add column if not exists cmt_direct boolean not null default true;

create table if not exists public.sample_costing_piece_processes (
  id           uuid primary key default gen_random_uuid(),
  piece_id     uuid not null references public.sample_costing_pieces (id) on delete cascade,
  sno          integer not null default 0,
  kind         text not null check (kind in ('cmt', 'embellishment')),
  process_id   uuid references public.processes (id) on delete set null,
  process_name text,
  rate         numeric
);

create index if not exists idx_scpp_piece on public.sample_costing_piece_processes (piece_id);

alter table public.sample_costing_piece_processes enable row level security;

drop policy if exists sample_costing_piece_processes_read on public.sample_costing_piece_processes;
create policy sample_costing_piece_processes_read on public.sample_costing_piece_processes
  for select to authenticated using (public.has_permission('sales', 'view'));

drop policy if exists sample_costing_piece_processes_insert on public.sample_costing_piece_processes;
create policy sample_costing_piece_processes_insert on public.sample_costing_piece_processes
  for insert to authenticated
  with check (public.has_permission('sales', 'create') or public.has_permission('sales', 'edit'));

drop policy if exists sample_costing_piece_processes_update on public.sample_costing_piece_processes;
create policy sample_costing_piece_processes_update on public.sample_costing_piece_processes
  for update to authenticated
  using (public.has_permission('sales', 'edit'))
  with check (public.has_permission('sales', 'edit'));

drop policy if exists sample_costing_piece_processes_delete on public.sample_costing_piece_processes;
create policy sample_costing_piece_processes_delete on public.sample_costing_piece_processes
  for delete to authenticated
  using (public.has_permission('sales', 'edit') or public.has_permission('sales', 'delete'));

-- This app has no logged-out surface: the anon key is only the transport key.
revoke all on table public.sample_costing_piece_processes from anon;

-- save_sample_costing: re-created from its LIVE body (not from 0688/0690), with
-- two additions — the piece's cmt_direct flag, and its CMT / Embellishment
-- lines, written in the same transaction as everything else.
create or replace function public.save_sample_costing(p_id uuid, p jsonb)
 returns jsonb
 language plpgsql
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  h          jsonb := p -> 'header';
  sm         jsonb := coalesce(p -> 'header' -> 'summary', '{}'::jsonb);
  v_id       uuid := p_id;
  v_code     text;
  v_version  int;
  v_status   text;
  v_opp      uuid := nullif(h ->> 'opportunity_id', '')::uuid;
  v_style    uuid := nullif(h ->> 'style_id', '')::uuid;
  v_parent   uuid := nullif(h ->> 'parent_id', '')::uuid;
  v_draft    boolean := coalesce((h ->> 'is_draft')::boolean, false);
  v_pieces   uuid[] := '{}';
  v_fabrics  uuid[] := '{}';
  v_new      uuid;
  x          jsonb;
  y          jsonb;
  i          int;
  n          int;
begin
  if v_parent is not null and v_id is null then
    select c.opportunity_id, c.style_id, c.code, c.version, c.status
      into v_opp, v_style, v_code, v_version, v_status
      from public.cost_sheets c where c.id = v_parent for update;
    if not found then
      raise exception 'The costing being revised no longer exists.' using errcode = '23503';
    end if;
    if v_status not in ('approved', 'rejected') then
      raise exception 'Only an approved costing, or one sent back for rework, can be revised (this one is %).', v_status
        using errcode = '55000';
    end if;
    update public.cost_sheets set status = 'superseded' where id = v_parent;
    v_version := v_version + 1;
  end if;

  if v_opp is null then
    raise exception 'Choose the Sample No before saving the costing.' using errcode = '23502';
  end if;
  if v_style is not null and not exists (
    select 1 from public.styles s where s.id = v_style and s.opportunity_id = v_opp
  ) then
    raise exception 'That style line does not belong to the chosen sample enquiry.' using errcode = '23503';
  end if;

  if v_id is null then
    insert into public.cost_sheets (
      opportunity_id, style_id, version, status, costing_type, costing_for, code, parent_cost_sheet_id,
      costing_date, currency_code, exchange_rate, margin_pct, garment_waste_pct, discount_pct,
      ship_mode, freight_per_pc, insurance_per_pc, notes, is_draft,
      fabric_cost, cmt_cost, garment_process_cost, trims_cost, other_expenses_cost, gross_cost,
      fob_inr, computed_fob, target_fob, profit_loss_pct
    ) values (
      v_opp, v_style, coalesce(v_version, 1), 'draft', 'sample', 'sample', v_code, v_parent,
      coalesce(nullif(h ->> 'costing_date', '')::date, current_date),
      nullif(h ->> 'currency_code', ''),
      nullif(h ->> 'exchange_rate', '')::numeric,
      nullif(h ->> 'margin_pct', '')::numeric,
      nullif(h ->> 'garment_waste_pct', '')::numeric,
      nullif(h ->> 'discount_pct', '')::numeric,
      nullif(h ->> 'ship_mode', ''),
      nullif(h ->> 'freight_per_pc', '')::numeric,
      nullif(h ->> 'insurance_per_pc', '')::numeric,
      nullif(h ->> 'notes', ''),
      v_draft,
      nullif(sm ->> 'fabric_cost', '')::numeric,
      nullif(sm ->> 'cmt_cost', '')::numeric,
      nullif(sm ->> 'garment_process_cost', '')::numeric,
      nullif(sm ->> 'trims_cost', '')::numeric,
      nullif(sm ->> 'other_expenses_cost', '')::numeric,
      nullif(sm ->> 'gross_cost', '')::numeric,
      nullif(sm ->> 'fob_inr', '')::numeric,
      coalesce(nullif(sm ->> 'computed_fob', '')::numeric, 0),
      nullif(sm ->> 'target_fob', '')::numeric,
      nullif(sm ->> 'profit_loss_pct', '')::numeric
    )
    returning id, code, version into v_id, v_code, v_version;
  else
    select c.status into v_status from public.cost_sheets c where c.id = v_id for update;
    if not found then
      raise exception 'This costing no longer exists.' using errcode = '23503';
    end if;
    if v_status not in ('draft', 'rejected') then
      raise exception 'This costing is % and cannot be changed. Revise it to negotiate a new price.', v_status
        using errcode = '55000';
    end if;
    update public.cost_sheets set
      opportunity_id      = v_opp,
      style_id            = v_style,
      status              = 'draft',
      costing_date        = coalesce(nullif(h ->> 'costing_date', '')::date, costing_date, current_date),
      currency_code       = nullif(h ->> 'currency_code', ''),
      exchange_rate       = nullif(h ->> 'exchange_rate', '')::numeric,
      margin_pct          = nullif(h ->> 'margin_pct', '')::numeric,
      garment_waste_pct   = nullif(h ->> 'garment_waste_pct', '')::numeric,
      discount_pct        = nullif(h ->> 'discount_pct', '')::numeric,
      ship_mode           = nullif(h ->> 'ship_mode', ''),
      freight_per_pc      = nullif(h ->> 'freight_per_pc', '')::numeric,
      insurance_per_pc    = nullif(h ->> 'insurance_per_pc', '')::numeric,
      notes               = nullif(h ->> 'notes', ''),
      is_draft            = v_draft,
      fabric_cost         = nullif(sm ->> 'fabric_cost', '')::numeric,
      cmt_cost            = nullif(sm ->> 'cmt_cost', '')::numeric,
      garment_process_cost = nullif(sm ->> 'garment_process_cost', '')::numeric,
      trims_cost          = nullif(sm ->> 'trims_cost', '')::numeric,
      other_expenses_cost = nullif(sm ->> 'other_expenses_cost', '')::numeric,
      gross_cost          = nullif(sm ->> 'gross_cost', '')::numeric,
      fob_inr             = nullif(sm ->> 'fob_inr', '')::numeric,
      computed_fob        = coalesce(nullif(sm ->> 'computed_fob', '')::numeric, 0),
      target_fob          = nullif(sm ->> 'target_fob', '')::numeric,
      profit_loss_pct     = nullif(sm ->> 'profit_loss_pct', '')::numeric
    where id = v_id
    returning code, version into v_code, v_version;

    delete from public.sample_costing_quotes where cost_sheet_id = v_id;
    delete from public.sample_costing_trims where cost_sheet_id = v_id;
    delete from public.sample_costing_component_weights where cost_sheet_id = v_id;
    delete from public.sample_costing_fabrics where cost_sheet_id = v_id;
    delete from public.sample_costing_pieces where cost_sheet_id = v_id;
  end if;

  -- 0690: Overhead % (UI/UX spec §4.5).
  update public.cost_sheets set overhead_pct = nullif(h ->> 'overhead_pct', '')::numeric where id = v_id;

  i := 0;
  for x in select * from jsonb_array_elements(coalesce(p -> 'pieces', '[]'::jsonb)) loop
    insert into public.sample_costing_pieces (
      cost_sheet_id, sno, piece_name, coordinate_id, cmt, print_cost, embroidery_cost, wash_cost, testing_cost, bank_cost,
      cmt_direct
    ) values (
      v_id, i + 1,
      coalesce(nullif(btrim(x ->> 'piece_name'), ''), 'GARMENT'),
      nullif(x ->> 'coordinate_id', '')::uuid,
      nullif(x ->> 'cmt', '')::numeric,
      nullif(x ->> 'print_cost', '')::numeric,
      nullif(x ->> 'embroidery_cost', '')::numeric,
      nullif(x ->> 'wash_cost', '')::numeric,
      nullif(x ->> 'testing_cost', '')::numeric,
      nullif(x ->> 'bank_cost', '')::numeric,
      -- 0692: Direct rate (the flat `cmt`) or the operation lines below.
      coalesce((x ->> 'cmt_direct')::boolean, true)
    ) returning id into v_new;
    v_pieces := v_pieces || v_new;
    -- 0692: CMT operations and Embellishments picked from the Process master.
    n := 0;
    for y in select * from jsonb_array_elements(coalesce(x -> 'lines', '[]'::jsonb)) loop
      n := n + 1;
      insert into public.sample_costing_piece_processes (piece_id, sno, kind, process_id, process_name, rate)
      values (v_new, n, y ->> 'kind', nullif(y ->> 'process_id', '')::uuid,
              nullif(btrim(y ->> 'process_name'), ''), nullif(y ->> 'rate', '')::numeric);
    end loop;
    i := i + 1;
  end loop;
  if cardinality(v_pieces) = 0 then
    raise exception 'A costing needs at least one garment piece.' using errcode = '23502';
  end if;

  i := 0;
  for x in select * from jsonb_array_elements(coalesce(p -> 'fabrics', '[]'::jsonb)) loop
    insert into public.sample_costing_fabrics (
      cost_sheet_id, sno, fabric_id, quality, yarn_rate, knitting_rate, dyeing_rate, process_loss_pct, is_direct, direct_rate
    ) values (
      v_id, i + 1,
      nullif(x ->> 'fabric_id', '')::uuid,
      nullif(btrim(x ->> 'quality'), ''),
      nullif(x ->> 'yarn_rate', '')::numeric,
      nullif(x ->> 'knitting_rate', '')::numeric,
      nullif(x ->> 'dyeing_rate', '')::numeric,
      nullif(x ->> 'process_loss_pct', '')::numeric,
      coalesce((x ->> 'is_direct')::boolean, false),
      nullif(x ->> 'direct_rate', '')::numeric
    ) returning id into v_new;
    v_fabrics := v_fabrics || v_new;
    -- 0690: Finishing rate and the Yarn Mix breakdown (UI/UX spec §4.2).
    update public.sample_costing_fabrics set finishing_rate = nullif(x ->> 'finishing_rate', '')::numeric where id = v_new;
    n := 0;
    for y in select * from jsonb_array_elements(coalesce(x -> 'yarns', '[]'::jsonb)) loop
      n := n + 1;
      insert into public.sample_costing_fabric_yarns (fabric_line_id, sno, item_id, yarn_name, mix_pct, rate)
      values (v_new, n, nullif(y ->> 'item_id', '')::uuid, nullif(btrim(y ->> 'yarn_name'), ''),
              nullif(y ->> 'mix_pct', '')::numeric, nullif(y ->> 'rate', '')::numeric);
    end loop;
    n := 0;
    for y in select * from jsonb_array_elements(coalesce(x -> 'processes', '[]'::jsonb)) loop
      n := n + 1;
      insert into public.sample_costing_fabric_processes (fabric_line_id, sno, process_id, process_name, rate)
      values (v_new, n, nullif(y ->> 'process_id', '')::uuid, nullif(btrim(y ->> 'process_name'), ''), nullif(y ->> 'rate', '')::numeric);
    end loop;
    i := i + 1;
  end loop;

  i := 0;
  for x in select * from jsonb_array_elements(coalesce(p -> 'consumptions', '[]'::jsonb)) loop
    i := i + 1;
    if (x ->> 'piece_index')::int is null or (x ->> 'piece_index')::int >= cardinality(v_pieces) then
      raise exception 'Consumption line % names a garment piece that is not on the costing.', i using errcode = '22023';
    end if;
    insert into public.sample_costing_component_weights (
      cost_sheet_id, sno, piece_id, fabric_line_id, component_id, size_group_id, weight_g, length_cm, width_cm, gsm
    ) values (
      v_id, i,
      v_pieces[(x ->> 'piece_index')::int + 1],
      case when nullif(x ->> 'fabric_index', '') is null then null
           else v_fabrics[(x ->> 'fabric_index')::int + 1] end,
      nullif(x ->> 'component_id', '')::uuid,
      nullif(x ->> 'size_group_id', '')::uuid,
      nullif(x ->> 'weight_g', '')::numeric,
      nullif(x ->> 'length_cm', '')::numeric,
      nullif(x ->> 'width_cm', '')::numeric,
      nullif(x ->> 'gsm', '')::numeric
    ) returning id into v_new;
    -- 0690: the component's wastage allowance (UI/UX spec §4.3).
    update public.sample_costing_component_weights set wastage_pct = nullif(x ->> 'wastage_pct', '')::numeric where id = v_new;
  end loop;

  i := 0;
  for x in select * from jsonb_array_elements(coalesce(p -> 'trims', '[]'::jsonb)) loop
    i := i + 1;
    if (x ->> 'piece_index')::int is null or (x ->> 'piece_index')::int >= cardinality(v_pieces) then
      raise exception 'Trim line % names a garment piece that is not on the costing.', i using errcode = '22023';
    end if;
    insert into public.sample_costing_trims (cost_sheet_id, sno, piece_id, item_id, description, qty, rate)
    values (
      v_id, i,
      v_pieces[(x ->> 'piece_index')::int + 1],
      nullif(x ->> 'item_id', '')::uuid,
      nullif(btrim(x ->> 'description'), ''),
      nullif(x ->> 'qty', '')::numeric,
      nullif(x ->> 'rate', '')::numeric
    );
  end loop;

  for x in select * from jsonb_array_elements(coalesce(p -> 'quotes', '[]'::jsonb)) loop
    if (x ->> 'piece_index')::int is null or (x ->> 'piece_index')::int >= cardinality(v_pieces) then
      continue;
    end if;
    if nullif(x ->> 'quoted_price', '') is null then
      continue;
    end if;
    insert into public.sample_costing_quotes (cost_sheet_id, piece_id, size_group_id, quoted_price)
    values (
      v_id,
      v_pieces[(x ->> 'piece_index')::int + 1],
      nullif(x ->> 'size_group_id', '')::uuid,
      (x ->> 'quoted_price')::numeric
    );
  end loop;

  return jsonb_build_object('id', v_id, 'code', v_code, 'version', v_version);
end;
$function$;

-- Function grants (AGENTS.md): never reachable without a login. Both grants in
-- one statement; CREATE OR REPLACE keeps the existing ACL, this states it.
revoke all on function public.save_sample_costing(uuid, jsonb) from public, anon;
grant execute on function public.save_sample_costing(uuid, jsonb) to authenticated, service_role;
