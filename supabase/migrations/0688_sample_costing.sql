-- 0688 — Sample ▸ Sample Costing (doc/sample/sample-costing-specification.md)
--
-- The legacy Product Cost Sheet, rebuilt as ONE document per (sample enquiry,
-- style line, revision): fabric rate derivation, piece consumption, CMT &
-- garment processing, trims & other expenses, and the commercial quotation —
-- margin / wastage / discount, freight, currency, quoted price per piece and
-- per size group, and the set price.
--
-- THE HEADER IS `cost_sheets`, EXTENDED — not a new table. Sample Entry made
-- the same choice for `opportunities` / `styles` (0683): `quotes.cost_sheet_id`
-- already points here, so a quote raised from a sample costing links without a
-- second FK. `cost_sheets` held 0 rows when this was written (checked against
-- the catalog 2026-10-07); a sample costing is `costing_type = 'sample'`.
--
-- What each column the spec names maps to:
--   Costing No            cost_sheets.code      CST/26-27/0001 (new; shared by every revision)
--   Version / Revision    cost_sheets.version   1 = "Original (Rev 0)", 2 = "Rev 1", …
--   Margin %              cost_sheets.margin_pct            (existing)
--   Wastage %             cost_sheets.garment_waste_pct     (existing, 0320)
--   Exchange Rate         cost_sheets.exchange_rate         (existing, 0320)
--   Target Currency       cost_sheets.currency_code         (existing)
--   Calc / Quoted (set)   cost_sheets.computed_fob / target_fob — a SNAPSHOT
--                         written by the save for readers that never open the
--                         sheet (quotes, lists); the lines are the truth.
--   Effective margin      cost_sheets.profit_loss_pct — the LOWEST realised
--                         margin across the quote matrix, snapshot.
--
-- APPROVAL (spec §5.2). A sheet whose every quoted price still earns ≥ 20 %
-- clears on Submit; one that does not goes to the MD through the approval
-- engine (workflow `sample_costing`, subject `cost_sheets`). The decision lands
-- through `approval_apply_terminal` — re-created below FROM ITS LIVE BODY (the
-- 0629 / 0652 body read from pg_get_functiondef on 2026-10-07) with one branch
-- added, so no earlier subject loses its callback.

-- ---------------------------------------------------------------------------
-- 1. The header
-- ---------------------------------------------------------------------------
alter table public.cost_sheets drop constraint if exists cost_sheets_costing_type_check;
alter table public.cost_sheets add constraint cost_sheets_costing_type_check
  check (costing_type = any (array['simple'::text, 'ioc'::text, 'sample'::text]));

alter table public.cost_sheets
  add column if not exists code             text,
  add column if not exists costing_date     date,
  add column if not exists ship_mode        text,
  add column if not exists freight_per_pc   numeric(14,2),
  add column if not exists insurance_per_pc numeric(14,2),
  add column if not exists discount_pct     numeric(6,2),
  add column if not exists is_draft         boolean not null default false,
  add column if not exists submitted_at     timestamptz,
  add column if not exists submitted_by     uuid references public.profiles(id),
  add column if not exists decided_at       timestamptz,
  add column if not exists decided_by       uuid references public.profiles(id),
  add column if not exists decision_remark  text;

alter table public.cost_sheets drop constraint if exists cost_sheets_ship_mode_check;
alter table public.cost_sheets add constraint cost_sheets_ship_mode_check
  check (ship_mode is null or ship_mode in ('sea', 'air'));

-- One Costing No per revision chain: every revision carries the same code and
-- its own version.
create unique index if not exists cost_sheets_code_version_uq
  on public.cost_sheets (code, version) where code is not null;
create index if not exists idx_cs_style on public.cost_sheets (style_id);

-- ---------------------------------------------------------------------------
-- 2. The lines
--
-- pieces        one per garment piece — a SET's Top and Pants, or the one
--               piece of a PCS line — with its direct per-piece costs
-- fabrics       fabric rate derivation, one per fabric quality
--   fabric_processes   the special processing itemised under a fabric
-- consumptions  component × fabric × size group → grams per piece
-- trims         itemised accessories per piece
-- quotes        the quoted price per piece × size group (null = all sizes)
-- ---------------------------------------------------------------------------
create table if not exists public.sample_costing_pieces (
  id              uuid primary key default gen_random_uuid(),
  cost_sheet_id   uuid not null references public.cost_sheets(id) on delete cascade,
  sno             int not null default 0,
  piece_name      text not null,
  coordinate_id   uuid references public.items(id) on delete set null,
  cmt             numeric(14,2),
  print_cost      numeric(14,2),
  embroidery_cost numeric(14,2),
  wash_cost       numeric(14,2),
  testing_cost    numeric(14,2),
  bank_cost       numeric(14,2),
  created_at      timestamptz not null default now()
);
create index if not exists idx_scp_sheet on public.sample_costing_pieces (cost_sheet_id);

create table if not exists public.sample_costing_fabrics (
  id               uuid primary key default gen_random_uuid(),
  cost_sheet_id    uuid not null references public.cost_sheets(id) on delete cascade,
  sno              int not null default 0,
  fabric_id        uuid references public.items(id) on delete set null,
  quality          text,
  yarn_rate        numeric(14,2),
  knitting_rate    numeric(14,2),
  dyeing_rate      numeric(14,2),
  process_loss_pct numeric(6,2),
  is_direct        boolean not null default false,
  direct_rate      numeric(14,2),
  created_at       timestamptz not null default now()
);
create index if not exists idx_scf_sheet on public.sample_costing_fabrics (cost_sheet_id);

create table if not exists public.sample_costing_fabric_processes (
  id             uuid primary key default gen_random_uuid(),
  fabric_line_id uuid not null references public.sample_costing_fabrics(id) on delete cascade,
  sno            int not null default 0,
  process_id     uuid references public.processes(id) on delete set null,
  process_name   text,
  rate           numeric(14,2)
);
create index if not exists idx_scfp_fabric on public.sample_costing_fabric_processes (fabric_line_id);

-- NOT `sample_costing_consumptions`: that name was taken by 0323's legacy
-- consumption table (empty, read by no code). This file first shipped with the
-- colliding name, `create table if not exists` silently kept 0323's shape, and
-- the dry run failed on a missing `sno`; 0689 created this table on the live
-- database and re-created the save. 0323's table is left as it was, except
-- that this loop's first run widened its four policies to the line rule.
create table if not exists public.sample_costing_component_weights (
  id             uuid primary key default gen_random_uuid(),
  cost_sheet_id  uuid not null references public.cost_sheets(id) on delete cascade,
  sno            int not null default 0,
  piece_id       uuid not null references public.sample_costing_pieces(id) on delete cascade,
  fabric_line_id uuid references public.sample_costing_fabrics(id) on delete cascade,
  component_id   uuid references public.components(id) on delete set null,
  size_group_id  uuid references public.size_groups(id) on delete set null,
  weight_g       numeric(10,2),
  length_cm      numeric(10,2),
  width_cm       numeric(10,2),
  gsm            numeric(8,2)
);
create index if not exists idx_sccw_sheet on public.sample_costing_component_weights (cost_sheet_id);

create table if not exists public.sample_costing_trims (
  id            uuid primary key default gen_random_uuid(),
  cost_sheet_id uuid not null references public.cost_sheets(id) on delete cascade,
  sno           int not null default 0,
  piece_id      uuid not null references public.sample_costing_pieces(id) on delete cascade,
  item_id       uuid references public.items(id) on delete set null,
  description   text,
  qty           numeric(12,3),
  rate          numeric(14,4)
);
create index if not exists idx_sct_sheet on public.sample_costing_trims (cost_sheet_id);

create table if not exists public.sample_costing_quotes (
  id            uuid primary key default gen_random_uuid(),
  cost_sheet_id uuid not null references public.cost_sheets(id) on delete cascade,
  piece_id      uuid not null references public.sample_costing_pieces(id) on delete cascade,
  size_group_id uuid references public.size_groups(id) on delete set null,
  quoted_price  numeric(14,4)
);
create index if not exists idx_scq_sheet on public.sample_costing_quotes (cost_sheet_id);

-- ---------------------------------------------------------------------------
-- 3. RLS — a LINE is written by whoever may edit the document (AGENTS.md:
--    insert = create OR edit, delete = edit OR delete — or the save's
--    delete-and-reinsert doubles every line for an edit-only role).
--    `cost_sheets` is not unit-scoped, so neither are its lines.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'sample_costing_pieces', 'sample_costing_fabrics', 'sample_costing_fabric_processes',
    'sample_costing_component_weights', 'sample_costing_trims', 'sample_costing_quotes'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %1$s_read on public.%1$I', t);
    execute format('create policy %1$s_read on public.%1$I for select to authenticated
                      using (public.has_permission(''sales'', ''view''))', t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
                      using (public.has_permission(''sales'', ''edit''))
                      with check (public.has_permission(''sales'', ''edit''))', t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated
                      with check (public.has_permission(''sales'', ''create'')
                               or public.has_permission(''sales'', ''edit''))', t);
    execute format('drop policy if exists %1$s_delete on public.%1$I', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated
                      using (public.has_permission(''sales'', ''edit'')
                          or public.has_permission(''sales'', ''delete''))', t);
  end loop;
end $$;

-- A revision is a new `cost_sheets` row written by an edit-only merchandiser
-- too, so the header's insert follows the same rule as its lines.
drop policy if exists cost_sheets_insert on public.cost_sheets;
create policy cost_sheets_insert on public.cost_sheets for insert to authenticated
  with check (public.has_permission('sales', 'create') or public.has_permission('sales', 'edit'));

-- ---------------------------------------------------------------------------
-- 4. Numbering — CST/26-27/0001, the Sample series' rule (0683 / 0686): the
--    LOWEST number no existing sheet of that year holds. Re-created from
--    0686's body with a CST branch; SMP and PRD are unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.sample_series_next_no(p_series text, p_fy text)
returns int
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_re text := '^' || p_series || '/' || public.fiscal_year_label(p_fy) || '/([0-9]+)$';
  v_next int;
begin
  if p_series = 'SMP' then
    with used as (
      select substring(o.code from v_re)::int as n from public.opportunities o where o.code ~ v_re
    )
    select case when not exists (select 1 from used where n = 1) then 1
                else (select min(u.n + 1) from used u where not exists (select 1 from used v where v.n = u.n + 1))
           end into v_next;
  elsif p_series = 'PRD' then
    with used as (
      select substring(s.sample_no from v_re)::int as n from public.styles s where s.sample_no ~ v_re
    )
    select case when not exists (select 1 from used where n = 1) then 1
                else (select min(u.n + 1) from used u where not exists (select 1 from used v where v.n = u.n + 1))
           end into v_next;
  elsif p_series = 'CST' then
    with used as (
      select distinct substring(c.code from v_re)::int as n from public.cost_sheets c where c.code ~ v_re
    )
    select case when not exists (select 1 from used where n = 1) then 1
                else (select min(u.n + 1) from used u where not exists (select 1 from used v where v.n = u.n + 1))
           end into v_next;
  else
    raise exception 'Unknown sample series %', p_series;
  end if;
  return v_next;
end;
$$;

comment on function public.sample_series_next_no(text, text) is
  'Sample numbering (0683, SMP dashed 0686, CST 0688): the lowest positive number no existing Enquiry (SMP), '
  'Sample (PRD) or Costing (CST) of this financial year holds. SECURITY DEFINER so RLS cannot hide a taken number.';

revoke all on function public.sample_series_next_no(text, text) from public, anon;
grant execute on function public.sample_series_next_no(text, text) to authenticated;

create or replace function public.assign_cost_sheet_number()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_fy text;
begin
  if new.costing_type is distinct from 'sample' or (new.code is not null and new.code <> '') then
    return new;
  end if;
  v_fy := public.fiscal_year_segment(coalesce(new.costing_date, current_date));
  perform pg_advisory_xact_lock(hashtext('sample_series:CST:' || v_fy));
  new.code := public.sample_series_format('CST', v_fy, public.sample_series_next_no('CST', v_fy));
  return new;
end;
$$;
revoke all on function public.assign_cost_sheet_number() from public, anon;

drop trigger if exists trg_cs_code on public.cost_sheets;
create trigger trg_cs_code before insert on public.cost_sheets
  for each row execute function public.assign_cost_sheet_number();

-- ---------------------------------------------------------------------------
-- 5. save_sample_costing — the whole sheet in one transaction
--
-- p: { header: {...}, pieces: [...], fabrics: [{..., processes: [...]}],
--      consumptions: [{ piece_index, fabric_index, ... }],
--      trims: [{ piece_index, ... }], quotes: [{ piece_index, size_group_id, quoted_price }] }
-- Indexes are 0-based positions in `pieces` / `fabrics` of the same payload.
--
-- A sheet is written only while it is the operator's: draft, or sent back for
-- rework (`rejected`, which a save returns to draft). Submitted, approved and
-- superseded sheets are refused HERE, not just greyed on the screen.
--
-- REVISE = p_id null + header.parent_id: the new row takes the parent's code,
-- enquiry and style, version + 1, and the parent becomes `superseded` — in the
-- same transaction, so a chain can never hold two live versions.
-- Returns { id, code, version }.
-- ---------------------------------------------------------------------------
create or replace function public.save_sample_costing(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
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

    -- Children deepest-first; fabric processes follow their fabric (cascade).
    delete from public.sample_costing_quotes where cost_sheet_id = v_id;
    delete from public.sample_costing_trims where cost_sheet_id = v_id;
    delete from public.sample_costing_component_weights where cost_sheet_id = v_id;
    delete from public.sample_costing_fabrics where cost_sheet_id = v_id;
    delete from public.sample_costing_pieces where cost_sheet_id = v_id;
  end if;

  i := 0;
  for x in select * from jsonb_array_elements(coalesce(p -> 'pieces', '[]'::jsonb)) loop
    insert into public.sample_costing_pieces (
      cost_sheet_id, sno, piece_name, coordinate_id, cmt, print_cost, embroidery_cost, wash_cost, testing_cost, bank_cost
    ) values (
      v_id, i + 1,
      coalesce(nullif(btrim(x ->> 'piece_name'), ''), 'GARMENT'),
      nullif(x ->> 'coordinate_id', '')::uuid,
      nullif(x ->> 'cmt', '')::numeric,
      nullif(x ->> 'print_cost', '')::numeric,
      nullif(x ->> 'embroidery_cost', '')::numeric,
      nullif(x ->> 'wash_cost', '')::numeric,
      nullif(x ->> 'testing_cost', '')::numeric,
      nullif(x ->> 'bank_cost', '')::numeric
    ) returning id into v_new;
    v_pieces := v_pieces || v_new;
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
    );
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
$$;

revoke all on function public.save_sample_costing(uuid, jsonb) from public, anon;
grant execute on function public.save_sample_costing(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The approval engine — terminal callback + the catch-all flow
--
-- Re-created from the LIVE body (pg_get_functiondef, 2026-10-07): order_budgets,
-- iwo_budgets and hr_staff_fine_deductions are copied unchanged; `cost_sheets`
-- is added before the raising ELSE.
-- ---------------------------------------------------------------------------
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
    v_code   text;
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
        if new.status = 'cancelled' then
            update public.order_budgets b
               set status            = 'draft',
                   submitted_at      = null,
                   submitted_by      = null,
                   submitted_summary = null,
                   updated_at        = now()
             where b.id = new.subject_id
               and b.status = 'submitted';
            return new;
        end if;

        if new.status not in ('completed', 'rejected') then
            return new;
        end if;

        v_status := case new.status when 'completed' then 'approved' else 'rejected' end;

        if v_status = 'approved' and not exists (
            select 1 from public.order_budget_orders o where o.budget_id = new.subject_id
        ) then
            select coalesce(nullif(btrim(b.code), ''), left(b.id::text, 8)) into v_code
              from public.order_budgets b where b.id = new.subject_id;
            raise exception
                'Budget % no longer names any order — its orders were removed after it was submitted, so there is nothing to approve. Reject it, or delete it from Budgeting.',
                coalesce(v_code, new.subject_id::text)
                using errcode = 'P0001';
        end if;

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
                perform public.close_order_amendment(v_entry, 'reapproved');
            else
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

    if new.subject_table = 'hr_staff_fine_deductions' then
        perform public.hr_fine_apply_decision(
            new.subject_id, new.status, new.final_actor_id, v_remark,
            coalesce(new.completed_at, now()));
        return new;
    end if;

    -- 0688 — Sample Costing below the margin floor (spec §5.2). Approve clears
    -- it; Request Rework hands it back to the merchandiser (`rejected` is
    -- editable and resubmittable); a cancelled run returns it to draft, so a
    -- withdrawn submission never strands the sheet locked.
    if new.subject_table = 'cost_sheets' then
        if new.status = 'cancelled' then
            update public.cost_sheets c
               set status = 'draft', submitted_at = null, submitted_by = null, updated_at = now()
             where c.id = new.subject_id
               and c.status = 'submitted';
            return new;
        end if;

        if new.status not in ('completed', 'rejected') then
            return new;
        end if;

        update public.cost_sheets c
        set status          = case new.status when 'completed' then 'approved' else 'rejected' end,
            approved_by     = case new.status when 'completed' then new.final_actor_id else null end,
            approved_at     = case new.status when 'completed' then coalesce(new.completed_at, now()) else null end,
            decided_at      = coalesce(new.completed_at, now()),
            decided_by      = new.final_actor_id,
            decision_remark = v_remark,
            updated_at      = now()
        where c.id = new.subject_id
          and c.status = 'submitted';

        get diagnostics v_rows = row_count;

        if v_rows = 0 then
            raise exception
                'approval_apply_terminal: cost sheet % is not awaiting a decision, so this approval could not be applied. Reload the costing — it may already have been decided another way.',
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

-- The catch-all flow: the Order Budget's own MD step, copied rather than
-- re-typed, so the named approver that makes it resolvable on this database
-- (memory: super admins are never role-routed) comes with it.
insert into public.approval_flows (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select 'sample_costing',
       'Sample Costing — default',
       'Catch-all. A sample costing whose quoted price earns under 20 % margin goes to the Managing Director.',
       '{}'::jsonb,
       f.steps,
       900,
       true
  from public.approval_flows f
 where f.workflow_key = 'order_budget' and f.flow_name = 'Order Budget — default'
   and not exists (select 1 from public.approval_flows x where x.workflow_key = 'sample_costing');

-- ---------------------------------------------------------------------------
-- Read it back — `success: true` means the SQL ran, not that it did its job.
-- ---------------------------------------------------------------------------
do $$
begin
  if public.sample_series_format('CST', '2627', 1) <> 'CST/26-27/0001' then
    raise exception '0688: CST format is %', public.sample_series_format('CST', '2627', 1);
  end if;
  if public.sample_series_next_no('CST', '2627') is null then
    raise exception '0688: CST series answered nothing';
  end if;
  if not exists (select 1 from public.approval_flows where workflow_key = 'sample_costing' and is_active) then
    raise exception '0688: no active sample_costing flow';
  end if;
  if position('cost_sheets' in pg_get_functiondef('public.approval_apply_terminal'::regproc)) = 0
     or position('hr_fine_apply_decision' in pg_get_functiondef('public.approval_apply_terminal'::regproc)) = 0
     or position('order_amendment_revert' in pg_get_functiondef('public.approval_apply_terminal'::regproc)) = 0 then
    raise exception '0688: approval_apply_terminal lost a branch';
  end if;
  if exists (
    select 1 from information_schema.role_routine_grants
     where routine_schema = 'public' and routine_name = 'save_sample_costing' and grantee in ('anon', 'PUBLIC')
  ) then
    raise exception '0688: save_sample_costing is executable without a login';
  end if;
end $$;
