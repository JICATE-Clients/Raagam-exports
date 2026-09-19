-- ============================================================================
-- Raagam ERP — 0594 IWO Budget: the budget of an Internal Work Order.
--
-- Client audio, 2026-09-19 (plan ~/.claude/plans/humming-discovering-beacon.md,
-- Phase 3): "Completed IWO BOMs auto-populate into the Budget under the
-- respective Yarn, Fabric or Accessories purchase / process tabs", and the
-- merchandiser types the rates that are then approved for the stock run.
--
-- ## WHY NOT ONE MORE KIND OF ROW IN `order_budgets`
--
-- The user decided it (2026-09-19): a SEPARATE IWO Budget. The order budget is
-- garment-order-keyed at every layer, each reason sufficient on its own:
--   1. `order_budget_orders.garment_order_id` is NOT NULL and the app requires
--      at least one order; its RLS on lines is `has_amendment_access(
--      garment_order_id)` — an IWO line would have to fake an order to be read.
--   2. Its totals are SALES-relative (profit, margin, percent lines of sales).
--      A stock run has no buyer and no sales value.
--   3. Its lock is per RE No (0576's `order_lock_of`), a thing an IWO has only
--      optionally.
-- So the IWO budget MIRRORS `order_budget_lines`' rate columns and CHECKs —
-- same names, so the Budget's pure calculation code (`budgetTotals`,
-- `lineAmount`, `copyRatesFrom`) values an IWO line exactly as an order line —
-- minus the garment grain (order, style, component, CMT breakup, pcs/units).
--
-- ## WHAT IS DIFFERENT, AND WHY
--
--   * ONE BUDGET PER IWO (unique `iwo_id`), like its BOMs. RESTRICT on delete:
--     a work order with a budget is not deleted from under it.
--   * NO `percent` RATE TYPE — there is no sales value to take a percent of.
--   * NO `income` / `garment_process` / `cmt` / `fabric` SOURCE. An IWO fabric
--     is always knitted from yarn (the fabric purchase source never arises),
--     and nothing is sold.
--   * Entry No is a plain serial, assigned on insert — 0593's order-budget rule
--     with its own counter.
--   * `from_bom` is 0591's provenance flag: a line pulled from a BOM carries the
--     BOM's quantity and is not retyped.
--
-- The approval columns (submitted / decided) are here now so the status CHECKs
-- are the order budget's from the first row; the approval flow and the BOM
-- lock that an approved budget brings are Phase 5.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Header
-- ---------------------------------------------------------------------------
create table if not exists public.iwo_budgets (
  id                uuid primary key default gen_random_uuid(),
  code              text,
  iwo_id            uuid not null unique references public.internal_work_orders(id) on delete restrict,
  budget_date       date not null default current_date,
  status            text not null default 'draft'
                      check (status in ('draft', 'submitted', 'approved', 'rejected')),
  submitted_at      timestamptz,
  submitted_by      uuid references public.profiles(id),
  decided_at        timestamptz,
  decided_by        uuid references public.profiles(id),
  decision_remark   text,
  submitted_summary jsonb,
  remark            text,
  -- Stamped from the IWO by the guard below, never from the form.
  location_id       uuid not null references public.locations(id),
  created_by        uuid references public.profiles(id) default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint chk_iwob_decision check ((decided_at is null) = (decided_by is null)),
  constraint chk_iwob_decision_matches_status
    check ((status in ('approved', 'rejected')) = (decided_at is not null))
);

create unique index if not exists uq_iwo_budgets_code on public.iwo_budgets (code) where code is not null;

drop trigger if exists trg_iwo_budgets_updated on public.iwo_budgets;
create trigger trg_iwo_budgets_updated before update on public.iwo_budgets
  for each row execute function public.set_updated_at();

-- Location from the IWO, as every IWO document (0581, 0584).
create or replace function public.iwo_budget_guard()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_loc uuid;
begin
  select w.location_id into v_loc from public.internal_work_orders w where w.id = new.iwo_id;
  if v_loc is null then
    raise exception 'No Internal Work Order % to budget.', new.iwo_id using errcode = '23503';
  end if;
  new.location_id := v_loc;
  return new;
end;
$$;

comment on function public.iwo_budget_guard() is
  'IWO Budget (0594): stamps location_id from the IWO, so the budget belongs to '
  'the unit that raised the work order.';

revoke all on function public.iwo_budget_guard() from public, anon;
grant execute on function public.iwo_budget_guard() to authenticated;

drop trigger if exists trg_iwo_budget_guard on public.iwo_budgets;
create trigger trg_iwo_budget_guard
  before insert or update of iwo_id on public.iwo_budgets
  for each row execute function public.iwo_budget_guard();

-- Entry No — 0593's rule, its own counter.
create or replace function public.assign_iwo_budget_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.code is null or btrim(new.code) = '' then
    perform pg_advisory_xact_lock(hashtext('iwo_budgets.code'));
    select coalesce(max(code::bigint), 0) + 1
      into new.code
      from public.iwo_budgets
     where code ~ '^[0-9]+$';
  end if;
  return new;
end;
$$;
revoke all on function public.assign_iwo_budget_code() from public, anon;

drop trigger if exists trg_iwob_assign_code on public.iwo_budgets;
create trigger trg_iwob_assign_code
  before insert on public.iwo_budgets
  for each row execute function public.assign_iwo_budget_code();

comment on column public.iwo_budgets.code is
  'Entry No — a plain serial assigned on insert by trg_iwob_assign_code (0594, 0593''s rule).';


-- ---------------------------------------------------------------------------
-- 2. Lines — `order_budget_lines`' rate columns and CHECKs, minus the garment grain
-- ---------------------------------------------------------------------------
create table if not exists public.iwo_budget_lines (
  id            uuid primary key default gen_random_uuid(),
  budget_id     uuid not null references public.iwo_budgets(id) on delete cascade,
  sno           int  not null default 0,
  source        text not null
                  check (source in ('yarn', 'yarn_process', 'fabric_process', 'material', 'material_process', 'expense')),
  item_id       uuid references public.items(id),
  process_id    uuid references public.processes(id),
  cost_head_id  uuid references public.config_lookups(id),
  stage_id      uuid references public.config_lookups(id) on delete set null,
  description   text,
  specification text,
  -- A shade (yarn) or colour this line is for; NULL = every colour.
  combo         text,
  basis         text check (basis is null or basis in ('process', 'fabric', 'color')),
  qty           numeric(16,4),
  uom_id        uuid references public.uoms(id),
  rate          numeric check (rate is null or rate >= 0),
  rate_type     text not null default 'per_unit' check (rate_type in ('per_unit', 'flat')),
  currency_code text references public.currencies(code),
  ex_rate       numeric check (ex_rate is null or ex_rate > 0),
  is_foc        boolean not null default false,
  is_import     boolean not null default false,
  from_bom      boolean not null default false,
  notes         text,
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  constraint chk_iwobl_currency_pair check ((currency_code is null) = (ex_rate is null))
);
create index if not exists idx_iwo_budget_lines_budget on public.iwo_budget_lines(budget_id);


-- ---------------------------------------------------------------------------
-- 3. RLS — the order budget's shape: header scoped to the current unit, lines
--    by the 'orders' permission (the IWO BOMs' child rule, 0581 §8)
-- ---------------------------------------------------------------------------
alter table public.iwo_budgets enable row level security;
alter table public.iwo_budget_lines enable row level security;

drop policy if exists iwo_budgets_read on public.iwo_budgets;
drop policy if exists iwo_budgets_insert on public.iwo_budgets;
drop policy if exists iwo_budgets_update on public.iwo_budgets;
drop policy if exists iwo_budgets_delete on public.iwo_budgets;
create policy iwo_budgets_read on public.iwo_budgets
  for select to authenticated
  using (public.has_permission('orders', 'view') and public.is_current_location(location_id));
create policy iwo_budgets_insert on public.iwo_budgets
  for insert to authenticated
  with check (public.has_permission('orders', 'create') and public.is_current_location(location_id));
-- EDIT OR APPROVE, as order_budgets: an approver writes the decision.
create policy iwo_budgets_update on public.iwo_budgets
  for update to authenticated
  using ((public.has_permission('orders', 'edit') or public.has_permission('orders', 'approve'))
         and public.is_current_location(location_id))
  with check ((public.has_permission('orders', 'edit') or public.has_permission('orders', 'approve'))
              and public.is_current_location(location_id));
create policy iwo_budgets_delete on public.iwo_budgets
  for delete to authenticated
  using (public.has_permission('orders', 'delete') and public.is_current_location(location_id));

drop policy if exists iwo_budget_lines_read on public.iwo_budget_lines;
drop policy if exists iwo_budget_lines_insert on public.iwo_budget_lines;
drop policy if exists iwo_budget_lines_update on public.iwo_budget_lines;
drop policy if exists iwo_budget_lines_delete on public.iwo_budget_lines;
create policy iwo_budget_lines_read on public.iwo_budget_lines
  for select to authenticated using (public.has_permission('orders', 'view'));
create policy iwo_budget_lines_insert on public.iwo_budget_lines
  for insert to authenticated with check (public.has_permission('orders', 'create'));
create policy iwo_budget_lines_update on public.iwo_budget_lines
  for update to authenticated
  using (public.has_permission('orders', 'edit'))
  with check (public.has_permission('orders', 'edit'));
create policy iwo_budget_lines_delete on public.iwo_budget_lines
  for delete to authenticated using (public.has_permission('orders', 'delete'));


-- ---------------------------------------------------------------------------
-- 4. Assertions, from the catalog
-- ---------------------------------------------------------------------------
do $$
declare v_t text;
begin
  foreach v_t in array array['iwo_budgets', 'iwo_budget_lines'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || v_t)::regclass) then
      raise exception '0594: RLS is off on %', v_t;
    end if;
    if (select count(*) from pg_policies where schemaname = 'public' and tablename = v_t) <> 4 then
      raise exception '0594: % does not carry its four policies', v_t;
    end if;
  end loop;
  foreach v_t in array array['public.iwo_budget_guard()', 'public.assign_iwo_budget_code()'] loop
    if has_function_privilege('anon', v_t, 'EXECUTE') then
      raise exception '0594: % is executable by anon', v_t;
    end if;
  end loop;
end $$;
