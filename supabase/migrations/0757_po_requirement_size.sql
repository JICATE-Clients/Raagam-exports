-- 0757 · PO FROM REQUIREMENT: SIZE AS ITS OWN COLUMN (Size Breakup)
--
-- Raise PO groups a trim's sizes into ONE row with a Size Breakup pop-up (user
-- 2026-10-26) instead of a row per size. The size was only ever baked into
-- `slice_label` ("S", "WHITE · L"), so the screen could not tell which part was the
-- size. Four columns are added at the END of the row (so nothing reading the earlier
-- ones by position moves):
--
--   size_id     — the requirement's own size (material_bom_amendment_requirements.size_id);
--                 NULL on an IWO / SWO line, whose accessories plan has no size.
--   size_name   — that size's name.
--   size_sort   — the order's own size sequence (garment_order_amendment_style_sizes.sno),
--                 else the size-group master's sort_order; NULL sorts last.
--   slice_base  — the slice without its size part ("WHITE · L" → "WHITE"); the
--                 screen groups on item + slice_base + colour + unit.
--
-- `req_key` is UNCHANGED: it is still item | slice_label | colour, so every PO line
-- already saved keeps matching its requirement and every balance is the same.
-- Body otherwise identical to 0748. The return type changes, so drop and create;
-- `po_line_requirement_cap` calls it by name from plpgsql and needs no change.

drop function if exists public.po_requirement_lines(uuid[]);

create function public.po_requirement_lines(p_source_ids uuid[] default null)
returns table (
  source_kind text,
  source_id uuid,
  source_no text,
  garment_order_id uuid,
  iwo_id uuid,
  sales_order_id uuid,
  re_no text,
  customer text,
  delivery_date date,
  item_id uuid,
  item_name text,
  item_class_id uuid,
  item_class text,
  slice_label text,
  colour text,
  req_key text,
  uom_id uuid,
  uom_code text,
  required_qty numeric,
  ordered_qty numeric,
  balance_qty numeric,
  category_id uuid,
  category text,
  size_id uuid,
  size_name text,
  size_sort integer,
  slice_base text
)
language sql
stable
security definer
set search_path = public
as $$
  with re_req as (
    -- RE: the garment order's Material BOM (0737, unchanged)
    select
      're'::text as kind, a.garment_order_id as source_id, a.garment_order_id, null::uuid as iwo_id,
      g.sales_order_id, r.item_id,
      trim(r.slice_label) as slice_label,
      nullif(trim(c.name), '') as colour,
      r.size_id,
      case when r.purchase_qty is not null and r.purchase_uom_id is not null
                and r.purchase_uom_id is distinct from r.consumption_uom_id
           then r.purchase_uom_id else r.consumption_uom_id end as uom_id,
      case when r.purchase_qty is not null and r.purchase_uom_id is not null
                and r.purchase_uom_id is distinct from r.consumption_uom_id
           then r.purchase_qty else r.required_qty end as qty
    from public.material_bom_amendment_requirements r
    join public.material_bom_amendments a on a.id = r.amendment_id and not a.is_draft
    join public.garment_order_amendments g on g.id = a.garment_order_id and not g.is_draft
    left join public.config_lookups c on c.id = r.item_color_id
    where r.item_id is not null
      and r.required_qty is not null
      and (p_source_ids is null or a.garment_order_id = any (p_source_ids))
      and public.has_permission('materials_purchase', 'view')
      and public.has_order_access(g.sales_order_id)
  ),
  iwo_req as (
    -- IWO / SWO: the work order's accessories plan
    select
      case when sg.id is not null then 'swo' else 'iwo' end as kind,
      w.id as source_id, null::uuid as garment_order_id, w.id as iwo_id,
      null::uuid as sales_order_id, i.item_id,
      coalesce(trim(i.specification), '') as slice_label,
      nullif(trim(c.name), '') as colour,
      null::uuid as size_id,
      case when i.purchase_qty is not null and i.purchase_uom_id is not null
                and i.purchase_uom_id is distinct from i.consumption_uom_id
           then i.purchase_uom_id else i.consumption_uom_id end as uom_id,
      case when i.purchase_qty is not null and i.purchase_uom_id is not null
                and i.purchase_uom_id is distinct from i.consumption_uom_id
           then i.purchase_qty else i.required_qty end as qty
    from public.iwo_material_bom_items i
    join public.iwo_material_boms b on b.id = i.bom_id and not b.is_draft
    join public.internal_work_orders w on w.id = b.iwo_id
    left join public.sample_product_groups sg on sg.accessories_iwo_id = w.id
    left join public.config_lookups c on c.id = i.item_color_id
    where i.item_id is not null
      and i.required_qty is not null
      and not coalesce(i.is_advised, false)          -- an advised line is not settled yet (0586)
      and (not w.is_sample or b.approval_status = 'approved')
      and (p_source_ids is null or w.id = any (p_source_ids))
      and public.has_permission('materials_purchase', 'view')
      and public.is_current_location(w.location_id)
  ),
  req as (select * from re_req union all select * from iwo_req),
  grp as (
    select
      kind, source_id, garment_order_id, iwo_id, sales_order_id, item_id, slice_label, colour, uom_id,
      upper(item_id::text || '|' || slice_label || '|' || coalesce(colour, '')) as req_key,
      sum(qty) as required_qty,
      -- One slice is one size, so this is that size — taken, not grouped by, so the
      -- grouping (and with it every req_key a PO line already points at) is unchanged.
      (array_agg(size_id) filter (where size_id is not null))[1] as size_id
    from req
    group by kind, source_id, garment_order_id, iwo_id, sales_order_id, item_id, slice_label, colour, uom_id
  ),
  ord as (
    -- ORDERED = every live PO line on the key, LESS what a posted GRN rejected on it:
    -- rejected material re-opens its balance so a fresh PO can be raised (validation
    -- rules, user 2026-10-23 §1). A cancelled PO reopens all of it.
    select coalesce(l.garment_order_id, l.iwo_id) as source_id, l.req_key,
           sum(l.quantity - public.po_line_rejected_qty(l.id)) as q
    from public.po_line_items l
    join public.purchase_orders p on p.id = l.purchase_order_id
    where p.status <> 'cancelled' and l.req_key is not null
    group by 1, 2
  )
  select
    grp.kind,
    grp.source_id,
    case grp.kind
      when 're' then so.order_number
      when 'swo' then sg.group_code || ' · ' || w.code
      else w.code
    end,
    grp.garment_order_id,
    grp.iwo_id,
    grp.sales_order_id,
    so.order_number,
    case grp.kind
      when 're' then cu.name
      when 'swo' then nullif(trim(concat_ws(' ', 'Sample', sg.season, sg.season_year::text)), 'Sample')
      else nullif(trim(concat_ws(' · ', w.style_ref_no, w.reference_no)), '')
    end,
    case grp.kind when 're' then g.delivery_date else w.deli_date end,
    grp.item_id,
    i.name,
    i.item_class_id,
    cls.name,
    grp.slice_label,
    grp.colour,
    grp.req_key,
    grp.uom_id,
    u.code,
    grp.required_qty,
    coalesce(ord.q, 0),
    greatest(grp.required_qty - coalesce(ord.q, 0), 0),
    i.category_id,
    cat.name,
    grp.size_id,
    sz.name,
    -- The order's own size sequence first (what the merchandiser entered), then the
    -- size-group master; a size in neither sorts last, by name on the screen.
    coalesce(so_sz.sno, sg_sz.sort_order)::integer,
    -- The slice WITHOUT its size: "WHITE · L" → "WHITE", "S" → "". The size's exact name
    -- comes from its FK, so this drops that one part — never a guess at the text.
    case when sz.name is null then grp.slice_label
         else array_to_string(array_remove(string_to_array(grp.slice_label, ' · '), trim(sz.name)), ' · ')
    end
  from grp
  left join public.garment_order_amendments g on g.id = grp.garment_order_id
  left join public.sales_orders so on so.id = grp.sales_order_id
  left join public.customers cu on cu.id = g.customer_id
  left join public.internal_work_orders w on w.id = grp.iwo_id
  left join public.sample_product_groups sg on sg.accessories_iwo_id = grp.iwo_id
  join public.items i on i.id = grp.item_id
  left join public.config_lookups cls on cls.id = i.item_class_id
  left join public.categories cat on cat.id = i.category_id
  left join public.uoms u on u.id = grp.uom_id
  left join ord on ord.source_id = grp.source_id and ord.req_key = grp.req_key
  left join public.config_lookups sz on sz.id = grp.size_id
  left join lateral (
    select min(ss.sno) as sno from public.garment_order_amendment_style_sizes ss
    where ss.amendment_id = grp.garment_order_id and ss.size_id = grp.size_id
  ) so_sz on grp.size_id is not null
  left join lateral (
    select min(gs.sort_order) as sort_order from public.size_group_sizes gs where gs.size_id = grp.size_id
  ) sg_sz on grp.size_id is not null
  order by grp.kind, 3, cls.name, i.name, grp.slice_label, grp.colour
$$;

revoke all on function public.po_requirement_lines(uuid[]) from public, anon;
grant execute on function public.po_requirement_lines(uuid[]) to authenticated;
