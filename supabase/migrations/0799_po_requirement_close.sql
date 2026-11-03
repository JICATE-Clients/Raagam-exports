-- 0799 — Close a requirement balance on Raise PO (user 2026-11-03).
--
-- An RE needs 5,261 kg, a 5,000 kg PO is raised, and the 261 kg left stayed "to order"
-- on Raise PO and the RE's purchase status for ever: nothing let the Purchase Manager
-- say "we will not buy the rest". This adds that decision.
--
--   * po_requirement_closures: one row per closed line (source + req_key, the keys
--     po_requirement_lines and every PO line already use): the qty closed, a MANDATORY
--     reason, who and when. Reopening deletes the row and the balance comes back.
--   * po_requirement_lines: closed qty is subtracted from the balance exactly as ordered
--     qty is. Rebuilt from 0775's body (the latest, checked equal to the live function);
--     the RETURN TABLE is unchanged, because 0778 / 0780 / 0785 call it.
--   * po_requirement_close / po_requirement_reopen / po_requirement_closures_for:
--     SECURITY DEFINER, the only door to the table (no table policies at all), each
--     limited to lines po_requirement_lines already shows the caller, so a closure can
--     never reveal an order or unit the caller cannot see. Close / reopen need
--     materials_purchase:edit.
--
-- MANUAL ONLY (user 2026-11-03): no automatic close at 98%; every close is a person's
-- decision with a reason. A PO's UNRECEIVED balance is not this: Cancel Purchase Order
-- (0785) and GRN "Close balance" (0782) already close that.
-- Budget: nothing to release. An unordered balance committed no money.

create table if not exists public.po_requirement_closures (
  id          uuid primary key default gen_random_uuid(),
  -- po_requirement_lines.source_id: the RE's garment_order_amendments.id, or the IWO / SWO's
  -- internal_work_orders.id. Polymorphic like po_line_items' own source, so no FK.
  source_id   uuid not null,
  req_key     text not null,
  closed_qty  numeric not null check (closed_qty > 0),
  reason      text not null check (btrim(reason) <> ''),
  location_id uuid references public.locations(id) default public.current_location(),
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (source_id, req_key)
);
comment on table public.po_requirement_closures is
  'Short-closed requirement balances (0799). location-scope: exempt -- no policies; read and written only through SECURITY DEFINER functions that filter by po_requirement_lines visibility.';
alter table public.po_requirement_closures enable row level security;
-- No policies on purpose: the definer functions below are the only way in.

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
  ),
  closed as (
    -- SHORT-CLOSED (0799): balance the Purchase Manager decided not to buy, with a
    -- reason. Counted like ordered quantity, so the line leaves the to-order list and
    -- the cap trigger refuses a PO for it until it is reopened.
    select c.source_id, c.req_key, sum(c.closed_qty) as q
    from public.po_requirement_closures c
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
    greatest(grp.required_qty - coalesce(ord.q, 0) - coalesce(closed.q, 0), 0),
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
  left join closed on closed.source_id = grp.source_id and closed.req_key = grp.req_key
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

-- ---------------------------------------------------------------------------
-- Close: the line's whole remaining balance, with a reason.
create or replace function public.po_requirement_close(p_source_id uuid, p_req_key text, p_reason text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
begin
  if not public.has_permission('materials_purchase', 'edit') then
    raise exception 'You do not have permission to close a requirement balance';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Enter the reason for closing';
  end if;
  select l.balance_qty into v_balance
    from public.po_requirement_lines(array[p_source_id]) l
   where l.source_id = p_source_id and l.req_key = p_req_key;
  if v_balance is null then
    raise exception 'That requirement line was not found';
  end if;
  if v_balance <= 0.0005 then
    raise exception 'Nothing is left to close on this line';
  end if;
  insert into public.po_requirement_closures (source_id, req_key, closed_qty, reason)
  values (p_source_id, p_req_key, v_balance, btrim(p_reason))
  on conflict (source_id, req_key) do update
    set closed_qty = public.po_requirement_closures.closed_qty + excluded.closed_qty,
        reason     = excluded.reason,
        created_by = auth.uid(),
        created_at = now();
  return v_balance;
end
$$;

-- Reopen: the closure goes and the balance is to-order again.
create or replace function public.po_requirement_reopen(p_source_id uuid, p_req_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission('materials_purchase', 'edit') then
    raise exception 'You do not have permission to reopen a requirement balance';
  end if;
  if not exists (select 1 from public.po_requirement_lines(array[p_source_id]) l
                  where l.source_id = p_source_id and l.req_key = p_req_key) then
    raise exception 'That requirement line was not found';
  end if;
  delete from public.po_requirement_closures where source_id = p_source_id and req_key = p_req_key;
end
$$;

-- Read: the closures on the lines the caller can see, with the closer's name.
create or replace function public.po_requirement_closures_for(p_source_ids uuid[] default null)
returns table (source_id uuid, req_key text, closed_qty numeric, reason text, closed_by_name text, closed_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select c.source_id, c.req_key, c.closed_qty, c.reason, pr.full_name, c.created_at
  from public.po_requirement_closures c
  join public.po_requirement_lines(p_source_ids) l on l.source_id = c.source_id and l.req_key = c.req_key
  left join public.profiles pr on pr.id = c.created_by
$$;

revoke all on function public.po_requirement_close(uuid, text, text) from public, anon;
revoke all on function public.po_requirement_reopen(uuid, text) from public, anon;
revoke all on function public.po_requirement_closures_for(uuid[]) from public, anon;
grant execute on function public.po_requirement_close(uuid, text, text) to authenticated;
grant execute on function public.po_requirement_reopen(uuid, text) to authenticated;
grant execute on function public.po_requirement_closures_for(uuid[]) to authenticated;
