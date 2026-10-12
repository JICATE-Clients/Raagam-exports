-- 0708 · Dyeing Work Order from the Sample Fabric Plan (client decision
-- 2026-10-12, the SWO workflow).
--
-- The dye house is sent a process order (Stores ▸ Process Orders, 0364) whose
-- quantity is the GREIGE weight it receives, processes and invoices:
--
--     Greige (Issue Qty) = Required Finished Weight ÷ (1 − Dyeing Loss %)
--
-- and the client asked for the FINISHED weight beside it on the document — the
-- weight the stores team checks the cloth against when it comes back.
--
--   process_orders.iwo_id            the work order (an SWO's sample IW) this
--                                    job-work was raised from. Same shape as
--                                    0609's `sales_order_id` for an order: a
--                                    nullable link, set null if the IW goes.
--   process_order_lines.return_qty   the target finished weight. NULL on every
--                                    order raised before, and on any line with
--                                    no expected return — `sent_qty` keeps
--                                    meaning what it always did.
--
-- No new table, so no new policy: both are columns on tables whose RLS and
-- unit scoping are already in place (0364, 0680).

alter table public.process_orders
  add column if not exists iwo_id uuid references public.internal_work_orders(id) on delete set null;

create index if not exists idx_process_orders_iwo
  on public.process_orders(iwo_id) where iwo_id is not null;

comment on column public.process_orders.iwo_id is
  '0708: the Internal Work Order (an SWO''s sample IW) this job-work was raised from. Nullable.';

alter table public.process_order_lines
  add column if not exists return_qty numeric(14,3) check (return_qty is null or return_qty >= 0);

comment on column public.process_order_lines.return_qty is
  '0708: the target FINISHED weight expected back (a dyeing line: sent_qty is the greige weight issued). NULL = not stated.';

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'process_orders' and column_name = 'iwo_id') then
    raise exception '0708: process_orders.iwo_id is missing';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'process_order_lines' and column_name = 'return_qty') then
    raise exception '0708: process_order_lines.return_qty is missing';
  end if;
end $$;
