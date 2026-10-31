-- 0775 — Greige fabric carries no colour on Raise PO (user 2026-10-31).
--
-- Yarn and greige fabric are bought grey; the colourway is the dyer's business, not
-- the supplier's. Yarn lines already had no colour (0759). A greige-fabric line took
-- the order's colourway (`r.combo`) as its colour, so the Purchase Manager read
-- "DIA 30 · WHITE" on cloth that is not white, and the same greige fabric was split
-- into one line per colourway. Now:
--   • greige_purchase → colour NULL; one line per fabric × dia, summed across colourways;
--   • dyed_purchase   → colour = the approved colourway, unchanged (read-only on screen,
--                       as every requirement line's colour already is).
-- The req_key follows (item | slice | colour), so po_fabric_specs is rebuilt on the same
-- rule and the PO lines already raised on greige fabric are re-keyed to match — otherwise
-- their quantity would stop counting as ordered and the balance would reopen.
-- Their DESCRIPTION is not touched: an approved PO keeps saying what it said.

create or replace function public.po_requirement_lines(p_source_ids uuid[] default null)
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
  -- THE ORDER'S CURRENT FABRIC BOM: its latest NON-DRAFT one, the rule
  -- `currentFabricBom()` (lib/orders/fabric-requirement/service.ts) applies for every
  -- Fabric BOM report, so a PO is raised against the revision the reports print.
  fab_bom as (
    select distinct on (b.garment_order_id) b.id, b.garment_order_id
    from public.order_fabric_boms b
    where not b.is_draft
      and (p_source_ids is null or b.garment_order_id = any (p_source_ids))
    order by b.garment_order_id, b.bom_date desc nulls last, b.created_at desc
  ),
  yarn_req as (
    -- RE YARN (0759): the Fabric BOM's yarn purchase, kg — the figure the Yarn & Fabric
    -- Requirement report prints as TOTAL YARN PURCHASE REQUIREMENT. One line per yarn.
    select
      're'::text as kind, g.id as source_id, g.id as garment_order_id, null::uuid as iwo_id,
      g.sales_order_id, y.item_id,
      ''::text as slice_label,
      null::text as colour,
      null::uuid as size_id,
      y.uom_id,
      y.purchase_qty as qty
    from fab_bom fb
    join public.order_fabric_bom_yarns y on y.bom_id = fb.id
    join public.garment_order_amendments g on g.id = fb.garment_order_id and not g.is_draft
    where y.purchase_qty is not null and y.purchase_qty > 0
      and public.has_permission('materials_purchase', 'view')
      and public.has_order_access(g.sales_order_id)
  ),
  fabric_req as (
    -- RE FABRIC: every cloth the order's Fabric BOM BUYS AS CLOTH (0770) — its source
    -- is Greige or Dyed Fabric Purchase. A Yarn Purchase + Knitting fabric is bought as
    -- its yarn, in yarn_req above, never here too.
    -- One line per fabric × colourway × DIA, the report's own split: the dia is the
    -- Manual entry's for that size, so sizes knitted at one dia sum into one line.
    -- Kilograms, always (0562).
    select
      're'::text as kind, g.id as source_id, g.id as garment_order_id, null::uuid as iwo_id,
      g.sales_order_id, r.item_id,
      coalesce('DIA ' || nullif(trim(ms.dia), ''), '') as slice_label,
      -- GREIGE IS BOUGHT GREY (0775, user 2026-10-31): no colourway on its line, so
      -- one fabric × dia is ONE line across colourways. Dyed cloth keeps its shade.
      case when sc.source = 'dyed_purchase' then nullif(trim(r.combo), '') end as colour,
      null::uuid as size_id,
      r.consumption_uom_id as uom_id,
      r.required_qty as qty
    from fab_bom fb
    join public.order_fabric_bom_requirements r on r.bom_id = fb.id
    join public.garment_order_amendments g on g.id = fb.garment_order_id and not g.is_draft
    left join lateral (
      select s.dia from public.order_fabric_bom_manual_sizes s
      where s.entry_id = r.entry_id and s.size_id is not distinct from r.size_id
      order by s.sno limit 1
    ) ms on true
    join public.order_fabric_bom_process_scope sc
      on sc.bom_id = fb.id and sc.item_id = r.item_id
     and sc.source in ('greige_purchase', 'dyed_purchase')
    where r.required_qty is not null and r.required_qty > 0
      and public.has_permission('materials_purchase', 'view')
      and public.has_order_access(g.sales_order_id)
  ),
  req as (
    select * from re_req
    union all select * from iwo_req
    union all select * from yarn_req
    union all select * from fabric_req
  ),
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

create or replace function public.po_fabric_specs(p_source_ids uuid[] default null)
returns table (
  source_id   uuid,
  req_key     text,
  gsm         numeric,
  gauge       text,
  loop_length numeric
)
language sql
stable
security definer
set search_path = public
as $$
  -- The order's CURRENT Fabric BOM — the same rule 0760's `fab_bom` applies.
  with fab_bom as (
    select distinct on (b.garment_order_id) b.id, b.garment_order_id
    from public.order_fabric_boms b
    where not b.is_draft
      and (p_source_ids is null or b.garment_order_id = any (p_source_ids))
    order by b.garment_order_id, b.bom_date desc nulls last, b.created_at desc
  ),
  per_req as (
    select
      g.id as source_id,
      -- 0760's req_key, built from the same three parts the same way.
      upper(r.item_id::text || '|' ||
            coalesce('DIA ' || nullif(trim(ms.dia), ''), '') || '|' ||
            -- The colourway only on DYED cloth — greige has none (0775), the same
            -- rule po_requirement_lines builds its req_key by.
            case when exists (
              select 1 from public.order_fabric_bom_process_scope sc
              where sc.bom_id = fb.id and sc.item_id = r.item_id and sc.source = 'dyed_purchase'
            ) then coalesce(nullif(trim(r.combo), ''), '') else '' end) as req_key,
      st.gsm,
      gl.name as gauge,
      e.loop_length
    from fab_bom fb
    join public.order_fabric_bom_requirements r on r.bom_id = fb.id
    join public.garment_order_amendments g on g.id = fb.garment_order_id and not g.is_draft
    left join public.order_fabric_bom_manual_entries e on e.id = r.entry_id
    left join public.config_lookups gl on gl.id = e.gauge_id
    left join lateral (
      select s.dia from public.order_fabric_bom_manual_sizes s
      where s.entry_id = r.entry_id and s.size_id is not distinct from r.size_id
      order by s.sno limit 1
    ) ms on true
    -- GSM: the order's colourway × structure, for this entry's style (NULL = any).
    left join lateral (
      select max(cs.gsm) as gsm
      from public.garment_order_amendment_combos c
      join public.garment_order_amendment_combo_structures cs on cs.combo_id = c.id
      where c.amendment_id = g.id
        and upper(trim(c.combo)) = upper(trim(r.combo))
        and cs.structure_id = e.structure_id
        and (e.style_ref_no is null or c.style_ref_no is not distinct from e.style_ref_no)
      having count(distinct cs.gsm) = 1
    ) st on true
    where r.required_qty is not null and r.required_qty > 0
      and public.has_permission('materials_purchase', 'view')
      and public.has_order_access(g.sales_order_id)
  )
  select
    source_id,
    req_key,
    case when count(distinct gsm) = 1 then max(gsm) end,
    nullif(string_agg(distinct gauge, ' / '), ''),
    case when count(distinct loop_length) = 1 then max(loop_length) end
  from per_req
  group by source_id, req_key
$$;

revoke all on function public.po_fabric_specs(uuid[]) from public, anon;
grant execute on function public.po_fabric_specs(uuid[]) to authenticated;

-- Re-key greige-fabric PO lines raised before this: drop the trailing "|<colourway>".
-- THE CAP TRIGGER STANDS DOWN FOR THIS ONE STATEMENT. It re-reads po_requirement_lines,
-- which gates on has_permission() — and a migration runs as no user, so it sees an empty
-- sheet and refuses every line ("not on the requirement sheet"). The quantities are not
-- changing, only the key; checked by hand on 2026-10-31 (the one line, 50 kg, sits inside
-- its 270.75 kg greige DIA 30 requirement).
alter table public.po_line_items disable trigger trg_po_line_requirement_cap;

update public.po_line_items l
set req_key = regexp_replace(l.req_key, '\|[^|]*$', '|')
where l.garment_order_id is not null
  and l.req_key is not null
  and l.req_key !~ '\|$'
  and exists (
    select 1
    from public.order_fabric_boms b
    join public.order_fabric_bom_process_scope sc on sc.bom_id = b.id and sc.item_id = l.item_id
    where b.garment_order_id = l.garment_order_id and sc.source = 'greige_purchase'
  )
  and not exists (
    select 1
    from public.order_fabric_boms b
    join public.order_fabric_bom_process_scope sc on sc.bom_id = b.id and sc.item_id = l.item_id
    where b.garment_order_id = l.garment_order_id and sc.source = 'dyed_purchase'
  );

alter table public.po_line_items enable trigger trg_po_line_requirement_cap;
