-- ============================================================================
-- Raagam ERP — 0397  Restore Orders ▸ Time & Action ▸ TA Plan
--
-- WHY THIS EXISTS. `0332_drop_planning_module` tore out the Planning module,
-- and at its line 79 it also dropped two tables that are NOT Planning's:
--
--     -- TA Plan (0271)
--     drop table if exists public.ta_plan_activities cascade;
--     drop table if exists public.ta_plan_docs cascade;
--
-- TA Plan is an ORDERS screen (Orders ▸ Time & Action ▸ TA Plan), built to the
-- legacy RP-Software form and complete in the app today — header, activity grid
-- and footer all match it field for field. Since 0332 it has been the only
-- `status: "unavailable"` card outside Planning (`lib/nav/module-groups.ts`),
-- listing real `ta_plans` rows while being unable to open a single one.
--
-- This restores what an unrelated cleanup removed. It does NOT reinstate any
-- part of the Planning module, which remains dropped and awaiting its rebuild.
--
-- RECONSTRUCTED, NOT RESTORED, and that distinction matters. Migration 0271 is
-- no longer in the repository, so every column below is taken from what the
-- screen actually reads and writes — `lib/orders/ta-plan/types.ts` (the Zod
-- input and the row interfaces), `service.ts` (the select) and `actions.ts`
-- (the insert/update). The 0273 follow-up columns are re-applied from that
-- migration, which IS still present. Anything the code never mentions is gone
-- for good, and this is the honest floor rather than a claim of fidelity.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. shipment_plans — the "SH Ref No" picker's source
--
-- MINIMAL AND DELIBERATELY SO. This was a Planning table (0021) and Planning is
-- being rebuilt, so recreating its full shape here would prejudge that work.
-- TA Plan needs exactly three columns — `getTaPlanFormData` selects
-- `id, code, name` and orders by `created_at`, and `getTaPlans` embeds
-- `shipment:shipment_plans(id, code, name)`.
--
-- `create table if not exists` is load-bearing: if the Planning rebuild lands
-- its own richer `shipment_plans` first, this statement stands down rather than
-- fighting it, and the FK below binds to whichever exists.
-- ---------------------------------------------------------------------------

create sequence if not exists public.seq_shipment_plan;
create table if not exists public.shipment_plans (
  id         uuid primary key default gen_random_uuid(),
  code       text unique,                                   -- SHP-0001
  name       text not null,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_shipment_plan_code') then
    create trigger trg_shipment_plan_code before insert on public.shipment_plans
      for each row execute function public.assign_code('SHP','public.seq_shipment_plan');
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_shipment_plan_updated') then
    create trigger trg_shipment_plan_updated before update on public.shipment_plans
      for each row execute function public.set_updated_at();
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. ta_plan_docs — the header
--
-- Column for column, this is `taPlanDocInput` in lib/orders/ta-plan/types.ts.
-- Only `plan_date` is `not null`: the Zod schema requires it (`"Date is
-- required"`) and the screen marks it with the `*`; every other field is
-- optional there, so a `not null` here would reject a record the app considers
-- valid, and the failure would surface as an opaque Postgres error at Save.
--
-- `order_qty` is `numeric` rather than `int`: the Zod field is a bare
-- `z.coerce.number()` while `no_of_days` is `z.coerce.number().int()`, and an
-- integer column would silently reject a fractional order quantity.
-- ---------------------------------------------------------------------------

create sequence if not exists public.seq_ta_plan_doc;
create table if not exists public.ta_plan_docs (
  id                     uuid primary key default gen_random_uuid(),
  code                   text unique,                       -- TAP-0001 ("No")
  plan_date              date not null default current_date,-- "Dt"
  customer_id            uuid references public.buyers(id),
  sales_order_id         uuid references public.sales_orders(id),        -- "SC No"
  shipment_plan_id       uuid references public.shipment_plans(id),      -- "SH Ref No"
  order_no               text,
  start_date             date,
  style_id               uuid references public.garment_styles(id),
  -- footer band
  delivery_date          date,
  order_qty              numeric,
  proposed_delivery_date date,
  target_date            date,
  no_of_days             int,
  created_by             uuid references public.profiles(id) default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_ta_plan_doc_code') then
    create trigger trg_ta_plan_doc_code before insert on public.ta_plan_docs
      for each row execute function public.assign_code('TAP','public.seq_ta_plan_doc');
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_ta_plan_doc_updated') then
    create trigger trg_ta_plan_doc_updated before update on public.ta_plan_docs
      for each row execute function public.set_updated_at();
  end if;
end $$;

create index if not exists idx_ta_plan_docs_order    on public.ta_plan_docs(sales_order_id);
create index if not exists idx_ta_plan_docs_customer on public.ta_plan_docs(customer_id);
create index if not exists idx_ta_plan_docs_style    on public.ta_plan_docs(style_id);


-- ---------------------------------------------------------------------------
-- 3. ta_plan_activities — the activity grid
--
-- THE TWO FOREIGN-KEY NAMES ARE PART OF THE CONTRACT, not incidental. This
-- table points at `ta_activities` twice, so PostgREST cannot infer which one an
-- embed means, and `service.ts` disambiguates by naming them:
--
--     activity:ta_activities!ta_plan_activities_activity_id_fkey(...)
--     from_activity:ta_activities!ta_plan_activities_from_activity_id_fkey(...)
--
-- Those are Postgres's own default names for a column-level `references`
-- (`<table>_<column>_fkey`), so the inline form below produces exactly them —
-- but they are written out as explicit constraints anyway, because a rename
-- here breaks the screen with a PostgREST error that names neither file.
--
-- `on delete cascade` is what `deleteTaPlan` relies on: it deletes the header
-- only, with the comment "activities cascade".
-- ---------------------------------------------------------------------------

create table if not exists public.ta_plan_activities (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null,
  sno              int not null default 0,
  activity_id      uuid,
  from_activity_id uuid,
  details          text,
  start_date       date,
  days_required    int,
  end_date         date,
  -- 0273 (TA Followups) — additive on this table, so restored with it.
  actual_date      date,
  status           text not null default 'pending',
  description      text,
  notes            text,
  created_at       timestamptz not null default now(),

  constraint ta_plan_activities_plan_id_fkey
    foreign key (plan_id) references public.ta_plan_docs(id) on delete cascade,
  constraint ta_plan_activities_activity_id_fkey
    foreign key (activity_id) references public.ta_activities(id),
  constraint ta_plan_activities_from_activity_id_fkey
    foreign key (from_activity_id) references public.ta_activities(id),
  constraint ta_plan_activities_status_check
    check (status in ('pending','in_progress','done'))
);

create index if not exists idx_ta_plan_activities_plan   on public.ta_plan_activities(plan_id);
create index if not exists idx_ta_plan_activities_status on public.ta_plan_activities(status);


-- ---------------------------------------------------------------------------
-- 4. RLS — the existing 'orders' module, no new permission
--
-- Identical to 0127's block for the sibling Garment Process Amendment document,
-- so the two Orders documents cannot drift apart on who may read or write them.
--
-- `shipment_plans` is gated on 'orders' too. It is a Planning table by origin,
-- but the only screen that reads it today is TA Plan, and a table with RLS
-- enabled and NO policy is readable by nobody — which would leave the SH Ref No
-- picker permanently empty and look like a data problem.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['shipment_plans','ta_plan_docs','ta_plan_activities'] loop
    execute format('alter table public.%I enable row level security;', t);

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_read') then
      execute format($f$create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));$f$, t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_insert') then
      execute format($f$create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));$f$, t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_update') then
      execute format($f$create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));$f$, t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_delete') then
      execute format($f$create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));$f$, t);
    end if;
  end loop;
end $$;
