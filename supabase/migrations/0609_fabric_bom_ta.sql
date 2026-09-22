-- ============================================================================
-- Raagam ERP — 0609 Fabric BOM T&A ▸ Steps 6–11 (yarn PO → finished roll in)
--
-- Spec: doc/order/fabricbom tanda.md (Module 2) · Plan: doc/order/fabricbom-tanda-plan.md
--
-- Six store/production steps per order, from the yarn purchase order to the
-- finished roll arriving for cutting:
--
--    6 Yarn PO · 7 Yarn GRN · 8 Knitting delivery · 9 Knitting receipt
--   10 Fabric process delivery · 11 Fabric process receipt
--
-- Sibling of 0608 (trims, steps 12–17) and built the same way on purpose.
--
-- ## NOTHING ABOUT A STEP'S PROGRESS IS STORED
--
-- The spec's `order_fabric_process_transactions` would be a SECOND COPY of the
-- PO, GRN and process documents this ERP already holds — and a copy drifts the
-- first time a GRN is edited. Status, quantities, OVERDUE and actual dates are
-- derived from those documents on every read (`lib/orders/fabric-ta/`). The
-- only stored input is what a PERSON decides: a receipt tolerance, a manual
-- done date for what the documents cannot show, remarks, and who owns the step.
--
-- ## KEYED (ORDER, ITEM, STEP), NEVER A BOM ROW
--
-- The spec keys on `order_fabric_bom_items(id)`. The Fabric BOM deletes and
-- reinserts its rows on every save, so a mark keyed to one would be lost by the
-- next save. `item_id` is the yarn (steps 6–8) or the fabric (steps 9–11) —
-- the grain the documents themselves carry, and the spec's own "all colourways
-- sharing a yarn merge into one knitting lot".
--
-- ## PROCESS ORDERS GAIN AN ORDER
--
-- Knitting and dyeing are Stores ▸ Process Orders (`process_type` knitting /
-- dyeing / washing / finishing / printing), with Issues out and Receipts in.
-- Nothing tied one to a sales order, so the tracker could not tell whose yarn
-- went to the knitter. `sales_order_id` is the same nullable link 0424 gave PO
-- lines: a process order raised for no order behaves exactly as before.
-- ============================================================================

create table if not exists public.order_fabric_ta_marks (
  id                 uuid primary key default gen_random_uuid(),
  sales_order_id     uuid not null references public.sales_orders(id) on delete cascade,
  item_id            uuid not null references public.items(id) on delete cascade,
  step_code          text not null check (step_code in (
                       'YARN_PO','YARN_GRN','KNIT_DC','KNIT_GRN','PROCESS_DC','PROCESS_GRN')),
  -- A receipt allowance, capped at 10 % like 0608's: past that it is a
  -- different required quantity, which belongs on the Fabric BOM.
  tolerance_pct      numeric(5,2) not null default 0
                       check (tolerance_pct >= 0 and tolerance_pct <= 10),
  -- A person's word that the step is done, for what the documents cannot show
  -- (a PO raised outside the ERP, a knitter's receipt never entered). Wins over
  -- the derivation, and the tracker labels it manual.
  done_on            date,
  remarks            text,
  assigned_staff_id  uuid references public.employees(id) on delete set null,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint order_fabric_ta_marks_step_unique unique (sales_order_id, item_id, step_code)
);

create index if not exists idx_order_fabric_ta_marks_staff
  on public.order_fabric_ta_marks(assigned_staff_id) where assigned_staff_id is not null;

drop trigger if exists trg_order_fabric_ta_marks_updated on public.order_fabric_ta_marks;
create trigger trg_order_fabric_ta_marks_updated
  before update on public.order_fabric_ta_marks
  for each row execute function public.set_updated_at();

alter table public.order_fabric_ta_marks enable row level security;

drop policy if exists ofta_read   on public.order_fabric_ta_marks;
drop policy if exists ofta_insert on public.order_fabric_ta_marks;
drop policy if exists ofta_update on public.order_fabric_ta_marks;
drop policy if exists ofta_delete on public.order_fabric_ta_marks;
create policy ofta_read on public.order_fabric_ta_marks
  for select to authenticated using (public.has_permission('orders','view'));
create policy ofta_insert on public.order_fabric_ta_marks
  for insert to authenticated with check (public.has_permission('orders','edit'));
create policy ofta_update on public.order_fabric_ta_marks
  for update to authenticated
  using (public.has_permission('orders','edit'))
  with check (public.has_permission('orders','edit'));
create policy ofta_delete on public.order_fabric_ta_marks
  for delete to authenticated using (public.has_permission('orders','edit'));

revoke all on public.order_fabric_ta_marks from anon;
grant select, insert, update, delete on public.order_fabric_ta_marks to authenticated;

comment on table public.order_fabric_ta_marks is
  '0609: what a person decides about a Fabric T&A step (6–11) — tolerance, manual done date, remarks, owner. Progress itself is derived from PO/GRN/process documents, never stored.';


alter table public.process_orders
  add column if not exists sales_order_id uuid references public.sales_orders(id) on delete set null;

create index if not exists idx_process_orders_sales_order
  on public.process_orders(sales_order_id) where sales_order_id is not null;

comment on column public.process_orders.sales_order_id is
  '0609: the order (RE No) this job-work is for — what lets Fabric T&A steps 8–11 find the knitting and dyeing documents of an order. Nullable: a process order for no order works as before.';


-- ---------------------------------------------------------------------------
-- Smoke test: verify from the catalog, not from "the SQL ran".
-- ---------------------------------------------------------------------------
do $v$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='process_orders'
                    and column_name='sales_order_id' and data_type='uuid') then
    raise exception '0609: process_orders.sales_order_id missing';
  end if;
  if has_table_privilege('anon', 'public.order_fabric_ta_marks', 'select') then
    raise exception '0609: order_fabric_ta_marks is readable by anon';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.order_fabric_ta_marks'::regclass) then
    raise exception '0609: RLS is off on order_fabric_ta_marks';
  end if;
end;
$v$;
