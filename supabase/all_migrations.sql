-- ============================================================================
-- Raagam ERP — consolidated schema (migrations 0001–0008)
-- Paste into Supabase Dashboard → SQL Editor → Run (runs as superuser).
-- Idempotent: safe to re-run. Generated from supabase/migrations/.
-- ============================================================================


-- >>>>>>>>>>>>>>>>>>>> supabase/migrations/0001_foundation.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- Raagam ERP — 0001 Foundation
-- Locations (GST entities), profiles, admin-configurable RBAC, audit log.
-- ============================================================================

-- ---------- shared helpers ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- locations (HO + Unit 2 = separate GST entities) ----------
create table if not exists public.locations (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  gst_number  text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_locations_updated before update on public.locations
  for each row execute function public.set_updated_at();

-- ---------- profiles (1:1 with auth.users) ----------
create table if not exists public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  email               text,
  phone               text,
  full_name           text,
  employee_code       text unique,
  default_location_id uuid references public.locations(id),
  is_super_admin      boolean not null default false,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- auto-create a profile when an auth user is created
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, phone, full_name)
  values (new.id, new.email, new.phone, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- RBAC: roles, permission catalog, links ----------
create table if not exists public.roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  is_system   boolean not null default false,  -- system roles cannot be deleted
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_roles_updated before update on public.roles
  for each row execute function public.set_updated_at();

-- catalog of every (module, action) the app understands
create table if not exists public.permissions (
  id          uuid primary key default gen_random_uuid(),
  module      text not null,
  action      text not null,    -- view | create | edit | delete | approve | export
  description text,
  unique (module, action)
);

create table if not exists public.role_permissions (
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- a user holds a role, optionally scoped to one location (null = all locations)
create table if not exists public.user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role_id     uuid not null references public.roles(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (user_id, role_id, location_id)
);
create index if not exists idx_user_roles_user on public.user_roles(user_id);

-- ---------- audit log ----------
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id),
  action      text not null,           -- e.g. amendment.approved, role.updated
  entity_type text,                    -- e.g. sales_order
  entity_id   uuid,
  location_id uuid references public.locations(id),
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_entity on public.audit_log(entity_type, entity_id);
create index if not exists idx_audit_created on public.audit_log(created_at desc);

-- ============================================================================
-- Permission helper functions (SECURITY DEFINER → avoid RLS recursion)
-- ============================================================================
create or replace function public.is_super_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select is_super_admin from public.profiles where id = uid), false);
$$;

create or replace function public.has_permission(
  p_module text, p_action text, uid uuid default auth.uid()
) returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_super_admin(uid) or exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where ur.user_id = uid and p.module = p_module and p.action = p_action
  );
$$;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.locations        enable row level security;
alter table public.profiles         enable row level security;
alter table public.roles            enable row level security;
alter table public.permissions      enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles       enable row level security;
alter table public.audit_log        enable row level security;

-- locations: everyone authenticated can read; system_admin manages
create policy locations_read on public.locations
  for select to authenticated using (true);
create policy locations_write on public.locations
  for all to authenticated
  using (public.has_permission('system_admin', 'edit'))
  with check (public.has_permission('system_admin', 'edit'));

-- profiles: read own; system_admin reads/writes all
create policy profiles_read_own on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.has_permission('system_admin', 'view'));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.has_permission('system_admin', 'edit'))
  with check (id = auth.uid() or public.has_permission('system_admin', 'edit'));
create policy profiles_admin_insert on public.profiles
  for insert to authenticated
  with check (public.has_permission('system_admin', 'create'));

-- roles / permissions / links / user_roles: system_admin only (lookups for
-- permission checks go through SECURITY DEFINER functions, so RLS here is safe)
create policy roles_admin_all on public.roles
  for all to authenticated
  using (public.has_permission('system_admin', 'view'))
  with check (public.has_permission('system_admin', 'edit'));
create policy permissions_admin_read on public.permissions
  for select to authenticated using (public.has_permission('system_admin', 'view'));
create policy role_permissions_admin_all on public.role_permissions
  for all to authenticated
  using (public.has_permission('system_admin', 'view'))
  with check (public.has_permission('system_admin', 'edit'));
create policy user_roles_admin_all on public.user_roles
  for all to authenticated
  using (public.has_permission('system_admin', 'view') or user_id = auth.uid())
  with check (public.has_permission('system_admin', 'edit'));

-- audit_log: any authenticated user may append; system_admin may read
create policy audit_insert on public.audit_log
  for insert to authenticated with check (true);
create policy audit_read on public.audit_log
  for select to authenticated
  using (public.has_permission('system_admin', 'view'));

-- >>>>>>>>>>>>>>>>>>>> supabase/migrations/0002_foundation_seed.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- Raagam ERP — 0002 Foundation seed
-- Locations, full permission catalog, system roles + grants.
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---------- locations (two GST entities) ----------
insert into public.locations (code, name) values
  ('HO', 'Head Office'),
  ('U2', 'Unit 2')
on conflict (code) do nothing;

-- ---------- permission catalog (module x action) ----------
-- All modules are listed (incl. future ones) so the admin RBAC matrix is
-- complete; only sales/orders/masters/system_admin/dashboard are wired this pass.
insert into public.permissions (module, action, description)
select m.module, a.action,
       initcap(a.action) || ' ' || replace(m.module, '_', ' ')
from unnest(array[
  'dashboard','system_admin','masters','sales','orders',
  'planning','materials_purchase','stores','production','process_planning',
  'hr_payroll','logistics','finance','integration'
]) as m(module)
cross join unnest(array[
  'view','create','edit','delete','approve','export'
]) as a(action)
on conflict (module, action) do nothing;

-- ---------- system roles ----------
insert into public.roles (name, description, is_system) values
  ('Administrator',     'Full system access',                              true),
  ('Managing Director', 'Approves amendments, POs, budgets, payroll',      true),
  ('Manager',           'Creates and approves sales & orders',             false),
  ('Merchandiser',      'Owns opportunities and orders end to end',        false)
on conflict (name) do nothing;

-- ---------- grants ----------
-- Administrator: everything
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r cross join public.permissions p
where r.name = 'Administrator'
on conflict do nothing;

-- Managing Director: view + approve + export across all modules
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r join public.permissions p
  on p.action in ('view', 'approve', 'export')
where r.name = 'Managing Director'
on conflict do nothing;

-- Manager: full sales/orders + approve, plus view dashboard/masters
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r join public.permissions p on (
     (p.module in ('sales', 'orders') and p.action in ('view','create','edit','approve','export'))
  or (p.module in ('dashboard', 'masters') and p.action = 'view')
)
where r.name = 'Manager'
on conflict do nothing;

-- Merchandiser: create/edit sales & orders, view dashboard/masters
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r join public.permissions p on (
     (p.module in ('sales', 'orders') and p.action in ('view','create','edit'))
  or (p.module in ('dashboard', 'masters') and p.action = 'view')
)
where r.name = 'Merchandiser'
on conflict do nothing;

-- >>>>>>>>>>>>>>>>>>>> supabase/migrations/0003_auth_rpc.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- Raagam ERP — 0003 Auth RPCs
-- Lets the signed-in user read their OWN effective permissions/roles even though
-- the underlying link tables are system_admin-only under RLS (SECURITY DEFINER).
-- ============================================================================

create or replace function public.my_permissions()
returns table(module text, action text)
language sql stable security definer set search_path = '' as $$
  select distinct p.module, p.action
  from public.user_roles ur
  join public.role_permissions rp on rp.role_id = ur.role_id
  join public.permissions p on p.id = rp.permission_id
  where ur.user_id = auth.uid();
$$;

create or replace function public.my_roles()
returns table(id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select distinct r.id, r.name
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.user_id = auth.uid();
$$;

-- >>>>>>>>>>>>>>>>>>>> supabase/migrations/0004_masters.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- Raagam ERP — 0004 Master data
-- Currencies, UOMs, buyers, items. Minimal set for the Sales→Order slice.
-- ============================================================================

create table if not exists public.currencies (
  code   text primary key,          -- ISO: GBP, EUR, INR, USD
  name   text not null,
  symbol text
);

create table if not exists public.uoms (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,   -- nos, mtr, kg, gross, yard ...
  name       text not null,
  is_active  boolean not null default true
);

create table if not exists public.buyers (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  country       text,
  currency_code text references public.currencies(code),
  contact_email text,
  contact_phone text,
  address       text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_buyers_updated before update on public.buyers
  for each row execute function public.set_updated_at();

create table if not exists public.items (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  category   text,                   -- yarn, fabric, trim, packing ...
  uom_id     uuid references public.uoms(id),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_items_updated before update on public.items
  for each row execute function public.set_updated_at();

-- ---------- RLS ----------
alter table public.currencies enable row level security;
alter table public.uoms       enable row level security;
alter table public.buyers     enable row level security;
alter table public.items      enable row level security;

-- currencies & uoms: readable by any authenticated user (used in dropdowns
-- across Sales/Orders); writable by masters editors
do $$
declare t text;
begin
  foreach t in array array['currencies','uoms','buyers','items'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (true);
      create policy %1$s_insert on public.%1$s
        for insert to authenticated
        with check (public.has_permission('masters','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('masters','edit'))
        with check (public.has_permission('masters','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated
        using (public.has_permission('masters','delete'));
    $f$, t);
  end loop;
end $$;

-- ---------- seed ----------
insert into public.currencies (code, name, symbol) values
  ('INR','Indian Rupee','₹'),
  ('GBP','Pound Sterling','£'),
  ('EUR','Euro','€'),
  ('USD','US Dollar','$')
on conflict (code) do nothing;

insert into public.uoms (code, name) values
  ('nos','Numbers'),
  ('mtr','Meters'),
  ('kg','Kilograms'),
  ('gross','Gross'),
  ('yard','Yards'),
  ('set','Set'),
  ('dzn','Dozen')
on conflict (code) do nothing;

insert into public.buyers (code, name, country, currency_code) values
  ('NEXT','NEXT','United Kingdom','GBP'),
  ('ABASIC','ABASIC','Spain','EUR')
on conflict (code) do nothing;

-- >>>>>>>>>>>>>>>>>>>> supabase/migrations/0005_sales.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- Raagam ERP — 0005 Sales & Marketing
-- Opportunity → Style card → Cost sheet (clone/revise) → Quote (+ sample).
-- ============================================================================

-- reusable human-readable code generator (PREFIX-0001) via a sequence
create or replace function public.assign_code()
returns trigger language plpgsql as $$
declare
  v_prefix text := tg_argv[0];
  v_seq    text := tg_argv[1];
begin
  if new.code is null or new.code = '' then
    new.code := v_prefix || '-' || lpad(nextval(v_seq::regclass)::text, 4, '0');
  end if;
  return new;
end;
$$;

-- ---------- opportunities ----------
create sequence if not exists public.seq_opportunity;
create table if not exists public.opportunities (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,
  buyer_id      uuid not null references public.buyers(id),
  title         text not null,
  season        text,
  stage         text not null default 'enquiry'
                  check (stage in ('enquiry','costing','quoted','won','lost')),
  target_fob    numeric(14,2),
  currency_code text references public.currencies(code),
  owner_id      uuid references public.profiles(id) default auth.uid(),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_opp_code before insert on public.opportunities
  for each row execute function public.assign_code('OPP','public.seq_opportunity');
create trigger trg_opp_updated before update on public.opportunities
  for each row execute function public.set_updated_at();
create index if not exists idx_opp_buyer on public.opportunities(buyer_id);
create index if not exists idx_opp_stage on public.opportunities(stage);

-- ---------- styles (style card) ----------
create table if not exists public.styles (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references public.opportunities(id) on delete cascade,
  style_code      text,
  name            text not null,
  fabric_type     text check (fabric_type in ('woven','circular','flat_knit')),
  fabric_subtype  text check (fabric_subtype in ('solid','yarn_dyed','melange')),
  description     text,
  image_url       text,
  specs           jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_styles_updated before update on public.styles
  for each row execute function public.set_updated_at();
create index if not exists idx_styles_opp on public.styles(opportunity_id);

-- ---------- cost sheets (+ clone/revise) ----------
create table if not exists public.cost_sheets (
  id                   uuid primary key default gen_random_uuid(),
  opportunity_id       uuid not null references public.opportunities(id) on delete cascade,
  style_id             uuid references public.styles(id) on delete set null,
  version              int not null default 1,
  status               text not null default 'draft'
                         check (status in ('draft','submitted','approved','rejected','superseded')),
  currency_code        text references public.currencies(code),
  target_fob           numeric(14,2),
  computed_fob         numeric(14,2) not null default 0,
  margin_pct           numeric(6,2),
  notes                text,
  parent_cost_sheet_id uuid references public.cost_sheets(id),
  created_by           uuid references public.profiles(id) default auth.uid(),
  approved_by          uuid references public.profiles(id),
  approved_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_cs_updated before update on public.cost_sheets
  for each row execute function public.set_updated_at();
create index if not exists idx_cs_opp on public.cost_sheets(opportunity_id);

create table if not exists public.cost_sheet_items (
  id            uuid primary key default gen_random_uuid(),
  cost_sheet_id uuid not null references public.cost_sheets(id) on delete cascade,
  category      text not null default 'material'
                  check (category in ('material','labour','overhead','other')),
  description   text not null,
  quantity      numeric(14,3) not null default 0,
  uom_id        uuid references public.uoms(id),
  unit_cost     numeric(14,4) not null default 0,
  amount        numeric(14,2) not null default 0,
  sort_order    int not null default 0
);
create index if not exists idx_csi_sheet on public.cost_sheet_items(cost_sheet_id);

-- ---------- quotes ----------
create sequence if not exists public.seq_quote;
create table if not exists public.quotes (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  cost_sheet_id  uuid references public.cost_sheets(id),
  buyer_id       uuid not null references public.buyers(id),
  fob_price      numeric(14,2) not null default 0,
  currency_code  text references public.currencies(code),
  quantity       numeric(14,0),
  incoterm       text default 'FOB',
  include_sample boolean not null default false,
  status         text not null default 'draft'
                   check (status in ('draft','sent','accepted','rejected')),
  valid_until    date,
  sent_at        timestamptz,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_quote_code before insert on public.quotes
  for each row execute function public.assign_code('QT','public.seq_quote');
create trigger trg_quote_updated before update on public.quotes
  for each row execute function public.set_updated_at();

-- ---------- samples ----------
create table if not exists public.samples (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  style_id       uuid references public.styles(id) on delete set null,
  quote_id       uuid references public.quotes(id) on delete set null,
  type           text not null default 'proto'
                   check (type in ('proto','fit','sms','pp','top')),
  status         text not null default 'requested'
                   check (status in ('requested','in_progress','sent','approved','rejected')),
  dispatched_at  timestamptz,
  courier_ref    text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_samples_updated before update on public.samples
  for each row execute function public.set_updated_at();

-- ---------- RLS (all gated by 'sales' module) ----------
do $$
declare t text;
begin
  foreach t in array array[
    'opportunities','styles','cost_sheets','cost_sheet_items','quotes','samples'
  ] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('sales','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('sales','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('sales','edit'))
        with check (public.has_permission('sales','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('sales','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- >>>>>>>>>>>>>>>>>>>> supabase/migrations/0006_orders.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- Raagam ERP — 0006 Order Management
-- Sales orders (versioned), line items, amendments (8 types, MD approval),
-- Time & Action plans/milestones (template OR auto-generate).
-- ============================================================================

-- ---------- sales orders ----------
create sequence if not exists public.seq_sales_order;
create table if not exists public.sales_orders (
  id              uuid primary key default gen_random_uuid(),
  order_number    text unique,
  buyer_id        uuid not null references public.buyers(id),
  opportunity_id  uuid references public.opportunities(id),
  quote_id        uuid references public.quotes(id),
  location_id     uuid references public.locations(id),   -- entity shipped under
  currency_code   text references public.currencies(code),
  order_qty       numeric(14,0) not null default 0,
  fob_price       numeric(14,2) not null default 0,
  total_value     numeric(16,2) not null default 0,
  baseline_fob    numeric(14,2),                          -- profit-impact baseline
  ship_date       date,
  status          text not null default 'confirmed'
                    check (status in ('confirmed','in_production','shipped','closed','cancelled')),
  current_version int not null default 1,
  merchandiser_id uuid references public.profiles(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_so_code before insert on public.sales_orders
  for each row execute function public.assign_code('SO','public.seq_sales_order');
create trigger trg_so_updated before update on public.sales_orders
  for each row execute function public.set_updated_at();
create index if not exists idx_so_buyer on public.sales_orders(buyer_id);
create index if not exists idx_so_status on public.sales_orders(status);

-- ---------- line items (size / colour breakdown) ----------
create table if not exists public.so_line_items (
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  color          text,
  size           text,
  quantity       numeric(14,0) not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists idx_soli_order on public.so_line_items(sales_order_id);

-- ---------- version-numbered revisions ----------
create table if not exists public.order_revisions (
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  version        int not null,
  snapshot       jsonb not null default '{}'::jsonb,
  reason         text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (sales_order_id, version)
);

-- ---------- amendments (8 types, all MD-approved) ----------
create table if not exists public.order_amendments (
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  amendment_type text not null check (amendment_type in (
                   'quantity','colour','price','sizes',
                   'delivery_date','consignee','packing','style')),
  description    text,
  details        jsonb not null default '{}'::jsonb,   -- { old, new }
  profit_impact  numeric(14,2),
  status         text not null default 'pending'
                   check (status in ('pending','approved','rejected')),
  requested_by   uuid references public.profiles(id) default auth.uid(),
  decided_by     uuid references public.profiles(id),
  decided_at     timestamptz,
  decided_reason text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_amend_order on public.order_amendments(sales_order_id);
create index if not exists idx_amend_status on public.order_amendments(status);

-- ---------- T&A templates ----------
create table if not exists public.ta_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create table if not exists public.ta_template_milestones (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.ta_templates(id) on delete cascade,
  name        text not null,
  sequence    int not null default 0,
  anchor      text not null default 'ship_date' check (anchor in ('order_date','ship_date')),
  offset_days int not null default 0          -- negative = before anchor
);

-- ---------- T&A plans + milestones (per order) ----------
create table if not exists public.ta_plans (
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  method         text not null default 'template' check (method in ('template','auto')),
  template_id    uuid references public.ta_templates(id),
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (sales_order_id)
);
create table if not exists public.ta_milestones (
  id             uuid primary key default gen_random_uuid(),
  ta_plan_id     uuid not null references public.ta_plans(id) on delete cascade,
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  name           text not null,
  sequence       int not null default 0,
  planned_date   date,
  actual_date    date,
  status         text not null default 'pending'
                   check (status in ('pending','in_progress','done')),
  created_at     timestamptz not null default now()
);
create index if not exists idx_tam_order on public.ta_milestones(sales_order_id);
create index if not exists idx_tam_planned on public.ta_milestones(planned_date);

-- ---------- RLS (gated by 'orders' module) ----------
do $$
declare t text;
begin
  foreach t in array array[
    'sales_orders','so_line_items','order_revisions','order_amendments',
    'ta_templates','ta_template_milestones','ta_plans','ta_milestones'
  ] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('orders','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('orders','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('orders','edit'))
        with check (public.has_permission('orders','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('orders','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- ---------- seed a standard NEXT-style T&A template ----------
insert into public.ta_templates (id, name, description)
values ('00000000-0000-0000-0000-000000000a01','Standard Knit T&A',
        'Default milestones for knitted garment export orders')
on conflict (id) do nothing;

insert into public.ta_template_milestones (template_id, name, sequence, anchor, offset_days)
values
  ('00000000-0000-0000-0000-000000000a01','Yarn Purchase',        1,'ship_date',-75),
  ('00000000-0000-0000-0000-000000000a01','Knitting',             2,'ship_date',-65),
  ('00000000-0000-0000-0000-000000000a01','Dyeing',               3,'ship_date',-55),
  ('00000000-0000-0000-0000-000000000a01','Fabric In-house',      4,'ship_date',-45),
  ('00000000-0000-0000-0000-000000000a01','Cutting',              5,'ship_date',-35),
  ('00000000-0000-0000-0000-000000000a01','Sewing',               6,'ship_date',-20),
  ('00000000-0000-0000-0000-000000000a01','Finishing & Packing',  7,'ship_date',-7),
  ('00000000-0000-0000-0000-000000000a01','Ex-factory',           8,'ship_date',0)
on conflict do nothing;

-- >>>>>>>>>>>>>>>>>>>> supabase/migrations/0007_planning.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- Raagam ERP — 0007 Planning / BOM
-- Fabric BOM (component/colour/size consumption, diameter, process-loss
-- sequence) + Material BOM (sewing/packing accessories, attributes, nos+MOQ,
-- processing flag) + order-grouped Budgets (approval → downstream to purchase).
-- BOMs need NO approval; budgets DO (PRD).
-- ============================================================================

-- ---------- Fabric BOM ----------
create table if not exists public.fabric_boms (
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  style_id       uuid references public.styles(id) on delete set null,
  fabric_type    text check (fabric_type in ('woven','circular','flat_knit')),
  fabric_subtype text check (fabric_subtype in ('solid','yarn_dyed','melange')),
  status         text not null default 'draft' check (status in ('draft','final')),
  notes          text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (sales_order_id)
);
create trigger trg_fbom_updated before update on public.fabric_boms
  for each row execute function public.set_updated_at();

-- component-wise + colour-wise + size-wise consumption, with diameter + loss
create table if not exists public.fabric_bom_components (
  id               uuid primary key default gen_random_uuid(),
  fabric_bom_id    uuid not null references public.fabric_boms(id) on delete cascade,
  component_name   text not null,                 -- Body, Sleeve, Collar, Rib ...
  color            text,
  size             text,
  diameter         text,                          -- e.g. "30 inch" (size-wise)
  gsm              numeric(10,2),
  consumption      numeric(14,4) not null default 0,  -- gross per piece (before loss)
  uom_id           uuid references public.uoms(id),
  process_loss_pct numeric(6,2) not null default 0,
  net_consumption  numeric(14,4) not null default 0,  -- consumption incl. loss
  sort_order       int not null default 0
);
create index if not exists idx_fbomc_bom on public.fabric_bom_components(fabric_bom_id);

-- process sequence with process-wise loss (yarn purchase → knitting → dyeing …)
create table if not exists public.fabric_bom_processes (
  id               uuid primary key default gen_random_uuid(),
  fabric_bom_id    uuid not null references public.fabric_boms(id) on delete cascade,
  sequence         int not null default 0,
  process_name     text not null,
  process_loss_pct numeric(6,2) not null default 0,
  notes            text
);
create index if not exists idx_fbomp_bom on public.fabric_bom_processes(fabric_bom_id);

-- ---------- Material BOM ----------
create table if not exists public.material_boms (
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  status         text not null default 'draft' check (status in ('draft','final')),
  notes          text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (sales_order_id)
);
create trigger trg_mbom_updated before update on public.material_boms
  for each row execute function public.set_updated_at();

create table if not exists public.material_bom_items (
  id                 uuid primary key default gen_random_uuid(),
  material_bom_id    uuid not null references public.material_boms(id) on delete cascade,
  category           text not null default 'sewing_accessory'
                       check (category in ('sewing_accessory','packing_accessory')),
  item_id            uuid references public.items(id),
  description        text not null,
  attribute          text,                         -- e.g. "red label", "white label"
  uom_id             uuid references public.uoms(id),
  quantity_basis     text not null default 'nos' check (quantity_basis in ('nos','moq')),
  quantity_nos       numeric(14,3) not null default 0,
  moq                numeric(14,3),
  unit_cost          numeric(14,4) not null default 0,
  requires_processing boolean not null default false,  -- e.g. Button Coloring → DC → GRN
  processing_note    text,
  sort_order         int not null default 0
);
create index if not exists idx_mbomi_bom on public.material_bom_items(material_bom_id);

-- ---------- Budgets (group orders → pull BOM lines → approve) ----------
create sequence if not exists public.seq_budget;
create table if not exists public.budgets (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,
  name          text not null,
  is_grouped    boolean not null default false,
  status        text not null default 'draft'
                  check (status in ('draft','submitted','approved','rejected')),
  currency_code text references public.currencies(code),
  total_amount  numeric(16,2) not null default 0,
  notes         text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  approved_by   uuid references public.profiles(id),
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_budget_code before insert on public.budgets
  for each row execute function public.assign_code('BUD','public.seq_budget');
create trigger trg_budget_updated before update on public.budgets
  for each row execute function public.set_updated_at();

-- which orders a budget covers (grouped = many; single = one)
create table if not exists public.budget_orders (
  budget_id      uuid not null references public.budgets(id) on delete cascade,
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  primary key (budget_id, sales_order_id)
);

create table if not exists public.budget_lines (
  id             uuid primary key default gen_random_uuid(),
  budget_id      uuid not null references public.budgets(id) on delete cascade,
  sales_order_id uuid references public.sales_orders(id) on delete set null,
  source         text not null default 'other' check (source in ('fabric','material','other')),
  description    text not null,
  quantity       numeric(14,3) not null default 0,
  unit_cost      numeric(14,4) not null default 0,
  amount         numeric(16,2) not null default 0,
  sort_order     int not null default 0
);
create index if not exists idx_budgetlines_budget on public.budget_lines(budget_id);

-- ---------- RLS (all gated by 'planning' module) ----------
do $$
declare t text;
begin
  foreach t in array array[
    'fabric_boms','fabric_bom_components','fabric_bom_processes',
    'material_boms','material_bom_items',
    'budgets','budget_orders','budget_lines'
  ] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('planning','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('planning','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('planning','edit'))
        with check (public.has_permission('planning','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('planning','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- ---------- grant planning access to demo roles ----------
-- Manager: full planning incl. budget approve/export
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'planning' and p.action in ('view','create','edit','approve','export')
where r.name = 'Manager'
on conflict do nothing;

-- Merchandiser: create/edit BOMs + budgets (no approve)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'planning' and p.action in ('view','create','edit')
where r.name = 'Merchandiser'
on conflict do nothing;

-- >>>>>>>>>>>>>>>>>>>> supabase/migrations/0008_materials_purchase.sql <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- Raagam ERP — 0008 Materials & Purchase
-- Vendors, RFQ, Purchase Orders (with approval), GRN (many-to-many vs PO,
-- partial + QC), Delivery Challans (out-and-back traceability).
-- GRN→Store and GRN→Finance(3-way match) are stubbed until those modules exist.
-- ============================================================================

-- ---------- vendors ----------
create sequence if not exists public.seq_vendor;
create table if not exists public.vendors (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,
  name           text not null,
  vendor_type    text check (vendor_type in
                   ('yarn','knitting','dyeing','trims','packing','processing','general')),
  contact_person text,
  email          text,
  phone          text,
  address        text,
  gst_number     text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_vendor_code before insert on public.vendors
  for each row execute function public.assign_code('VEN','public.seq_vendor');
create trigger trg_vendor_updated before update on public.vendors
  for each row execute function public.set_updated_at();

-- ---------- RFQ (lightweight request-for-quotation) ----------
create sequence if not exists public.seq_rfq;
create table if not exists public.rfqs (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  title       text not null,
  budget_id   uuid references public.budgets(id),
  status      text not null default 'open' check (status in ('open','closed','awarded')),
  notes       text,
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_rfq_code before insert on public.rfqs
  for each row execute function public.assign_code('RFQ','public.seq_rfq');
create trigger trg_rfq_updated before update on public.rfqs
  for each row execute function public.set_updated_at();

create table if not exists public.rfq_lines (
  id          uuid primary key default gen_random_uuid(),
  rfq_id      uuid not null references public.rfqs(id) on delete cascade,
  item_id     uuid references public.items(id),
  description text not null,
  quantity    numeric(14,3) not null default 0,
  uom_id      uuid references public.uoms(id),
  sort_order  int not null default 0
);
create index if not exists idx_rfqlines_rfq on public.rfq_lines(rfq_id);

create table if not exists public.rfq_quotes (
  id            uuid primary key default gen_random_uuid(),
  rfq_id        uuid not null references public.rfqs(id) on delete cascade,
  vendor_id     uuid not null references public.vendors(id),
  total_amount  numeric(16,2) not null default 0,
  currency_code text references public.currencies(code),
  lead_days     int,
  is_selected   boolean not null default false,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_rfqquotes_rfq on public.rfq_quotes(rfq_id);

-- ---------- purchase orders ----------
create sequence if not exists public.seq_po;
create table if not exists public.purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,
  vendor_id     uuid not null references public.vendors(id),
  budget_id     uuid references public.budgets(id),
  rfq_id        uuid references public.rfqs(id),
  location_id   uuid references public.locations(id),
  currency_code text references public.currencies(code),
  status        text not null default 'draft' check (status in
                  ('draft','pending_approval','approved','partially_received','received','closed','cancelled')),
  order_date    date,
  expected_date date,
  total_amount  numeric(16,2) not null default 0,
  notes         text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  approved_by   uuid references public.profiles(id),
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_po_code before insert on public.purchase_orders
  for each row execute function public.assign_code('PO','public.seq_po');
create trigger trg_po_updated before update on public.purchase_orders
  for each row execute function public.set_updated_at();
create index if not exists idx_po_vendor on public.purchase_orders(vendor_id);
create index if not exists idx_po_status on public.purchase_orders(status);

create table if not exists public.po_line_items (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_id           uuid references public.items(id),
  description       text not null,
  quantity          numeric(14,3) not null default 0,
  uom_id            uuid references public.uoms(id),
  unit_price        numeric(14,4) not null default 0,
  amount            numeric(16,2) not null default 0,
  received_qty      numeric(14,3) not null default 0,  -- cached accepted qty (open bal = quantity - received_qty)
  sort_order        int not null default 0
);
create index if not exists idx_poli_po on public.po_line_items(purchase_order_id);

-- ---------- GRN (goods receipt) — many-to-many vs PO at the LINE level ----------
-- A single GRN can receive lines from multiple POs; a single PO line can be
-- received across multiple GRNs (partial deliveries). Linkage is grn_line_items
-- → po_line_items.
create sequence if not exists public.seq_grn;
create table if not exists public.grns (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  vendor_id   uuid references public.vendors(id),
  location_id uuid references public.locations(id),
  grn_date    date,
  status      text not null default 'draft' check (status in ('draft','posted')),
  notes       text,
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_grn_code before insert on public.grns
  for each row execute function public.assign_code('GRN','public.seq_grn');
create trigger trg_grn_updated before update on public.grns
  for each row execute function public.set_updated_at();

create table if not exists public.grn_line_items (
  id                uuid primary key default gen_random_uuid(),
  grn_id            uuid not null references public.grns(id) on delete cascade,
  po_line_item_id   uuid references public.po_line_items(id),
  purchase_order_id uuid references public.purchase_orders(id),  -- denormalised for querying
  description       text not null,
  received_qty      numeric(14,3) not null default 0,
  accepted_qty      numeric(14,3) not null default 0,
  rejected_qty      numeric(14,3) not null default 0,
  qc_status         text not null default 'pending'
                      check (qc_status in ('pending','passed','failed','partial')),
  rejection_reason  text,
  sort_order        int not null default 0
);
create index if not exists idx_grnli_grn on public.grn_line_items(grn_id);
create index if not exists idx_grnli_poli on public.grn_line_items(po_line_item_id);

-- ---------- Delivery Challans (DC out to processor + return tracking) ----------
create sequence if not exists public.seq_dc;
create table if not exists public.delivery_challans (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  vendor_id   uuid references public.vendors(id),       -- processor
  location_id uuid references public.locations(id),
  dc_date     date,
  purpose     text,                                      -- e.g. Button Coloring, Knitting, Dyeing
  status      text not null default 'issued'
                check (status in ('issued','partially_returned','closed')),
  notes       text,
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_dc_code before insert on public.delivery_challans
  for each row execute function public.assign_code('DC','public.seq_dc');
create trigger trg_dc_updated before update on public.delivery_challans
  for each row execute function public.set_updated_at();

create table if not exists public.dc_line_items (
  id                  uuid primary key default gen_random_uuid(),
  delivery_challan_id uuid not null references public.delivery_challans(id) on delete cascade,
  item_id             uuid references public.items(id),
  description         text not null,
  sent_qty            numeric(14,3) not null default 0,
  returned_qty        numeric(14,3) not null default 0,  -- balance = sent - returned
  uom_id              uuid references public.uoms(id),
  sort_order          int not null default 0
);
create index if not exists idx_dcli_dc on public.dc_line_items(delivery_challan_id);

-- ---------- RLS (all gated by 'materials_purchase') ----------
do $$
declare t text;
begin
  foreach t in array array[
    'vendors','rfqs','rfq_lines','rfq_quotes',
    'purchase_orders','po_line_items',
    'grns','grn_line_items',
    'delivery_challans','dc_line_items'
  ] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('materials_purchase','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('materials_purchase','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('materials_purchase','edit'))
        with check (public.has_permission('materials_purchase','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('materials_purchase','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- ---------- grants ----------
-- Manager: full materials_purchase incl. PO approve/export
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'materials_purchase' and p.action in ('view','create','edit','approve','export')
where r.name = 'Manager'
on conflict do nothing;

-- Merchandiser: view/create/edit (no approve)
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p
  on p.module = 'materials_purchase' and p.action in ('view','create','edit')
where r.name = 'Merchandiser'
on conflict do nothing;

-- ---------- seed vendors ----------
-- Omit code so the trigger assigns VEN-000N and advances seq_vendor. Guarded by
-- emptiness so re-running the migration does not duplicate.
insert into public.vendors (name, vendor_type)
select v.name, v.vtype
from (values
  ('Nivedha Knits','knitting'),
  ('SD Textile','yarn'),
  ('Shree Knit Impex','general')
) as v(name, vtype)
where not exists (select 1 from public.vendors);
