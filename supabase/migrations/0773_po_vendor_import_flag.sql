-- 0773 · Raise PO: a class's vendors say whether they are IMPORT vendors.
--
-- User 2026-10-31 ("Complete Filter Workflow for the Raise PO Screen", step 6):
-- PO Type = Local lists local vendors; PO Type = Import lists only foreign ones.
-- The vendor's country is the fact — `master_vendors.country_id`. A vendor in INDIA
-- (code 'IN'), or with no country recorded, is LOCAL; any other country is IMPORT.
-- No country is local rather than "unknown": every bought-item vendor today is in
-- India, and a vendor nobody filled a country for is not a foreign supplier.
--
-- Same body as 0737 plus one column, so the return type changes — drop and recreate,
-- then the two grants (AGENTS.md "Function grants": public AND anon, in one statement).

drop function if exists public.po_vendors_for_class(uuid);

create function public.po_vendors_for_class(p_item_class_id uuid)
returns table (id uuid, code text, name text, lead_days integer, on_time_pct numeric, received_lines integer, is_import boolean)
language sql
stable
security definer
set search_path = public
as $$
  with v as (
    select mv.id, mv.code, mv.name, min(c.lead_days) as lead_days,
           coalesce(bool_or(upper(coalesce(ctry.code, 'IN')) <> 'IN'), false) as is_import
    from public.master_vendors mv
    join public.master_vendor_item_categories c on c.vendor_id = mv.id and c.item_class_id = p_item_class_id
    left join public.countries ctry on ctry.id = mv.country_id
    where mv.is_bought_items_vendor
      and not coalesce(mv.inactive, false)
      and not coalesce(mv.is_draft, false)
      and public.has_permission('materials_purchase', 'view')
    group by mv.id, mv.code, mv.name
  ),
  hist as (
    select p.master_vendor_id as vendor_id,
           count(*) as n,
           count(*) filter (where first_grn.d <= l.delivery_date) as on_time
    from public.po_line_items l
    join public.purchase_orders p on p.id = l.purchase_order_id
    join lateral (
      select min(g.grn_date) as d
      from public.grn_line_items gl
      join public.grns g on g.id = gl.grn_id
      where gl.po_line_item_id = l.id
    ) first_grn on first_grn.d is not null
    where p.master_vendor_id in (select id from v) and l.delivery_date is not null
    group by 1
  )
  select v.id, v.code, v.name, v.lead_days,
         case when hist.n > 0 then round(100.0 * hist.on_time / hist.n, 0) end,
         coalesce(hist.n, 0)::integer,
         v.is_import
  from v left join hist on hist.vendor_id = v.id
  order by v.name
$$;

revoke all on function public.po_vendors_for_class(uuid) from public, anon;
grant execute on function public.po_vendors_for_class(uuid) to authenticated;
