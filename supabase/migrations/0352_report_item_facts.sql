-- ============================================================================
-- Raagam ERP — 0352 Report foundation (2/2): item fact + dimension model
--
-- One canonical fact source for everything that happens to a material, so every
-- item report is a *slice* of it rather than bespoke SQL. Before this, the only
-- aggregation in the whole DB was analytics_inventory_movement (month ×
-- qty_in/qty_out, no item breakdown) — there was no way to answer "what did we
-- purchase and consume, by item / class / category / attribute".
--
--   report_item_movements  — one row per movement, from every source
--   report_item_dimensions — one row per item: the full classification spine
--   report_item_summary    — grouped measures, grain = item × store × month
--   report_item_ledger     — the drill-down, row per movement
--   report_item_stock_as_of— balance + value at any date (replays the ledger)
--
-- The views are REVOKEd from clients: stock_ledger RLS demands
-- stores:view AND can_access_store(), which a reports-only user does not have,
-- so the SECURITY DEFINER RPCs are the only supported door in. Same reasoning
-- as 0042_analytics.sql.
-- ADD-ONLY.
-- ============================================================================

-- ============================================================================
-- Dimensions — one row per item
-- ============================================================================
create or replace view public.report_item_dimensions as
select
  i.id                                        as item_id,
  i.code                                      as item_code,
  i.name                                      as item_name,
  i.is_active                                 as item_active,
  i.material_type,
  i.hsn_code,
  i.item_class_id,
  ic.code                                     as item_class_code,
  ic.name                                     as item_class_name,
  i.category_id,
  c.name                                      as category_name,
  i.sub_category_id,
  sc.name                                     as sub_category_name,
  coalesce(i.stock_uom_id, i.base_uom_id, i.uom_id) as stock_uom_id,
  u.code                                      as stock_uom_code,
  -- Every answered material attribute as {attribute name: value}. Because
  -- item_attribute_values is generic, a NEW attribute defined in masters becomes
  -- a groupable report dimension with no migration and no code change.
  (
    select jsonb_object_agg(av.value, iav.value)
    from public.item_attribute_values iav
    join public.material_attribute_lines mal on mal.id = iav.attribute_line_id
    join public.attribute_values av on av.id = mal.attribute_id
    where iav.item_id = i.id
      and iav.value is not null and btrim(iav.value) <> ''
      and av.value is not null
  )                                           as attributes
from public.items i
left join public.config_lookups ic on ic.id = i.item_class_id
left join public.categories c on c.id = i.category_id
left join public.category_sub_categories sc on sc.id = i.sub_category_id
left join public.uoms u on u.id = coalesce(i.stock_uom_id, i.base_uom_id, i.uom_id);

-- ============================================================================
-- Facts — one row per movement, from every source that touches a material
-- ============================================================================
create or replace view public.report_item_movements as

-- 1. The stock ledger: the spine. These are real, posted movements.
select
  sl.id                                       as fact_id,
  'stock_ledger'::text                        as fact_source,
  (case
     when sl.reference_type = 'opening_stock' then 'opening'
     when sl.movement_type = 'receipt'        then 'received'
     when sl.movement_type = 'issue'          then 'issued'
     when sl.movement_type = 'return'         then 'returned'
     else sl.movement_type
   end)::text                                 as fact_kind,
  (case
     when sl.movement_type in ('receipt','return','transfer_in','adjust_in')
       then 'in' else 'out'
   end)::text                                 as direction,
  true                                        as posts_to_ledger,
  sl.txn_date,
  sl.item_id,
  sl.uom_id,
  sl.quantity,
  sl.rate,
  sl.value,
  sl.store_id,
  sl.location_id,
  (case
     when g.id  is not null then 'vendor'
     when vr.id is not null then 'vendor'
     when cr.id is not null then 'buyer'
   end)::text                                 as party_type,
  coalesce(g.vendor_id, vr.vendor_id, cr.buyer_id) as party_id,
  coalesce(sl.reference_type, 'manual')::text as doc_type,
  sl.reference_id                             as doc_id,
  coalesce(g.code, vr.code, cr.code, mr.code) as doc_code,
  sl.note
from public.stock_ledger sl
left join public.grns g
  on g.id = sl.reference_id and sl.reference_type = 'grn'
left join public.vendor_returns vr
  on vr.id = sl.reference_id
 and sl.reference_type in ('vendor_return', 'vendor_return_replacement')
left join public.csp_receipts cr
  on cr.id = sl.reference_id and sl.reference_type = 'csp_receipt'
left join public.material_requisitions mr
  on mr.id = sl.reference_id and sl.reference_type = 'material_requisition'

union all

-- 2. Purchase orders: demand placed, not yet stock. Never posts to the ledger.
select
  pli.id,
  'po_line_items',
  'ordered',
  'neutral',
  false,
  coalesce(po.order_date, po.created_at::date),
  pli.item_id,
  pli.uom_id,
  pli.quantity,
  pli.unit_price,
  pli.amount,
  null::uuid,
  po.location_id,
  'vendor',
  po.vendor_id,
  'purchase_order',
  po.id,
  po.code,
  pli.description
from public.po_line_items pli
join public.purchase_orders po on po.id = pli.purchase_order_id
where po.status <> 'cancelled' and pli.item_id is not null

union all

-- 3. GRN lines as *documented*. Deliberately duplicated against the ledger's
--    'received' rows: GRN stock-in in grn-actions.ts is wrapped in a swallowed
--    try/catch, so the two can silently diverge. Reporting both is what makes
--    that divergence visible instead of invisible.
select
  gli.id,
  'grn_line_items',
  (case when k.kind = 'a' then 'grn_accepted' else 'grn_rejected' end),
  'neutral',
  false,
  g.grn_date,
  pli.item_id,
  pli.uom_id,
  (case when k.kind = 'a' then gli.accepted_qty else gli.rejected_qty end),
  pli.unit_price,
  round(pli.unit_price *
        (case when k.kind = 'a' then gli.accepted_qty else gli.rejected_qty end), 2),
  null::uuid,
  g.location_id,
  'vendor',
  g.vendor_id,
  'grn',
  g.id,
  g.code,
  gli.description
from public.grn_line_items gli
join public.grns g on g.id = gli.grn_id
join public.po_line_items pli on pli.id = gli.po_line_item_id
cross join (values ('a'), ('r')) as k(kind)
where g.status = 'posted'
  and pli.item_id is not null
  and coalesce(case when k.kind = 'a' then gli.accepted_qty else gli.rejected_qty end, 0) > 0

union all

-- 4. BOM amendments: planned/standard consumption (per-piece × order qty).
select
  mbai.id,
  'material_bom_amendment_items',
  'planned',
  'neutral',
  false,
  coalesce(mba.amend_date, mba.created_at::date),
  mbai.item_id,
  mbai.consumption_uom_id,
  coalesce(mbai.quantity_nos, 0) * coalesce(so.order_qty, 0),
  null::numeric,
  null::numeric,
  null::uuid,
  so.location_id,
  'vendor',
  mbai.vendor_id,
  'material_bom_amendment',
  mba.id,
  mba.code,
  null
from public.material_bom_amendment_items mbai
join public.material_bom_amendments mba on mba.id = mbai.amendment_id
left join public.sales_orders so on so.id = mba.sales_order_id
where mba.is_draft is not true and mbai.item_id is not null

union all

-- 5. Delivery challans: material sitting at a processor. OFF-BOOK — dc_line_items
--    never posts a stock movement, so this material is invisible to stock_balances.
select
  dli.id,
  'dc_line_items',
  (case when k.kind = 's' then 'sent_out' else 'came_back' end),
  (case when k.kind = 's' then 'out' else 'in' end),
  false,
  dc.dc_date,
  dli.item_id,
  dli.uom_id,
  (case when k.kind = 's' then dli.sent_qty else dli.returned_qty end),
  null::numeric,
  null::numeric,
  null::uuid,
  dc.location_id,
  'vendor',
  dc.vendor_id,
  'delivery_challan',
  dc.id,
  dc.code,
  dli.description
from public.dc_line_items dli
join public.delivery_challans dc on dc.id = dli.delivery_challan_id
cross join (values ('s'), ('r')) as k(kind)
where dli.item_id is not null
  and coalesce(case when k.kind = 's' then dli.sent_qty else dli.returned_qty end, 0) > 0;

-- The views are the RPCs' private plumbing, not a client surface.
revoke all on public.report_item_movements  from public, anon, authenticated;
revoke all on public.report_item_dimensions from public, anon, authenticated;

-- ============================================================================
-- RPCs — the only supported client surface. Each self-gates on reports:view.
-- ============================================================================

-- Grouped measures at the finest useful grain (item × store × month) with every
-- dimension key attached. Deliberately NO dynamic `group by`: rolling up onto a
-- chosen dimension happens in TS (lib/reports/rollup.ts), which keeps this
-- injection-free and lets the user re-pivot without another round-trip.
create or replace function public.report_item_summary(
  p_from date, p_to date,
  p_location uuid default null, p_store uuid default null,
  p_item_class uuid default null, p_category uuid default null,
  p_sub_category uuid default null, p_item uuid default null,
  p_vendor uuid default null)
returns table(
  month date, item_id uuid, store_id uuid,
  item_code text, item_name text,
  item_class_id uuid, item_class_name text,
  category_id uuid, category_name text,
  sub_category_id uuid, sub_category_name text,
  location_id uuid, stock_uom_code text, attributes jsonb,
  qty_ordered numeric, qty_opening numeric,
  qty_received numeric, qty_grn_accepted numeric, qty_grn_rejected numeric,
  qty_issued numeric, qty_returned numeric,
  qty_transfer_in numeric, qty_transfer_out numeric,
  qty_adjust_in numeric, qty_adjust_out numeric,
  qty_planned numeric, qty_sent_out numeric, qty_came_back numeric,
  qty_in numeric, qty_out numeric, qty_net numeric,
  value_ordered numeric, value_purchased numeric, value_consumed numeric,
  value_in numeric, value_out numeric, value_net numeric,
  movements bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('reports', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select
      date_trunc('month', m.txn_date)::date, m.item_id, m.store_id,
      d.item_code, d.item_name,
      d.item_class_id, d.item_class_name,
      d.category_id, d.category_name,
      d.sub_category_id, d.sub_category_name,
      m.location_id, d.stock_uom_code, d.attributes,
      coalesce(sum(m.quantity) filter (where m.fact_kind = 'ordered'), 0)::numeric,
      coalesce(sum(m.quantity) filter (where m.fact_kind = 'opening'), 0)::numeric,
      coalesce(sum(m.quantity) filter (where m.fact_kind = 'received'), 0)::numeric,
      coalesce(sum(m.quantity) filter (where m.fact_kind = 'grn_accepted'), 0)::numeric,
      coalesce(sum(m.quantity) filter (where m.fact_kind = 'grn_rejected'), 0)::numeric,
      coalesce(sum(m.quantity) filter (where m.fact_kind = 'issued'), 0)::numeric,
      coalesce(sum(m.quantity) filter (where m.fact_kind = 'returned'), 0)::numeric,
      coalesce(sum(m.quantity) filter (where m.fact_kind = 'transfer_in'), 0)::numeric,
      coalesce(sum(m.quantity) filter (where m.fact_kind = 'transfer_out'), 0)::numeric,
      coalesce(sum(m.quantity) filter (where m.fact_kind = 'adjust_in'), 0)::numeric,
      coalesce(sum(m.quantity) filter (where m.fact_kind = 'adjust_out'), 0)::numeric,
      coalesce(sum(m.quantity) filter (where m.fact_kind = 'planned'), 0)::numeric,
      coalesce(sum(m.quantity) filter (where m.fact_kind = 'sent_out'), 0)::numeric,
      coalesce(sum(m.quantity) filter (where m.fact_kind = 'came_back'), 0)::numeric,
      coalesce(sum(m.quantity) filter (where m.posts_to_ledger and m.direction = 'in'), 0)::numeric,
      coalesce(sum(m.quantity) filter (where m.posts_to_ledger and m.direction = 'out'), 0)::numeric,
      (coalesce(sum(m.quantity) filter (where m.posts_to_ledger and m.direction = 'in'), 0)
       - coalesce(sum(m.quantity) filter (where m.posts_to_ledger and m.direction = 'out'), 0))::numeric,
      coalesce(sum(m.value) filter (where m.fact_kind = 'ordered'), 0)::numeric,
      coalesce(sum(m.value) filter (where m.fact_kind in ('received','opening')), 0)::numeric,
      coalesce(sum(m.value) filter (where m.fact_kind = 'issued'), 0)::numeric,
      coalesce(sum(m.value) filter (where m.posts_to_ledger and m.direction = 'in'), 0)::numeric,
      coalesce(sum(m.value) filter (where m.posts_to_ledger and m.direction = 'out'), 0)::numeric,
      (coalesce(sum(m.value) filter (where m.posts_to_ledger and m.direction = 'in'), 0)
       - coalesce(sum(m.value) filter (where m.posts_to_ledger and m.direction = 'out'), 0))::numeric,
      count(*)::bigint
    from public.report_item_movements m
    join public.report_item_dimensions d on d.item_id = m.item_id
    where m.txn_date >= p_from and m.txn_date <= p_to
      and (p_location     is null or m.location_id      = p_location)
      and (p_store        is null or m.store_id         = p_store)
      and (p_item_class   is null or d.item_class_id    = p_item_class)
      and (p_category     is null or d.category_id      = p_category)
      and (p_sub_category is null or d.sub_category_id  = p_sub_category)
      and (p_item         is null or m.item_id          = p_item)
      and (p_vendor       is null or (m.party_type = 'vendor' and m.party_id = p_vendor))
    group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14
    order by 5, 1;
end;
$$;

-- Drill-down: one row per movement behind any summary cell.
create or replace function public.report_item_ledger(
  p_from date, p_to date,
  p_location uuid default null, p_store uuid default null,
  p_item_class uuid default null, p_category uuid default null,
  p_sub_category uuid default null, p_item uuid default null,
  p_vendor uuid default null, p_fact_kind text default null)
returns table(
  fact_id uuid, fact_source text, fact_kind text, direction text,
  posts_to_ledger boolean, txn_date date,
  item_id uuid, item_code text, item_name text,
  item_class_name text, category_name text, sub_category_name text,
  store_id uuid, store_name text, location_id uuid,
  uom_code text, quantity numeric, rate numeric, value numeric,
  party_type text, party_name text,
  doc_type text, doc_id uuid, doc_code text, note text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('reports', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select
      m.fact_id, m.fact_source, m.fact_kind, m.direction,
      m.posts_to_ledger, m.txn_date,
      m.item_id, d.item_code, d.item_name,
      d.item_class_name, d.category_name, d.sub_category_name,
      m.store_id, s.name, m.location_id,
      u.code, m.quantity, m.rate, m.value,
      m.party_type,
      coalesce(v.name, b.name),
      m.doc_type, m.doc_id, m.doc_code, m.note
    from public.report_item_movements m
    join public.report_item_dimensions d on d.item_id = m.item_id
    left join public.stores s on s.id = m.store_id
    left join public.uoms u on u.id = m.uom_id
    left join public.vendors v on v.id = m.party_id and m.party_type = 'vendor'
    left join public.buyers b on b.id = m.party_id and m.party_type = 'buyer'
    where m.txn_date >= p_from and m.txn_date <= p_to
      and (p_location     is null or m.location_id     = p_location)
      and (p_store        is null or m.store_id        = p_store)
      and (p_item_class   is null or d.item_class_id   = p_item_class)
      and (p_category     is null or d.category_id     = p_category)
      and (p_sub_category is null or d.sub_category_id = p_sub_category)
      and (p_item         is null or m.item_id         = p_item)
      and (p_vendor       is null or (m.party_type = 'vendor' and m.party_id = p_vendor))
      and (p_fact_kind    is null or m.fact_kind       = p_fact_kind)
    order by m.txn_date desc, d.item_name
    limit 5000;
end;
$$;

-- Stock as at any date, by replaying the ledger. stock_balances is current-only,
-- so this is the only way to get an opening balance or a back-dated position.
create or replace function public.report_item_stock_as_of(
  p_as_of date,
  p_location uuid default null, p_store uuid default null,
  p_item_class uuid default null, p_category uuid default null,
  p_sub_category uuid default null, p_item uuid default null)
returns table(
  item_id uuid, store_id uuid,
  item_code text, item_name text,
  item_class_id uuid, item_class_name text,
  category_id uuid, category_name text,
  sub_category_id uuid, sub_category_name text,
  location_id uuid, stock_uom_code text,
  quantity numeric, value numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission('reports', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select
      m.item_id, m.store_id,
      d.item_code, d.item_name,
      d.item_class_id, d.item_class_name,
      d.category_id, d.category_name,
      d.sub_category_id, d.sub_category_name,
      m.location_id, d.stock_uom_code,
      sum(case when m.direction = 'in' then m.quantity else -m.quantity end)::numeric,
      sum(case when m.direction = 'in' then coalesce(m.value, 0)
               else -coalesce(m.value, 0) end)::numeric
    from public.report_item_movements m
    join public.report_item_dimensions d on d.item_id = m.item_id
    where m.posts_to_ledger
      and m.txn_date <= p_as_of
      and (p_location     is null or m.location_id     = p_location)
      and (p_store        is null or m.store_id        = p_store)
      and (p_item_class   is null or d.item_class_id   = p_item_class)
      and (p_category     is null or d.category_id     = p_category)
      and (p_sub_category is null or d.sub_category_id = p_sub_category)
      and (p_item         is null or m.item_id         = p_item)
    group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
    having sum(case when m.direction = 'in' then m.quantity else -m.quantity end) <> 0
    order by 4;
end;
$$;

do $$
begin
  execute 'revoke execute on function public.report_item_summary(date,date,uuid,uuid,uuid,uuid,uuid,uuid,uuid) from public, anon';
  execute 'grant  execute on function public.report_item_summary(date,date,uuid,uuid,uuid,uuid,uuid,uuid,uuid) to authenticated';
  execute 'revoke execute on function public.report_item_ledger(date,date,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text) from public, anon';
  execute 'grant  execute on function public.report_item_ledger(date,date,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text) to authenticated';
  execute 'revoke execute on function public.report_item_stock_as_of(date,uuid,uuid,uuid,uuid,uuid,uuid) from public, anon';
  execute 'grant  execute on function public.report_item_stock_as_of(date,uuid,uuid,uuid,uuid,uuid,uuid) to authenticated';
end $$;
