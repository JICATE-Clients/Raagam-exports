-- ============================================================================
-- Raagam ERP — 0683 Sample Entry (doc/sample/sample-module-specification.md).
--
-- The legacy "Create Opportunities" and "Define Styles" become ONE document,
-- Sample ▸ Samples & Development ▸ Sample Entry (/sales/sample-entry). The user
-- chose (2026-10-06) to BUILD ON THE TABLES THOSE TWO SCREENS ALREADY WRITE
-- rather than mint new ones, because Cost Sheets, PD Requests, Quotes and
-- Samples already key on them:
--
--   opportunities  = the enquiry header        Enquiry No  OPP/2627/0186
--   styles         = one style line + its       Sample No   PRD/2627/0222
--                    Product Info
--   style_sizes / style_combos / style_combo_sizes = Combos ▸ size matrix
--   + NEW sample_style_coordinates               Unit = SET components
--   + NEW sample_style_quantities                Quantities (Billable = Yes)
--   + NEW sample_quantity_assort_lines / _sizes  the Assortment sheet
--
-- Both tables held almost nothing on the day (3 opportunities, 0 styles), so
-- every change here is additive or a widening; no existing row changes meaning.
--
-- ## THE CUSTOMER IS THE CUSTOMER MASTER, NOT `buyers`
--
-- `opportunities.buyer_id` points at the scaffold `buyers` table (memory:
-- two party tables). The Garment Order moved to `customers` in 0404 for the
-- reason this screen has too: the customers the business keeps are entered on
-- the Customer master and are unreachable through `buyers`. So `customer_id`
-- is added and `buyer_id` becomes NULLABLE — the bulk "Create Opportunities"
-- screen still fills it; Sample Entry fills `customer_id`.
--
-- ## WRITTEN IN ONE TRANSACTION
--
-- `save_sample_entry` writes the header, its style lines and every child tree
-- in one statement. Five tables deep through PostgREST would be ~20 round
-- trips (memory: load time = round trips) and a failure half way would leave a
-- header with half its styles. SECURITY INVOKER: every write still passes RLS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Header — opportunities
-- ---------------------------------------------------------------------------
alter table public.opportunities
  add column if not exists customer_id uuid references public.customers(id) on delete restrict,
  add column if not exists enquiry_action text,
  add column if not exists season_year int,
  add column if not exists agent_id uuid references public.config_lookups(id) on delete set null,
  add column if not exists is_draft boolean not null default false;

alter table public.opportunities alter column buyer_id drop not null;

create index if not exists opportunities_customer_id_idx on public.opportunities(customer_id);

-- Against: the spec's three origins join the scaffold's three words.
alter table public.opportunities drop constraint if exists opportunities_enquiry_against_check;
alter table public.opportunities add constraint opportunities_enquiry_against_check check (
  enquiry_against is null or enquiry_against = any (array[
    'new', 'repeat', 'development',
    'customer_request', 'sales_meeting', 'new_development'
  ])
);

alter table public.opportunities drop constraint if exists opportunities_enquiry_action_check;
alter table public.opportunities add constraint opportunities_enquiry_action_check check (
  enquiry_action is null or enquiry_action = any (array['quote', 'development', 'quote_development'])
);

alter table public.opportunities drop constraint if exists opportunities_season_year_check;
alter table public.opportunities add constraint opportunities_season_year_check check (
  season_year is null or season_year between 2000 and 2100
);

-- ---------------------------------------------------------------------------
-- 2. Style line + Product Info — styles
-- ---------------------------------------------------------------------------
alter table public.styles
  add column if not exists sno int,
  add column if not exists sample_no text,
  add column if not exists unit_kind text,
  add column if not exists merchandiser_id uuid references public.staff(id) on delete set null,
  add column if not exists order_date date,
  add column if not exists fabric_structure_id uuid references public.categories(id) on delete set null,
  add column if not exists fabric_id uuid references public.items(id) on delete set null,
  add column if not exists gsm numeric(10, 2),
  add column if not exists tech_pack text,
  add column if not exists customer_reference text,
  add column if not exists receipt_mode text,
  add column if not exists receipt_date date,
  add column if not exists delivery_to text,
  add column if not exists agent_id uuid references public.config_lookups(id) on delete set null,
  add column if not exists delivery_mode text,
  add column if not exists delivery_through text,
  add column if not exists accessories_reqd boolean not null default false,
  add column if not exists billable boolean not null default false,
  add column if not exists currency_code text references public.currencies(code),
  add column if not exists price numeric(14, 4);

create unique index if not exists styles_sample_no_key on public.styles(sample_no) where sample_no is not null;

alter table public.styles drop constraint if exists styles_unit_kind_check;
alter table public.styles add constraint styles_unit_kind_check check (
  unit_kind is null or unit_kind = any (array['piece', 'set'])
);
alter table public.styles drop constraint if exists styles_tech_pack_check;
alter table public.styles add constraint styles_tech_pack_check check (
  tech_pack is null or tech_pack = any (array['not_required', 'received', 'to_be_received'])
);
-- Same vocabularies the header already enforces (0368), so a line can never
-- hold a mode the header could not.
alter table public.styles drop constraint if exists styles_receipt_mode_check;
alter table public.styles add constraint styles_receipt_mode_check check (
  receipt_mode is null or receipt_mode = any (array['EMAIL', 'PHONE', 'FAX', 'COURIER', 'DIRECT'])
);
alter table public.styles drop constraint if exists styles_delivery_mode_check;
alter table public.styles add constraint styles_delivery_mode_check check (
  delivery_mode is null or delivery_mode = any (array['AIR', 'SEA', 'COURIER', 'ROAD'])
);
-- Ship Mode gains COURIER (spec §4.3: Air, Sea, Courier).
alter table public.styles drop constraint if exists styles_ship_mode_check;
alter table public.styles add constraint styles_ship_mode_check check (
  ship_mode is null or ship_mode = any (array['AIR', 'SEA', 'ROAD', 'COURIER'])
);
alter table public.styles drop constraint if exists styles_price_check;
alter table public.styles add constraint styles_price_check check (price is null or price >= 0);

-- Extra Qty on a combo (spec §5.2: Total = Sample Order Qty + Extra Qty).
alter table public.style_combos add column if not exists extra_qty numeric;

-- ---------------------------------------------------------------------------
-- 3. New child tables
-- ---------------------------------------------------------------------------
create table if not exists public.sample_style_coordinates (
  id            uuid primary key default gen_random_uuid(),
  style_id      uuid not null references public.styles(id) on delete cascade,
  sno           int not null default 0,
  -- A COORDINATE IS A GARMENT (0396): `items` of class GAR, the list Order
  -- Entry's coordinate cell reads.
  coordinate_id uuid references public.items(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid()
);
create index if not exists sample_style_coordinates_style_idx on public.sample_style_coordinates(style_id);

create table if not exists public.sample_style_quantities (
  id                    uuid primary key default gen_random_uuid(),
  style_id              uuid not null references public.styles(id) on delete cascade,
  sno                   int not null default 0,
  country_id            uuid references public.countries(id) on delete set null,
  ref_no                text,
  consignee_id          uuid references public.consignees(id) on delete set null,
  assortment_type_id    uuid references public.config_lookups(id) on delete set null,
  po_qty                numeric check (po_qty is null or po_qty >= 0),
  delivery_date         date,
  earlier_shipment_date date,
  discharge_port_id     uuid references public.ports(id) on delete set null,
  final_destination_id  uuid references public.ports(id) on delete set null,
  pack                  text,
  no_of_cartons         int check (no_of_cartons is null or no_of_cartons >= 0),
  master_carton_name    text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid default auth.uid()
);
create index if not exists sample_style_quantities_style_idx on public.sample_style_quantities(style_id);

create table if not exists public.sample_quantity_assort_lines (
  id          uuid primary key default gen_random_uuid(),
  quantity_id uuid not null references public.sample_style_quantities(id) on delete cascade,
  sno         int not null default 0,
  combo       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create index if not exists sample_quantity_assort_lines_qty_idx on public.sample_quantity_assort_lines(quantity_id);

create table if not exists public.sample_quantity_assort_sizes (
  id           uuid primary key default gen_random_uuid(),
  line_id      uuid not null references public.sample_quantity_assort_lines(id) on delete cascade,
  sno          int not null default 0,
  garment_size text not null,
  qty          numeric check (qty is null or qty >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid default auth.uid()
);
create index if not exists sample_quantity_assort_sizes_line_idx on public.sample_quantity_assort_sizes(line_id);

do $$
declare t text;
begin
  foreach t in array array[
    'sample_style_coordinates', 'sample_style_quantities',
    'sample_quantity_assort_lines', 'sample_quantity_assort_sizes'
  ] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I
                      for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. RLS — a LINE is written by whoever may edit the document
--
-- AGENTS.md "A LINE of an order document is deletable by orders:edit": a
-- document editor saves its grids by deleting and re-inserting the lines, so a
-- line table whose DELETE asks `delete` turns each delete into 0 rows SILENTLY
-- for an edit-only role and the inserts DOUBLE every line. The same holds for
-- INSERT on `create`: an edit-only merchandiser adding a size to an existing
-- enquiry must be able to insert the line. So every line table here — the four
-- new ones and the four sales tables Sample Entry rewrites — takes
--   insert: create OR edit · delete: edit OR delete.
-- The DOCUMENT (opportunities) keeps its own create / delete gates.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'sample_style_coordinates', 'sample_style_quantities',
    'sample_quantity_assort_lines', 'sample_quantity_assort_sizes'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %1$s_read on public.%1$I', t);
    execute format('create policy %1$s_read on public.%1$I for select to authenticated
                      using (public.has_permission(''sales'', ''view''))', t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated
                      using (public.has_permission(''sales'', ''edit''))
                      with check (public.has_permission(''sales'', ''edit''))', t);
  end loop;

  foreach t in array array[
    'sample_style_coordinates', 'sample_style_quantities',
    'sample_quantity_assort_lines', 'sample_quantity_assort_sizes',
    'styles', 'style_sizes', 'style_combos', 'style_combo_sizes'
  ] loop
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

-- `style_sizes` predates the policy sweep above; make sure it reads and
-- updates on the same gates as its siblings (idempotent).
alter table public.style_sizes enable row level security;
drop policy if exists style_sizes_read on public.style_sizes;
create policy style_sizes_read on public.style_sizes for select to authenticated
  using (public.has_permission('sales', 'view'));
drop policy if exists style_sizes_update on public.style_sizes;
create policy style_sizes_update on public.style_sizes for update to authenticated
  using (public.has_permission('sales', 'edit'))
  with check (public.has_permission('sales', 'edit'));

-- ---------------------------------------------------------------------------
-- 5. Numbering — Enquiry No OPP/2627/0186 · Sample No PRD/2627/0222
--
-- The spec's format: prefix / financial-year segment / four digits. Same rule
-- as the IWO number since 0598 (user 2026-09-20): the LOWEST number no
-- existing row of that year holds, so a deleted number comes back and the
-- series has no holes. SECURITY DEFINER so RLS cannot hide a taken number; an
-- advisory lock per (series, year) serialises two saves; the unique index is
-- the backstop. Codes written before today (OPP-0003) are left as they are —
-- they do not match the pattern, so they never collide with the new series.
-- ---------------------------------------------------------------------------
create or replace function public.sample_series_next_no(p_series text, p_fy text)
returns int
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_re text := '^' || p_series || '/' || p_fy || '/([0-9]+)$';
  v_next int;
begin
  if p_series = 'OPP' then
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
  else
    raise exception 'Unknown sample series %', p_series;
  end if;
  return v_next;
end;
$$;

comment on function public.sample_series_next_no(text, text) is
  'Sample Entry numbering (0683): the lowest positive number no existing Enquiry (OPP) or Sample (PRD) '
  'of this financial year holds. SECURITY DEFINER so RLS cannot hide a taken number.';

revoke all on function public.sample_series_next_no(text, text) from public, anon;
grant execute on function public.sample_series_next_no(text, text) to authenticated;

create or replace function public.sample_series_format(p_series text, p_fy text, p_n int)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select p_series || '/' || p_fy || '/' || lpad(p_n::text, 4, '0')
$$;
revoke all on function public.sample_series_format(text, text, int) from public, anon;
grant execute on function public.sample_series_format(text, text, int) to authenticated;

create or replace function public.assign_opportunity_number()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_fy text;
begin
  if new.code is not null and new.code <> '' then
    return new;
  end if;
  v_fy := public.fiscal_year_segment(coalesce(new.received_date, current_date));
  perform pg_advisory_xact_lock(hashtext('sample_series:OPP:' || v_fy));
  new.code := public.sample_series_format('OPP', v_fy, public.sample_series_next_no('OPP', v_fy));
  return new;
end;
$$;
revoke all on function public.assign_opportunity_number() from public, anon;

drop trigger if exists trg_opp_code on public.opportunities;
create trigger trg_opp_code before insert on public.opportunities
  for each row execute function public.assign_opportunity_number();

create or replace function public.assign_sample_number()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_fy text;
begin
  if new.sample_no is not null and new.sample_no <> '' then
    return new;
  end if;
  v_fy := public.fiscal_year_segment(coalesce(new.order_date, current_date));
  perform pg_advisory_xact_lock(hashtext('sample_series:PRD:' || v_fy));
  new.sample_no := public.sample_series_format('PRD', v_fy, public.sample_series_next_no('PRD', v_fy));
  return new;
end;
$$;
revoke all on function public.assign_sample_number() from public, anon;

drop trigger if exists trg_styles_sample_no on public.styles;
create trigger trg_styles_sample_no before insert on public.styles
  for each row execute function public.assign_sample_number();

-- What a new Enquiry / Sample would be numbered today — a PREDICTION shown in
-- the read-only box, not a reservation (the IWO box's rule, 0580).
create or replace function public.peek_sample_number(p_series text, p_on date default null)
returns text
language sql
stable
set search_path = pg_catalog, public
as $$
  select public.sample_series_format(
           p_series,
           public.fiscal_year_segment(coalesce(p_on, current_date)),
           public.sample_series_next_no(p_series, public.fiscal_year_segment(coalesce(p_on, current_date))))
$$;
revoke all on function public.peek_sample_number(text, date) from public, anon;
grant execute on function public.peek_sample_number(text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. save_sample_entry — the whole document in one transaction
--
-- p: { header: {...}, styles: [{ id?, ..., coordinates:[], sizes:[], combos:[{..., sizes:[]}],
--      quantities:[{..., lines:[{..., sizes:[]}]}] }] }
-- Style lines are UPDATED IN PLACE by id (so a Sample No, and every cost sheet
-- or PD request pointing at the line, survives a save); a line missing from the
-- payload is deleted. Each line's child trees are rewritten whole.
-- Returns { id, code }.
-- ---------------------------------------------------------------------------
create or replace function public.save_sample_entry(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  h        jsonb := p -> 'header';
  v_id     uuid := p_id;
  v_code   text;
  v_title  text;
  s        jsonb;
  c        jsonb;
  q        jsonb;
  l        jsonb;
  v_sid    uuid;
  v_cid    uuid;
  v_qid    uuid;
  v_lid    uuid;
  v_keep   uuid[] := '{}';
begin
  if nullif(h ->> 'customer_id', '') is null then
    raise exception 'Choose the Customer before saving the sample entry.' using errcode = '23502';
  end if;

  select name into v_title from public.customers where id = (h ->> 'customer_id')::uuid;
  if v_title is null then
    raise exception 'That customer no longer exists.' using errcode = '23503';
  end if;

  if v_id is null then
    insert into public.opportunities (
      title, customer_id, stage, received_date, enquiry_against, enquiry_action,
      country_id, season, season_year, customer_reference, agent_id,
      receipt_mode, delivery_to, delivery_mode, is_draft
    ) values (
      v_title,
      (h ->> 'customer_id')::uuid,
      'enquiry',
      nullif(h ->> 'received_date', '')::date,
      nullif(h ->> 'enquiry_against', ''),
      nullif(h ->> 'enquiry_action', ''),
      nullif(h ->> 'country_id', '')::uuid,
      nullif(h ->> 'season', ''),
      nullif(h ->> 'season_year', '')::int,
      nullif(h ->> 'customer_reference', ''),
      nullif(h ->> 'agent_id', '')::uuid,
      nullif(h ->> 'receipt_mode', ''),
      nullif(h ->> 'delivery_to', ''),
      nullif(h ->> 'delivery_mode', ''),
      coalesce((h ->> 'is_draft')::boolean, false)
    )
    returning id, code into v_id, v_code;
  else
    update public.opportunities set
      title              = v_title,
      customer_id        = (h ->> 'customer_id')::uuid,
      received_date      = nullif(h ->> 'received_date', '')::date,
      enquiry_against    = nullif(h ->> 'enquiry_against', ''),
      enquiry_action     = nullif(h ->> 'enquiry_action', ''),
      country_id         = nullif(h ->> 'country_id', '')::uuid,
      season             = nullif(h ->> 'season', ''),
      season_year        = nullif(h ->> 'season_year', '')::int,
      customer_reference = nullif(h ->> 'customer_reference', ''),
      agent_id           = nullif(h ->> 'agent_id', '')::uuid,
      receipt_mode       = nullif(h ->> 'receipt_mode', ''),
      delivery_to        = nullif(h ->> 'delivery_to', ''),
      delivery_mode      = nullif(h ->> 'delivery_mode', ''),
      is_draft           = coalesce((h ->> 'is_draft')::boolean, false)
    where id = v_id
    returning code into v_code;
    -- RLS hides a row the caller may not edit: zero rows is a refusal, not a
    -- success with nothing to do.
    if not found then
      raise exception 'This sample entry no longer exists, or you do not have permission to edit it.'
        using errcode = '42501';
    end if;
  end if;

  -- Which existing lines survive this save.
  for s in select * from jsonb_array_elements(coalesce(p -> 'styles', '[]'::jsonb)) loop
    if nullif(s ->> 'id', '') is not null then
      v_keep := v_keep || (s ->> 'id')::uuid;
    end if;
  end loop;
  delete from public.styles where opportunity_id = v_id and not (id = any (v_keep));

  for s in select * from jsonb_array_elements(coalesce(p -> 'styles', '[]'::jsonb)) loop
    v_sid := nullif(s ->> 'id', '')::uuid;
    if v_sid is not null then
      update public.styles set
        sno = (s ->> 'sno')::int,
        name = s ->> 'name',
        article_no = nullif(s ->> 'article_no', ''),
        description = nullif(s ->> 'description', ''),
        unit_kind = nullif(s ->> 'unit_kind', ''),
        sample_qty = nullif(s ->> 'sample_qty', '')::numeric,
        delivery_date = nullif(s ->> 'delivery_date', '')::date,
        merchandiser_id = nullif(s ->> 'merchandiser_id', '')::uuid,
        order_date = nullif(s ->> 'order_date', '')::date,
        fabric_structure_id = nullif(s ->> 'fabric_structure_id', '')::uuid,
        fabric_id = nullif(s ->> 'fabric_id', '')::uuid,
        gsm = nullif(s ->> 'gsm', '')::numeric,
        tech_pack = nullif(s ->> 'tech_pack', ''),
        customer_reference = nullif(s ->> 'customer_reference', ''),
        receipt_mode = nullif(s ->> 'receipt_mode', ''),
        receipt_date = nullif(s ->> 'receipt_date', '')::date,
        delivery_to = nullif(s ->> 'delivery_to', ''),
        agent_id = nullif(s ->> 'agent_id', '')::uuid,
        delivery_mode = nullif(s ->> 'delivery_mode', ''),
        delivery_through = nullif(s ->> 'delivery_through', ''),
        accessories_reqd = coalesce((s ->> 'accessories_reqd')::boolean, false),
        billable = coalesce((s ->> 'billable')::boolean, false),
        ship_type_id = nullif(s ->> 'ship_type_id', '')::uuid,
        ship_mode = nullif(s ->> 'ship_mode', ''),
        currency_code = nullif(s ->> 'currency_code', ''),
        price = nullif(s ->> 'price', '')::numeric
      where id = v_sid and opportunity_id = v_id;
      if not found then
        raise exception 'A style line on this entry was removed by someone else. Reopen the entry and try again.'
          using errcode = '40001';
      end if;
    else
      insert into public.styles (
        opportunity_id, sno, name, article_no, description, unit_kind, sample_qty, delivery_date,
        merchandiser_id, order_date, fabric_structure_id, fabric_id, gsm, tech_pack,
        customer_reference, receipt_mode, receipt_date, delivery_to, agent_id, delivery_mode,
        delivery_through, accessories_reqd, billable, ship_type_id, ship_mode, currency_code, price
      ) values (
        v_id, (s ->> 'sno')::int, s ->> 'name', nullif(s ->> 'article_no', ''),
        nullif(s ->> 'description', ''), nullif(s ->> 'unit_kind', ''),
        nullif(s ->> 'sample_qty', '')::numeric, nullif(s ->> 'delivery_date', '')::date,
        nullif(s ->> 'merchandiser_id', '')::uuid, nullif(s ->> 'order_date', '')::date,
        nullif(s ->> 'fabric_structure_id', '')::uuid, nullif(s ->> 'fabric_id', '')::uuid,
        nullif(s ->> 'gsm', '')::numeric, nullif(s ->> 'tech_pack', ''),
        nullif(s ->> 'customer_reference', ''), nullif(s ->> 'receipt_mode', ''),
        nullif(s ->> 'receipt_date', '')::date, nullif(s ->> 'delivery_to', ''),
        nullif(s ->> 'agent_id', '')::uuid, nullif(s ->> 'delivery_mode', ''),
        nullif(s ->> 'delivery_through', ''),
        coalesce((s ->> 'accessories_reqd')::boolean, false),
        coalesce((s ->> 'billable')::boolean, false),
        nullif(s ->> 'ship_type_id', '')::uuid, nullif(s ->> 'ship_mode', ''),
        nullif(s ->> 'currency_code', ''), nullif(s ->> 'price', '')::numeric
      )
      returning id into v_sid;
    end if;

    -- Child trees, rewritten whole.
    delete from public.sample_style_coordinates where style_id = v_sid;
    delete from public.style_sizes where style_id = v_sid;
    delete from public.style_combos where style_id = v_sid;
    delete from public.sample_style_quantities where style_id = v_sid;

    insert into public.sample_style_coordinates (style_id, sno, coordinate_id)
    select v_sid, (x ->> 'sno')::int, (x ->> 'coordinate_id')::uuid
      from jsonb_array_elements(coalesce(s -> 'coordinates', '[]'::jsonb)) x
     where nullif(x ->> 'coordinate_id', '') is not null;

    insert into public.style_sizes (style_id, sno, garment_size)
    select v_sid, (x ->> 'sno')::int, x ->> 'garment_size'
      from jsonb_array_elements(coalesce(s -> 'sizes', '[]'::jsonb)) x
     where nullif(x ->> 'garment_size', '') is not null;

    for c in select * from jsonb_array_elements(coalesce(s -> 'combos', '[]'::jsonb)) loop
      insert into public.style_combos (style_id, sno, combo, order_qty, extra_qty)
      values (v_sid, (c ->> 'sno')::int, c ->> 'combo',
              nullif(c ->> 'order_qty', '')::numeric, nullif(c ->> 'extra_qty', '')::numeric)
      returning id into v_cid;
      insert into public.style_combo_sizes (style_combo_id, sno, garment_size, order_qty)
      select v_cid, (x ->> 'sno')::int, x ->> 'garment_size', nullif(x ->> 'order_qty', '')::numeric
        from jsonb_array_elements(coalesce(c -> 'sizes', '[]'::jsonb)) x
       where nullif(x ->> 'garment_size', '') is not null;
    end loop;

    for q in select * from jsonb_array_elements(coalesce(s -> 'quantities', '[]'::jsonb)) loop
      insert into public.sample_style_quantities (
        style_id, sno, country_id, ref_no, consignee_id, assortment_type_id, po_qty,
        delivery_date, earlier_shipment_date, discharge_port_id, final_destination_id,
        pack, no_of_cartons, master_carton_name
      ) values (
        v_sid, (q ->> 'sno')::int, nullif(q ->> 'country_id', '')::uuid, nullif(q ->> 'ref_no', ''),
        nullif(q ->> 'consignee_id', '')::uuid, nullif(q ->> 'assortment_type_id', '')::uuid,
        nullif(q ->> 'po_qty', '')::numeric, nullif(q ->> 'delivery_date', '')::date,
        nullif(q ->> 'earlier_shipment_date', '')::date, nullif(q ->> 'discharge_port_id', '')::uuid,
        nullif(q ->> 'final_destination_id', '')::uuid, nullif(q ->> 'pack', ''),
        nullif(q ->> 'no_of_cartons', '')::int, nullif(q ->> 'master_carton_name', '')
      )
      returning id into v_qid;
      for l in select * from jsonb_array_elements(coalesce(q -> 'lines', '[]'::jsonb)) loop
        insert into public.sample_quantity_assort_lines (quantity_id, sno, combo)
        values (v_qid, (l ->> 'sno')::int, nullif(l ->> 'combo', ''))
        returning id into v_lid;
        insert into public.sample_quantity_assort_sizes (line_id, sno, garment_size, qty)
        select v_lid, (x ->> 'sno')::int, x ->> 'garment_size', nullif(x ->> 'qty', '')::numeric
          from jsonb_array_elements(coalesce(l -> 'sizes', '[]'::jsonb)) x
         where nullif(x ->> 'garment_size', '') is not null;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object('id', v_id, 'code', v_code);
end;
$$;

comment on function public.save_sample_entry(uuid, jsonb) is
  'Sample Entry (0683): writes the enquiry header, its style lines (updated in place by id) and every '
  'child tree in one transaction. SECURITY INVOKER — every write passes RLS.';

revoke all on function public.save_sample_entry(uuid, jsonb) from public, anon;
grant execute on function public.save_sample_entry(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Self-checks — a migration that applies is not one that worked.
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.sample_series_next_no(text,text)', 'public.sample_series_format(text,text,integer)',
    'public.peek_sample_number(text,date)', 'public.save_sample_entry(uuid,jsonb)',
    'public.assign_opportunity_number()', 'public.assign_sample_number()'
  ] loop
    if has_function_privilege('anon', f, 'EXECUTE') then
      raise exception '0683: % is executable by anon', f;
    end if;
  end loop;
  if public.sample_series_format('OPP', '2627', 186) <> 'OPP/2627/0186' then
    raise exception '0683: Enquiry No format is wrong';
  end if;
end $$;
