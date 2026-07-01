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
