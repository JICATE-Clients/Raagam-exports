-- ============================================================================
-- Raagam ERP — 0579 Packing List Advice, rebuilt to the spec.
--
-- doc/order/packing list.md (client, 2026-09-18, legacy screenshot 2942). The
-- advice is the bridge between a finished order and export logistics: ONE
-- order (RE No), ONE destination, and a grid of carton ranges — which style and
-- colour went into cartons N..M, packed solid or by ratio, how many pieces each.
--
-- LIVE STATE WHEN WRITTEN: 0 packing_advices, 0 packing_advice_lines. Nothing to
-- migrate, which is the only reason columns are DROPPED here rather than left
-- to rot beside their replacements — the same call 0578 made for the IWO.
--
-- ## 1. THE ORDER MOVES BACK TO THE HEADER
--
-- 0130 moved the order onto each LINE (`sc_no_id`), copying a legacy grid where
-- one advice could mix orders. The spec puts RE No on the header and fetches the
-- destination, styles and colours FROM that order, which a per-line order makes
-- impossible to offer: there is no single order to read them from. So
-- `sales_order_id` (0033's own column) is required again, and the per-line
-- order, PO No, country, ref no, customer order no, unit, measurement and
-- multiple-pack columns go.
--
-- Consignee, Warehouse, Carton SlNo.By and Reference go from the header for the
-- same reason: the spec's header is No / Date / Customer / RE No / Destination
-- and two totals, and nothing else.
--
-- ## 2. CUSTOMER IS `customers`, NOT `buyers`
--
-- 0130 pointed customer_id at `buyers`, the scaffold spine. The garment order
-- names its party from `customers` (the real master), and the advice's customer
-- is the ORDER's customer — so the FK follows the order.
--
-- ## 3. THE TOTALS ARE NOT STORED
--
-- The spec's DDL stores total_cartons / total_packed_pcs on the header. They
-- are sums over the lines, and a stored sum is a second answer that the next
-- line edit can make wrong (the rule `pcs_per_pack` follows on the Assort
-- overlay). `ctns_total` / `qty_total` are DROPPED; the list and the screen add
-- the lines up. The per-LINE figures ARE generated columns, as the spec asks —
-- a generated column cannot disagree with its inputs.
--
-- ## 4. CARTON NUMBERS ARE INTEGERS, AND NO CARTON IS COUNTED TWICE
--
-- 0130 stored Ctn From / Ctn To as TEXT, so "10" < "9" and nothing could be
-- computed from them. Now INT, From >= 1, To >= From, and an EXCLUDE
-- constraint refuses two lines of one advice claiming the same carton — a
-- carton number is one physical box. The screen names the clash first; this is
-- what holds when something else writes.
--
-- ## 5. THE NUMBER IS U2/PLA/2627/0012
--
-- The IWO's shape (0559 + 0578), unit first: a per-(location, fiscal-year)
-- counter, fiscal year from the DOCUMENT's date. The unit is the session's
-- (`resolveWriteLocation`), stamped by the action before this trigger runs.
--
-- ## 6. LINE POLICIES HANG OFF THE PARENT
--
-- 0485 scoped the line table through `has_order_access(sc_no_id)`, the column
-- this migration drops. A line now inherits its advice's visibility — the
-- EXISTS runs under the caller's RLS, so a line is visible exactly when its
-- advice is.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Line policies first — they name `sc_no_id`, which step 3 drops.
-- ---------------------------------------------------------------------------
drop policy if exists packing_advice_lines_read   on public.packing_advice_lines;
drop policy if exists packing_advice_lines_insert on public.packing_advice_lines;
drop policy if exists packing_advice_lines_update on public.packing_advice_lines;
drop policy if exists packing_advice_lines_delete on public.packing_advice_lines;


-- ---------------------------------------------------------------------------
-- 2. Header
-- ---------------------------------------------------------------------------
alter table public.packing_advices
  drop column if exists pack_method,
  drop column if exists reference,
  drop column if exists carton_slno_by,
  drop column if exists consignee_id,
  drop column if exists warehouse_id,
  drop column if exists warehouse_address,
  drop column if exists ctns_total,
  drop column if exists qty_total,
  drop constraint if exists packing_advices_customer_id_fkey,
  add column if not exists country_id  uuid references public.countries(id),
  add column if not exists location_id uuid references public.locations(id);

alter table public.packing_advices
  alter column sales_order_id set not null,
  alter column customer_id    set not null,
  alter column country_id     set not null,
  alter column location_id    set not null,
  add constraint packing_advices_customer_id_fkey
    foreign key (customer_id) references public.customers(id);

create index if not exists idx_pla_country  on public.packing_advices(country_id);
create index if not exists idx_pla_location on public.packing_advices(location_id);

comment on column public.packing_advices.sales_order_id is
  'Order Reference (RE No). Required since 0579: destination, styles and colours are all read from this order.';
comment on column public.packing_advices.customer_id is
  'The order''s customer (customers, the real master — 0579 moved it off buyers).';
comment on column public.packing_advices.country_id is
  'Destination for this packing batch — one of the countries on the order''s Quantities tab (0579).';
comment on column public.packing_advices.location_id is
  'The unit that raised the advice; its code leads the PLA number (0579).';


-- ---------------------------------------------------------------------------
-- 3. Lines
-- ---------------------------------------------------------------------------
alter table public.packing_advice_lines
  drop column if exists description,
  drop column if exists pcs_per_carton,
  drop column if exists carton_count,
  drop column if exists ctn_from,
  drop column if exists ctn_to,
  drop column if exists ctns,
  drop column if exists sc_no_id,
  drop column if exists po_no,
  drop column if exists country_id,
  drop column if exists ref_no,
  drop column if exists assort_type,
  drop column if exists customer_order_no,
  drop column if exists multiple_pack,
  drop column if exists qty_per_ctn,
  drop column if exists total_qty,
  drop column if exists unit_id,
  drop column if exists measurement;

alter table public.packing_advice_lines
  add column style_ref_no    text not null,
  add column combo           text not null,
  add column from_carton_no  int  not null,
  add column to_carton_no    int  not null,
  add column total_cartons   int  generated always as (to_carton_no - from_carton_no + 1) stored,
  add column assortment_type text not null,
  add column pcs_per_carton  int  not null,
  add column line_total_pcs  int  generated always as ((to_carton_no - from_carton_no + 1) * pcs_per_carton) stored,
  add constraint pal_carton_from_positive check (from_carton_no >= 1),
  add constraint pal_carton_range_order   check (to_carton_no >= from_carton_no),
  add constraint pal_pcs_positive         check (pcs_per_carton > 0),
  add constraint pal_assortment_type      check (assortment_type in ('solid_size', 'ratio_mixed')),
  add constraint pal_net_within_gross     check (net_weight is null or gross_weight is null or net_weight <= gross_weight),
  add constraint pal_dimensions_positive  check (
    (length_cm is null or length_cm > 0) and
    (width_cm  is null or width_cm  > 0) and
    (height_cm is null or height_cm > 0)
  );

-- One carton number, one line. Needs btree_gist for the uuid `=`.
alter table public.packing_advice_lines
  add constraint pal_no_carton_overlap exclude using gist (
    advice_id with =,
    int4range(from_carton_no, to_carton_no, '[]') with &&
  );

comment on column public.packing_advice_lines.style_ref_no is
  'Style BY VALUE, as every order child names it — one of the order''s styles (0579).';
comment on column public.packing_advice_lines.combo is
  'Colour / shade BY VALUE — one of that style''s combos on the order (0579).';
comment on column public.packing_advice_lines.gross_weight is
  'Gross weight of ONE carton, KG. Blank = not weighed yet, never 0.';
comment on column public.packing_advice_lines.net_weight is
  'Net weight of ONE carton, KG. Blank = not weighed yet, never 0.';


-- ---------------------------------------------------------------------------
-- 4. Line policies, re-keyed onto the parent advice
-- ---------------------------------------------------------------------------
create policy packing_advice_lines_read on public.packing_advice_lines
  for select to authenticated using (
    public.has_permission('orders', 'view')
    and exists (select 1 from public.packing_advices p where p.id = advice_id)
  );
create policy packing_advice_lines_insert on public.packing_advice_lines
  for insert to authenticated with check (
    public.has_permission('orders', 'create')
    and exists (select 1 from public.packing_advices p where p.id = advice_id)
  );
create policy packing_advice_lines_update on public.packing_advice_lines
  for update to authenticated
  using (
    public.has_permission('orders', 'edit')
    and exists (select 1 from public.packing_advices p where p.id = advice_id)
  )
  with check (
    public.has_permission('orders', 'edit')
    and exists (select 1 from public.packing_advices p where p.id = advice_id)
  );
-- Edit, not delete: the save rewrites the grid wholesale, so an operator who
-- may EDIT an advice must be able to replace its lines.
create policy packing_advice_lines_delete on public.packing_advice_lines
  for delete to authenticated using (
    public.has_permission('orders', 'edit')
    and exists (select 1 from public.packing_advices p where p.id = advice_id)
  );


-- ---------------------------------------------------------------------------
-- 5. The number — U2/PLA/2627/0012
-- ---------------------------------------------------------------------------
create table if not exists public.pla_no_counters (
  location_id uuid not null references public.locations(id),
  fy          text not null,
  last_no     int  not null default 0,
  primary key (location_id, fy)
);

alter table public.pla_no_counters enable row level security;

drop policy if exists pla_no_counters_read on public.pla_no_counters;
create policy pla_no_counters_read on public.pla_no_counters
  for select to authenticated using (public.has_permission('orders', 'view'));

drop policy if exists pla_no_counters_insert on public.pla_no_counters;
create policy pla_no_counters_insert on public.pla_no_counters
  for insert to authenticated with check (public.has_permission('orders', 'create'));

drop policy if exists pla_no_counters_update on public.pla_no_counters;
create policy pla_no_counters_update on public.pla_no_counters
  for update to authenticated
  using (public.has_permission('orders', 'create'))
  with check (public.has_permission('orders', 'create'));

comment on table public.pla_no_counters is
  'Running Packing List Advice number per (location, fiscal year) — iwo_no_counters'' shape (0559). '
  'No DELETE policy: dropping a row restarts that unit at 0001 and mints duplicates.';

create or replace function public.pla_no_format(
  p_location_code text,
  p_fy            text,
  p_next          int
)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select p_location_code || '/PLA/' || p_fy || '/'
      || lpad(p_next::text, greatest(4, length(p_next::text)), '0');
$$;

comment on function public.pla_no_format(text, text, int) is
  'Composes a Packing List Advice number: U2 + 2627 + 12 -> U2/PLA/2627/0012 '
  '(doc/order/packing list.md). The 4-digit pad is a FLOOR, not a width.';

revoke all on function public.pla_no_format(text, text, int) from public, anon;
grant execute on function public.pla_no_format(text, text, int) to authenticated;

create or replace function public.assign_pla_number()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_loc  text;
  v_fy   text;
  v_next int;
begin
  -- An explicit code is honoured and does not advance the counter (imports).
  if new.code is not null and new.code <> '' then
    return new;
  end if;

  select l.code into v_loc from public.locations l where l.id = new.location_id;
  if v_loc is null or v_loc = '' then
    raise exception
      'A Packing List Advice needs a unit with a code before it can be numbered.'
      using errcode = '23502';
  end if;

  v_fy := public.fiscal_year_segment(coalesce(new.advice_date, current_date));

  insert into public.pla_no_counters as c (location_id, fy, last_no)
  values (new.location_id, v_fy, 1)
  on conflict (location_id, fy) do update set last_no = c.last_no + 1
  returning c.last_no into v_next;

  new.code := public.pla_no_format(v_loc, v_fy, v_next);
  return new;
end;
$$;

revoke all on function public.assign_pla_number() from public, anon;
grant execute on function public.assign_pla_number() to authenticated;

-- Replaces 0033's assign_code('PLA', seq_packing_advice). The sequence stays,
-- as 0559 left seq_internal_work_order: a rollback is a one-line trigger swap.
drop trigger if exists trg_pla_code on public.packing_advices;
create trigger trg_pla_code before insert on public.packing_advices
  for each row execute function public.assign_pla_number();


-- ---------------------------------------------------------------------------
-- 6. Self-verification — `success` means the SQL ran, not that it worked.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
  v_n  int;
begin
  foreach v_fn in array array[
    'public.pla_no_format(text, text, int)',
    'public.assign_pla_number()'
  ] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception '0579: % is executable by anon', v_fn;
    end if;
  end loop;

  if public.pla_no_format('U2', '2627', 12) <> 'U2/PLA/2627/0012' then
    raise exception '0579: format(U2,2627,12) = %', public.pla_no_format('U2', '2627', 12);
  end if;
  if public.pla_no_format('U2', '2627', 12345) <> 'U2/PLA/2627/12345' then
    raise exception '0579: the pad truncated a 5-digit serial';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.packing_advices'::regclass
      and tgname  = 'trg_pla_code'
      and tgfoid  = 'public.assign_pla_number()'::regprocedure
  ) then
    raise exception '0579: packing_advices is not on the PLA number trigger';
  end if;

  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'packing_advice_lines';
  if v_n <> 4 then
    raise exception '0579: packing_advice_lines has % policies, expected 4', v_n;
  end if;

  -- Existence only; the arithmetic and the overlap refusal are proved by a
  -- rolled-back insert probe run after apply (a real advice needs a real order).
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.packing_advice_lines'::regclass
      and attname in ('total_cartons', 'line_total_pcs')
      and attgenerated = 's'
    having count(*) = 2
  ) then
    raise exception '0579: total_cartons / line_total_pcs are not generated columns';
  end if;
end $$;
