-- 0740 · PO from Requirement lists RE, SWO and IWO requirements (user 2026-10-23,
-- screenshot 3698: "show full RE number … SWO, IWO also, all the three")
--
-- 0737's po_requirement_lines read only the garment orders' Material BOMs. Two
-- more documents carry accessories to buy, and both live in the IWO Material BOM
-- (iwo_material_boms → iwo_material_bom_items):
--
--   IWO — an internal work order's accessories plan (HO/IWO/…), once it is not a draft;
--   SWO — a sample work order (sample_product_groups, SWO/26-27/…) buys through its
--         accessories IWO (`accessories_iwo_id`, an SIW/…). Its plan must be APPROVED —
--         the sample plan's own PO gate (0718) — before anything is bought on it.
--
-- One function, three kinds, one shape: `source_kind` (re | iwo | swo), `source_id`
-- (the garment order or the IWO — what the screen picks and groups by) and
-- `source_no` (what the operator reads). A PO line keeps its link the way
-- po_line_items already allows — `sales_order_id` for an RE, `iwo_id` for an IWO
-- or SWO (chk_poli_one_source: never both).
--
-- Requirement and balance follow 0737 exactly: the PURCHASE unit where the plan
-- converted to one, ordered = every PO line on the key whose PO is not cancelled.
-- The return type changes, so the function is dropped and re-created; the grants
-- follow AGENTS.md "Function grants".

drop function if exists public.po_requirement_lines(uuid[]);

-- What posted GRNs rejected on one PO line (used by the balance and the cap below).
create or replace function public.po_line_rejected_qty(p_line_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(gl.rejected_qty), 0)
  from public.grn_line_items gl
  join public.grns g on g.id = gl.grn_id and g.status = 'posted'
  where gl.po_line_item_id = p_line_id
$$;

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
  balance_qty numeric
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
      sum(qty) as required_qty
    from req
    group by 1, 2, 3, 4, 5, 6, 7, 8, 9
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
    greatest(grp.required_qty - coalesce(ord.q, 0), 0)
  from grp
  left join public.garment_order_amendments g on g.id = grp.garment_order_id
  left join public.sales_orders so on so.id = grp.sales_order_id
  left join public.customers cu on cu.id = g.customer_id
  left join public.internal_work_orders w on w.id = grp.iwo_id
  left join public.sample_product_groups sg on sg.accessories_iwo_id = grp.iwo_id
  join public.items i on i.id = grp.item_id
  left join public.config_lookups cls on cls.id = i.item_class_id
  left join public.uoms u on u.id = grp.uom_id
  left join ord on ord.source_id = grp.source_id and ord.req_key = grp.req_key
  order by grp.kind, 3, cls.name, i.name, grp.slice_label, grp.colour
$$;

revoke all on function public.po_requirement_lines(uuid[]) from public, anon;
grant execute on function public.po_requirement_lines(uuid[]) to authenticated;

-- ---------- THE CAP, IN THE DATABASE (validation rules §1, "IF Order_Qty > Req_Balance ROLLBACK") ----------
-- The screen snaps an excess back and the save action refuses it; this is the guard
-- neither can be talked past — a stale tab, a second window, an import. A PO line that
-- names a requirement (`req_key`) may never take more than that requirement's balance,
-- counted WITHOUT this line itself (an edit to its own quantity is judged against what
-- every OTHER line has already taken). A line with no `req_key` — every PO raised on
-- the older screens — is untouched.
create or replace function public.po_line_requirement_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src uuid := coalesce(new.garment_order_id, new.iwo_id);
  v_required numeric;
  v_other numeric;
begin
  if new.req_key is null or v_src is null then
    return new;
  end if;

  select r.required_qty into v_required
  from public.po_requirement_lines(array[v_src]) r
  where r.req_key = new.req_key;

  if v_required is null then
    raise exception 'This line is not on the requirement sheet of its RE / SWO / IWO any more — reload the screen'
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(l.quantity - public.po_line_rejected_qty(l.id)), 0) into v_other
  from public.po_line_items l
  join public.purchase_orders p on p.id = l.purchase_order_id
  where p.status <> 'cancelled'
    and coalesce(l.garment_order_id, l.iwo_id) = v_src
    and l.req_key = new.req_key
    and l.id <> new.id;

  if new.quantity > greatest(v_required - v_other, 0) + 0.0001 then
    raise exception 'Order qty % is more than the % still to buy on this requirement — excess quantity is not allowed',
      new.quantity, greatest(v_required - v_other, 0)
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

drop trigger if exists trg_po_line_requirement_cap on public.po_line_items;
create trigger trg_po_line_requirement_cap
  before insert or update of quantity, req_key, garment_order_id, iwo_id on public.po_line_items
  for each row execute function public.po_line_requirement_cap();

revoke all on function public.po_line_rejected_qty(uuid) from public, anon;
grant execute on function public.po_line_rejected_qty(uuid) to authenticated;
revoke all on function public.po_line_requirement_cap() from public, anon;
