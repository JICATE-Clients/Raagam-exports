-- ============================================================================
-- Raagam ERP — 0401 Orders ▸ TA ▸ TA Plan — RESTORE what 0332 dropped
--
-- 0332_drop_planning_module removed the Planning module and, at its line 79,
-- also dropped two tables belonging to an ORDERS screen:
--
--     -- TA Plan (0271)
--     drop table if exists public.ta_plan_activities cascade;
--     drop table if exists public.ta_plan_docs cascade;
--
-- plus `seq_ta_plan_doc` (line 150). The TA Plan screen is built and complete;
-- only its tables are absent, so the nav card carries `status: "unavailable"`
-- (lib/nav/module-groups.ts) — the one such card outside Planning.
--
-- THE DDL BELOW IS RECONSTRUCTED, NOT RESTORED. Migration 0271 is no longer in
-- this repository (0270 ×2, 0272, 0273, 0274 are present; 0271 is not), so every
-- column here is derived from what the application actually reads and writes:
--   · lib/orders/ta-plan/types.ts    — `taPlanDocInput` / `taPlanActivityInput`
--   · lib/orders/ta-plan/service.ts  — the select list and its embeds
--   · lib/orders/ta-plan/actions.ts  — insert/update/delete behaviour
-- Anything 0271 held that the code never references is NOT recoverable and is
-- not here. Two consequences worth stating rather than discovering later:
--   · the code prefix 'TAP' is a CHOICE, not a recovery — 0271's prefix is
--     unknown. It is free (TAC/TAS/TDA are taken) and no rows exist to be
--     renumbered, so this is safe, but it may not match the original.
--   · `seq_ta_plan_doc` IS the original name, recovered from 0332:150.
--
-- 0273_ta_followups added four columns to `ta_plan_activities` with
-- `add column if not exists`. A recreated table does NOT re-run it, so those
-- columns are folded in below. Leaving them out would silently break TA
-- Followups the moment TA Plan started working again.
-- ============================================================================

-- ---------- shipment_plans: a STUB, and deliberately labelled one ----------
-- TA Plan's "SH Ref No" field references this table, and the list query embeds
-- `shipment:shipment_plans(id, code, name)` — a PostgREST embed against a
-- missing table fails the WHOLE query, so without this the screen cannot list
-- plans at all, not merely lose one field.
--
-- BUT: this table is PLANNING'S (0021 "Shipment Plans", dropped by 0332:115
-- beside its companion `shipment_plan_orders`). Recreating it IS reinstating a
-- Planning table, and any claim that this migration touches nothing of Planning
-- is wrong. What is true is narrower: this restores the minimum shape TA Plan
-- reads, and no Planning screen or behaviour comes back with it.
--
-- IT WILL BE PERMANENTLY EMPTY. No code in this repository inserts into
-- `shipment_plans` — every Planning screen is `status: "unavailable"` — so the
-- SH Ref No picker will offer nothing until Planning is rebuilt. That is the
-- honest outcome: this stub stops the query failing; it does not make the field
-- usable. `shipment_plan_id` is nullable, so a plan saves fine without it.
--
-- WHEN PLANNING IS REBUILT, READ THIS. `create table if not exists` means a
-- later, fuller 0021-style definition will be SKIPPED, leaving this three-column
-- stub in place and Planning broken in a way that looks like a missing column
-- rather than a stale table. The rebuild must DROP this stub and recreate the
-- real table, not assume its own `create` won.
create table if not exists public.shipment_plans (
  id         uuid primary key default gen_random_uuid(),
  code       text unique,
  name       text not null,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- TA Plan header ----------
create sequence if not exists public.seq_ta_plan_doc;
create table if not exists public.ta_plan_docs (
  id                     uuid primary key default gen_random_uuid(),
  code                   text unique,                              -- "No" (TAP-0001), trigger-assigned
  plan_date              date not null default current_date,       -- "Dt"
  customer_id            uuid references public.buyers(id),        -- Customer
  sales_order_id         uuid references public.sales_orders(id),  -- SC No
  shipment_plan_id       uuid references public.shipment_plans(id),-- SH Ref No
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
create trigger trg_taplan_code before insert on public.ta_plan_docs
  for each row execute function public.assign_code('TAP','public.seq_ta_plan_doc');
create trigger trg_taplan_updated before update on public.ta_plan_docs
  for each row execute function public.set_updated_at();
create index if not exists idx_taplan_customer on public.ta_plan_docs(customer_id);
create index if not exists idx_taplan_order    on public.ta_plan_docs(sales_order_id);
create index if not exists idx_taplan_style    on public.ta_plan_docs(style_id);

-- ---------- Activity grid ----------
-- `on delete cascade` is load-bearing: deleteTaPlan() removes only the header
-- and relies on the activities following ("// activities cascade",
-- actions.ts). updateTaPlan() deletes every row for the plan and re-inserts,
-- so `plan_id` carries an index.
--
-- Two FKs point at the SAME table (`ta_activities`), which is why the service
-- must name the constraints in its embed —
-- `activity:ta_activities!ta_plan_activities_activity_id_fkey(...)` and
-- `from_activity:...from_activity_id_fkey(...)`. PostgREST cannot disambiguate
-- two FKs to one table on its own, so THESE CONSTRAINT NAMES ARE AN API
-- CONTRACT: rename them and the list query fails with an ambiguity error.
create table if not exists public.ta_plan_activities (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null references public.ta_plan_docs(id) on delete cascade,
  sno              int not null default 0,
  activity_id      uuid references public.ta_activities(id),
  from_activity_id uuid references public.ta_activities(id),
  details          text,
  start_date       date,
  days_required    int,
  end_date         date,
  -- from 0273_ta_followups (folded in: a recreated table does not re-run it)
  actual_date      date,
  status           text not null default 'pending',
  description      text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint ta_plan_activities_status_check check (status in ('pending','in_progress','done'))
);
create trigger trg_taplanact_updated before update on public.ta_plan_activities
  for each row execute function public.set_updated_at();
create index if not exists idx_taplanact_plan     on public.ta_plan_activities(plan_id);
create index if not exists idx_ta_plan_activities_status on public.ta_plan_activities(status);

-- ---------- RLS (reuse the existing 'orders' module — no new permission) ----------
-- Same shape as 0274_ta_completion. `shipment_plans` is included so the embed
-- is readable; it is read-only in practice because nothing inserts into it.
do $$
declare t text;
begin
  foreach t in array array['ta_plan_docs','ta_plan_activities','shipment_plans'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (public.has_permission('orders','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('orders','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('orders','edit')) with check (public.has_permission('orders','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('orders','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
