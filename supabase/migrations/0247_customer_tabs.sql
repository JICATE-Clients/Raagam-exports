-- ============================================================================
-- Raagam ERP — 0247 Master Data ▸ Associates ▸ Customer — Phase 2 (the 4 tabs)
-- Adds the remaining legacy Customer tabs to the 0240 base:
--   • Agents               → customer_agents (Agent Type + Agent, both pickers)
--   • Customer Supplied Items → customer_supplied_items (Sewing / Packaging cats)
--   • Customer Nominated Vendors → customer_nominated_vendors (Nominated / Recommended)
--   • CustomerGeneral      → scalar columns on `customers` + customer_markings grid
--
-- Reuse map (see raagam-masters-picker-wiring): Category → config_lookups
-- 'material_category'; Vendor → public.vendors; Currency → currencies(code);
-- Ship Type → config_lookups 'ship_type'; Receivable Terms → receivable_terms;
-- Ports → ports; Final Destination → destinations; Pref. Courier → couriers.
-- New config-list kinds: 'agent_type', 'agent', 'packing_list_format',
-- 'commercial_invoice_format' (Add/Modify via LookupDialogPicker).
-- ============================================================================

-- 1) Widen the config_lookups kind CHECK (re-add every kind — 0244 shape — plus 4).
alter table public.config_lookups drop constraint if exists config_lookups_kind_check;
alter table public.config_lookups add constraint config_lookups_kind_check
  check (kind in (
    'attribute','levy','material_category','material_attribute','yarn_count',
    'yarn_purity','composition','process','component','gauge','knitting_dia',
    'out_doc_term','commodity','item_class','hsn_code','city','state','department',
    'designation','internal_department','ship_type','payment_term','employee_category',
    'team','account_schedule','vendor_group',
    'agent_type','agent','packing_list_format','commercial_invoice_format'
  ));

-- 2) CustomerGeneral scalar fields on the header table.
alter table public.customers
  add column if not exists currency_1                  text references public.currencies(code) on delete set null,
  add column if not exists currency_2                  text references public.currencies(code) on delete set null,
  add column if not exists currency_3                  text references public.currencies(code) on delete set null,
  add column if not exists ship_mode                   text,
  add column if not exists ship_type_id                uuid references public.config_lookups(id) on delete set null,
  add column if not exists pay_mode                    text,
  add column if not exists receivable_term_id          uuid references public.receivable_terms(id) on delete set null,
  add column if not exists port_of_loading_id          uuid references public.ports(id) on delete set null,
  add column if not exists port_of_discharge_id        uuid references public.ports(id) on delete set null,
  add column if not exists final_destination_id        uuid references public.destinations(id) on delete set null,
  add column if not exists pref_courier_id             uuid references public.couriers(id) on delete set null,
  add column if not exists packing_list_format_id      uuid references public.config_lookups(id) on delete set null,
  add column if not exists commercial_invoice_format_id uuid references public.config_lookups(id) on delete set null,
  add column if not exists color_spec_applicable       boolean not null default false,
  add column if not exists tcs_applicable              boolean not null default false,
  add column if not exists gst_no                      text;

-- 3) Agents grid.
create table if not exists public.customer_agents (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers(id) on delete cascade,
  sno           integer not null default 0,
  agent_type_id uuid references public.config_lookups(id) on delete set null,
  agent_id      uuid references public.config_lookups(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_customer_agents_updated before update on public.customer_agents
  for each row execute function public.set_updated_at();
create index if not exists idx_customer_agents_customer on public.customer_agents(customer_id);

-- 4) Customer Supplied Items — one table, section = 'sewing' | 'packing'.
create table if not exists public.customer_supplied_items (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  section     text not null check (section in ('sewing','packing')),
  sno         integer not null default 0,
  category_id uuid references public.config_lookups(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_customer_supplied_items_updated before update on public.customer_supplied_items
  for each row execute function public.set_updated_at();
create index if not exists idx_customer_supplied_items_customer on public.customer_supplied_items(customer_id);

-- 5) Customer Nominated Vendors — one table, list_kind = 'nominated' | 'recommended'.
create table if not exists public.customer_nominated_vendors (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  list_kind   text not null check (list_kind in ('nominated','recommended')),
  sno         integer not null default 0,
  vendor_id   uuid references public.vendors(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_customer_nominated_vendors_updated before update on public.customer_nominated_vendors
  for each row execute function public.set_updated_at();
create index if not exists idx_customer_nominated_vendors_customer on public.customer_nominated_vendors(customer_id);

-- 6) CustomerGeneral "Marking" grid.
create table if not exists public.customer_markings (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  sno         integer not null default 0,
  marking     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_customer_markings_updated before update on public.customer_markings
  for each row execute function public.set_updated_at();
create index if not exists idx_customer_markings_customer on public.customer_markings(customer_id);

-- 7) RLS (read open like other masters; write gated by 'masters').
do $$
declare t text;
begin
  foreach t in array array[
    'customer_agents','customer_supplied_items','customer_nominated_vendors','customer_markings'
  ] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (true);
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
