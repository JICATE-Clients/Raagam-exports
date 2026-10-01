-- 0666 · Order progress tracker — delivery-risk alert state
--
-- doc/order/digitalisation-plan.md §1. The tracker DERIVES every stage and the
-- risk level on read (lib/orders/progress/engine.ts); nothing about progress is
-- stored. This table holds only what the alert sweep needs to send each alert
-- ONCE: the last level an order was notified at.
--
--   * a row is claimed by the sweep (`/api/cron/order-risk`) when an order ENTERS
--     at_risk or late, with the level it was notified at;
--   * a worse level (at_risk → late) is a new alert, the same level is not;
--   * back on track deletes the row, so a later slip alerts again.
--
-- Written by the service role only (the sweep). Read by anyone who can see
-- orders, so the tracker can say "alerted 2 days ago".

create table if not exists public.order_risk_alerts (
  sales_order_id  uuid primary key references public.sales_orders(id) on delete cascade,
  level           text not null check (level in ('at_risk', 'late')),
  projected_date  date,
  delivery_date   date,
  notified_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.order_risk_alerts is
  '0666: last delivery-risk level each RE was alerted at. Written only by the order-risk sweep (service role); derived state lives in lib/orders/progress.';

alter table public.order_risk_alerts enable row level security;

drop policy if exists order_risk_alerts_read on public.order_risk_alerts;
create policy order_risk_alerts_read on public.order_risk_alerts
  for select to authenticated
  using (public.has_permission('orders', 'view'));

-- No insert/update/delete policy: only the service role (which bypasses RLS)
-- writes here. Revoke the table-level write grants too, so a policy added by
-- mistake later still cannot open it to a session.
revoke insert, update, delete on public.order_risk_alerts from anon, authenticated;
revoke all on public.order_risk_alerts from anon;

do $assert$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'order_risk_alerts' and c.relrowsecurity
  ) then
    raise exception '0666: order_risk_alerts must have RLS enabled';
  end if;
  if has_table_privilege('authenticated', 'public.order_risk_alerts', 'INSERT')
     or has_table_privilege('anon', 'public.order_risk_alerts', 'SELECT') then
    raise exception '0666: order_risk_alerts must not be writable by a session or readable by anon';
  end if;
end
$assert$;
