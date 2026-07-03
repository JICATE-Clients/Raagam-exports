-- ============================================================================
-- Raagam ERP — 0042 Analytics (cross-module aggregation RPCs)
-- SECURITY DEFINER functions that aggregate across modules for the Analytics
-- dashboard. Each self-gates on has_permission('reports','view') then does the
-- date_trunc / group by in the DB — so a reports-only user gets the numbers
-- without needing per-module RLS row access. Also seeds the (previously
-- un-seeded) `reports` module permissions.
-- ADD-ONLY.
-- ============================================================================

-- ---------- seed the reports module permissions -----------------------------
insert into public.permissions (module, action, description)
select 'reports', a, initcap(a) || ' reports'
from unnest(array['view', 'export']) a
on conflict (module, action) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.module = 'reports' and p.action in ('view', 'export')
where r.name in ('Administrator', 'Managing Director', 'Manager')
on conflict do nothing;

-- ---------- guard helper is inlined in each fn ------------------------------
-- (plpgsql so we can raise on missing permission; SQL fns can't.)

create or replace function public.analytics_monthly_sales(
  p_from date, p_to date, p_location uuid default null)
returns table(month date, order_count bigint, units numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('reports', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select date_trunc('month', so.created_at)::date, count(*)::bigint,
           coalesce(sum(so.order_qty), 0)::numeric
    from public.sales_orders so
    where so.status <> 'cancelled'
      and so.created_at >= p_from and so.created_at < (p_to + 1)
      and (p_location is null or so.location_id = p_location)
    group by 1 order by 1;
end;
$$;

create or replace function public.analytics_top_customers(
  p_from date, p_to date, p_location uuid default null)
returns table(buyer_name text, revenue_inr numeric, invoices bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('reports', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select b.name, coalesce(sum(r.amount_inr), 0)::numeric, count(*)::bigint
    from public.receivables r
    join public.buyers b on b.id = r.buyer_id
    where r.status <> 'cancelled'
      and r.invoice_date >= p_from and r.invoice_date <= p_to
      and (p_location is null or r.location_id = p_location)
    group by b.name order by 2 desc limit 10;
end;
$$;

create or replace function public.analytics_top_products(
  p_from date, p_to date, p_location uuid default null)
returns table(label text, units numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('reports', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select coalesce(nullif(trim(coalesce(sli.color, '') || ' ' || coalesce(sli.size, '')), ''),
                    '(unspecified)'),
           coalesce(sum(sli.quantity), 0)::numeric
    from public.so_line_items sli
    join public.sales_orders so on so.id = sli.sales_order_id
    where so.status <> 'cancelled'
      and so.created_at >= p_from and so.created_at < (p_to + 1)
      and (p_location is null or so.location_id = p_location)
    group by 1 order by 2 desc limit 10;
end;
$$;

create or replace function public.analytics_revenue_trend(
  p_from date, p_to date, p_location uuid default null)
returns table(month date, invoiced_inr numeric, received_inr numeric, domestic_inr numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('reports', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    with rev as (
      select date_trunc('month', r.invoice_date)::date as m,
             r.amount_inr as inv, 0::numeric as rec, 0::numeric as dom
      from public.receivables r
      where r.status <> 'cancelled'
        and r.invoice_date >= p_from and r.invoice_date <= p_to
        and (p_location is null or r.location_id = p_location)
      union all
      select date_trunc('month', rr.receipt_date)::date, 0, rr.amount_inr, 0
      from public.receivable_receipts rr
      join public.receivables r2 on r2.id = rr.receivable_id
      where rr.receipt_date >= p_from and rr.receipt_date <= p_to
        and (p_location is null or r2.location_id = p_location)
      union all
      select date_trunc('month', d.invoice_date)::date, 0, 0, coalesce(d.taxable_amount, 0)
      from public.domestic_garment_invoices d
      where d.status <> 'cancelled'
        and d.invoice_date >= p_from and d.invoice_date <= p_to
    )
    select m, sum(inv)::numeric, sum(rec)::numeric, sum(dom)::numeric
    from rev group by m order by m;
end;
$$;

create or replace function public.analytics_purchase_trend(
  p_from date, p_to date, p_location uuid default null)
returns table(month date, po_count bigint, po_value numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('reports', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select date_trunc('month', coalesce(po.order_date, po.created_at::date))::date,
           count(*)::bigint, coalesce(sum(po.total_amount), 0)::numeric
    from public.purchase_orders po
    where po.status <> 'cancelled'
      and coalesce(po.order_date, po.created_at::date) >= p_from
      and coalesce(po.order_date, po.created_at::date) <= p_to
      and (p_location is null or po.location_id = p_location)
    group by 1 order by 1;
end;
$$;

create or replace function public.analytics_inventory_movement(
  p_from date, p_to date, p_location uuid default null)
returns table(month date, qty_in numeric, qty_out numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('reports', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select date_trunc('month', sl.created_at)::date,
      coalesce(sum(sl.quantity) filter (
        where sl.movement_type in ('receipt', 'return', 'transfer_in', 'adjust_in')), 0)::numeric,
      coalesce(sum(sl.quantity) filter (
        where sl.movement_type in ('issue', 'transfer_out', 'adjust_out')), 0)::numeric
    from public.stock_ledger sl
    join public.stores s on s.id = sl.store_id
    where sl.created_at >= p_from and sl.created_at < (p_to + 1)
      and (p_location is null or s.location_id = p_location)
    group by 1 order by 1;
end;
$$;

create or replace function public.analytics_attendance(
  p_from date, p_to date, p_location uuid default null)
returns table(month date, present_days bigint, absent_days bigint,
              attendance_pct numeric, total_hours numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('reports', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select date_trunc('month', wa.work_date)::date,
      count(*) filter (where wa.present)::bigint,
      count(*) filter (where not wa.present)::bigint,
      round(avg(case when wa.present then 1 else 0 end) * 100, 1),
      coalesce(sum(wa.normal_hours + wa.ot_hours + wa.extra_hours), 0)::numeric
    from public.worker_attendance wa
    join public.workers w on w.id = wa.worker_id
    where wa.work_date >= p_from and wa.work_date <= p_to
      and (p_location is null or w.location_id = p_location)
    group by 1 order by 1;
end;
$$;

create or replace function public.analytics_production_efficiency(
  p_from date, p_to date, p_location uuid default null)
returns table(month date, good_qty numeric, reject_qty numeric, defect_pct numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('reports', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select date_trunc('month', pe.entry_date)::date,
      coalesce(sum(pe.good_qty), 0)::numeric,
      coalesce(sum(pe.reject_qty), 0)::numeric,
      round(coalesce(sum(pe.reject_qty), 0)::numeric
            / nullif(sum(pe.good_qty + pe.reject_qty), 0) * 100, 2)
    from public.production_entries pe
    left join public.production_lines pl on pl.id = pe.line_id
    where pe.status = 'confirmed'
      and pe.entry_date >= p_from and pe.entry_date <= p_to
      and (p_location is null or pl.location_id = p_location)
    group by 1 order by 1;
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'analytics_monthly_sales', 'analytics_top_customers', 'analytics_top_products',
    'analytics_revenue_trend', 'analytics_purchase_trend', 'analytics_inventory_movement',
    'analytics_attendance', 'analytics_production_efficiency'
  ] loop
    execute format('revoke execute on function public.%s(date, date, uuid) from public, anon', fn);
    execute format('grant execute on function public.%s(date, date, uuid) to authenticated', fn);
  end loop;
end $$;
