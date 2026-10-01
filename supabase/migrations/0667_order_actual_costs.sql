-- 0667 — Order Profitability: the actual costs nothing else records.
--
-- doc/order/digitalisation-plan.md §3 (Budget vs actual). Purchase, processing
-- and sales actuals are DERIVED on read from the documents that already carry
-- the order (po_line_items / process_orders / shipment_lines .sales_order_id).
-- Two heads have no document anywhere in this app:
--
--   * CMT & overheads — no costed CMT, piece-rate or overhead is kept per order
--     (worker_piece_records and contractor_payroll carry no rate / no order);
--   * other income   — the budget counts it into profit (`profit = sales +
--     income − cost`), so leaving it out of the actual would understate actual
--     profit against a budget that includes it.
--
-- So these are entered by hand, here, one row per amount. The `bucket` check is
-- a LIST so a later head is one more literal, not a new table.

create table if not exists public.order_actual_costs (
  id             uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  bucket         text not null check (bucket in ('cmt_overheads', 'income')),
  description    text not null check (length(btrim(description)) > 0),
  amount_inr     numeric(14,2) not null check (amount_inr >= 0),
  remarks        text,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_order_actual_costs_order
  on public.order_actual_costs(sales_order_id);

drop trigger if exists trg_order_actual_costs_updated on public.order_actual_costs;
create trigger trg_order_actual_costs_updated
  before update on public.order_actual_costs
  for each row execute function public.set_updated_at();

alter table public.order_actual_costs enable row level security;

drop policy if exists oac_read   on public.order_actual_costs;
drop policy if exists oac_insert on public.order_actual_costs;
drop policy if exists oac_update on public.order_actual_costs;
drop policy if exists oac_delete on public.order_actual_costs;
create policy oac_read on public.order_actual_costs
  for select to authenticated using (public.has_permission('orders','view'));
create policy oac_insert on public.order_actual_costs
  for insert to authenticated with check (public.has_permission('orders','edit'));
create policy oac_update on public.order_actual_costs
  for update to authenticated
  using (public.has_permission('orders','edit'))
  with check (public.has_permission('orders','edit'));
create policy oac_delete on public.order_actual_costs
  for delete to authenticated using (public.has_permission('orders','edit'));

revoke all on public.order_actual_costs from anon;
grant select, insert, update, delete on public.order_actual_costs to authenticated;

comment on table public.order_actual_costs is
  '0667: hand-entered actuals per order for heads no document records (CMT & overheads, other income). Purchase, processing and sales actuals are derived from their documents, never stored.';

do $v$
begin
  if has_table_privilege('anon', 'public.order_actual_costs', 'select') then
    raise exception '0667: order_actual_costs is readable by anon';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.order_actual_costs'::regclass) then
    raise exception '0667: RLS is off on order_actual_costs';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'order_actual_costs') <> 4 then
    raise exception '0667: expected 4 policies on order_actual_costs';
  end if;
end;
$v$;
