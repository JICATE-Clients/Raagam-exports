-- 0778 · GRN Phase 2 (doc/purchase/grn-plan.md): what the Receiving screen lists and filters.
--
-- Every line of every PO still open for receipt (approved / partially received), with the
-- facts the filter cascade reads (doc/purchase/grn.md §1):
--   Group Type → Buyer → Vendor → Item Class → RE / Order No
--
-- GROUP TYPE is read off the PO line's own source, as po_requirement_lines (0775) names it:
--   re      — the line carries a garment order (Material / Fabric BOM requirement)
--   swo     — an IWO that is a sample group's accessories IWO
--   iwo     — any other IWO
--   general — a PO line with no order behind it (raised on Purchase Orders)
-- BUYER and ORDER NO use the same expressions 0775 uses, so the GRN and Raise PO never
-- name one order two ways.
--
-- ONE ROUND TRIP. The screen used to read POs, then lines, then UOMs; the order, buyer and
-- class would have been three more serial reads (~260 ms each). SECURITY INVOKER: the
-- caller's own RLS still decides which POs (and so which unit's) they see.

create or replace function public.grn_open_po_lines()
returns table (
  id uuid,
  purchase_order_id uuid,
  po_code text,
  po_date date,
  master_vendor_id uuid,
  vendor_name text,
  tolerance_pct numeric,
  item_id uuid,
  description text,
  quantity numeric,
  received_qty numeric,
  uom_id uuid,
  uom_code text,
  sort_order integer,
  delivery_date date,
  group_kind text,
  order_id uuid,
  order_no text,
  buyer text,
  item_class_id uuid,
  item_class text,
  category text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    l.id,
    l.purchase_order_id,
    p.code,
    p.order_date,
    p.master_vendor_id,
    mv.name,
    coalesce(p.over_receipt_tolerance_pct, 3),
    l.item_id,
    l.description,
    coalesce(l.quantity, 0),
    coalesce(l.received_qty, 0),
    l.uom_id,
    u.code,
    coalesce(l.sort_order, 0),
    coalesce(l.delivery_date, p.expected_date),
    case
      when l.garment_order_id is not null then 're'
      when l.iwo_id is not null and sg.id is not null then 'swo'
      when l.iwo_id is not null then 'iwo'
      else 'general'
    end,
    coalesce(l.garment_order_id, l.iwo_id),
    case
      when l.garment_order_id is not null then so.order_number
      when sg.id is not null then sg.group_code || ' · ' || w.code
      else w.code
    end,
    case
      when l.garment_order_id is not null then cu.name
      when sg.id is not null then nullif(trim(concat_ws(' ', 'Sample', sg.season, sg.season_year::text)), 'Sample')
      else null
    end,
    i.item_class_id,
    coalesce(cls.name, nullif(l.item_class, '')),
    coalesce(cat.name, nullif(l.category, ''))
  from public.po_line_items l
  join public.purchase_orders p on p.id = l.purchase_order_id
  left join public.master_vendors mv on mv.id = p.master_vendor_id
  left join public.uoms u on u.id = l.uom_id
  left join public.items i on i.id = l.item_id
  left join public.config_lookups cls on cls.id = i.item_class_id
  left join public.categories cat on cat.id = i.category_id
  left join public.garment_order_amendments g on g.id = l.garment_order_id
  left join public.sales_orders so on so.id = coalesce(l.sales_order_id, g.sales_order_id)
  left join public.customers cu on cu.id = g.customer_id
  left join public.internal_work_orders w on w.id = l.iwo_id
  left join public.sample_product_groups sg on sg.accessories_iwo_id = l.iwo_id
  where p.status in ('approved', 'partially_received')
  order by p.created_at, l.sort_order
$$;

revoke all on function public.grn_open_po_lines() from public, anon;
grant execute on function public.grn_open_po_lines() to authenticated;
