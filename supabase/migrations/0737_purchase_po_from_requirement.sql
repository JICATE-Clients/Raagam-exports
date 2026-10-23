-- 0737 · Purchase Order raised from an RE's requirement sheet (doc/purchase/puchase.md)
--
-- The PO screen the Purchase Manager uses: pick one or more RE numbers, the
-- requirement lines list themselves in PURCHASE units with the balance still to
-- buy, and the manager types the rate. Four things here, each one the spec asks
-- the database to hold rather than the screen:
--
--   1. THE VENDOR IS THE MASTER DATA VENDOR. `purchase_orders.vendor_id` points
--      at the old purchase-side `vendors` table and is NOT NULL. The new screen
--      picks from `master_vendors` (where `is_bought_items_vendor` and the item
--      classes in `master_vendor_item_categories` live — spec point 2), so the
--      PO gains `master_vendor_id` and exactly ONE of the two is required. The
--      older PO screens keep writing `vendor_id` unchanged.
--   2. A PO LINE REMEMBERS WHICH REQUIREMENT IT BUYS: `garment_order_id` (the RE)
--      and `req_key` (item | slice | colour). Requirement ROWS are rebuilt every
--      time a BOM recalculates, so their ids cannot be the link; the key can.
--      `sales_order_id` is filled as well — T&A and profitability read it.
--   3. THE BALANCE AND THE BUDGET ARE READ BY SECURITY DEFINER FUNCTIONS. A
--      Purchase Manager need not hold `orders:view`, and the approved budget
--      rate must never reach the browser (spec point 7). So the screen gets a
--      balance per requirement and a yes/no per line — never a budget figure.
--      Each function checks `materials_purchase` itself and scopes rows through
--      `has_order_access`, because a definer reads past RLS.
--   4. GST on the PO header (slab + CGST/SGST vs IGST + amount).

-- ---------- 1 · vendor ----------
alter table public.purchase_orders
  add column if not exists master_vendor_id uuid references public.master_vendors(id);
alter table public.purchase_orders alter column vendor_id drop not null;
alter table public.purchase_orders drop constraint if exists purchase_orders_one_vendor;
alter table public.purchase_orders
  add constraint purchase_orders_one_vendor
  check ((vendor_id is not null) <> (master_vendor_id is not null));
create index if not exists purchase_orders_master_vendor_idx on public.purchase_orders(master_vendor_id);

-- ---------- 4 · GST ----------
alter table public.purchase_orders
  add column if not exists gst_pct numeric(5,2),
  add column if not exists gst_kind text,
  add column if not exists gst_amount numeric(16,2);
alter table public.purchase_orders drop constraint if exists purchase_orders_gst_kind_check;
alter table public.purchase_orders
  add constraint purchase_orders_gst_kind_check check (gst_kind is null or gst_kind in ('cgst_sgst', 'igst'));

-- ---------- 2 · the line's requirement ----------
alter table public.po_line_items
  add column if not exists garment_order_id uuid references public.garment_order_amendments(id),
  add column if not exists req_key text;
create index if not exists po_line_items_requirement_idx on public.po_line_items(garment_order_id, req_key);

-- ---------- 3a · the requirement, in purchase units, with its balance ----------
-- One row per (RE, item, slice, colour, unit). A row the Material BOM converted
-- to the unit it is bought in (purchase_qty + a different purchase_uom_id) is
-- counted in that unit — the same rule the Order Budget pull uses (f13919fe).
-- ORDERED counts every PO line on the key whose PO is not cancelled, drafts
-- included, so two managers cannot both order the same balance.
create or replace function public.po_requirement_lines(p_order_ids uuid[] default null)
returns table (
  garment_order_id uuid,
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
  with req as (
    select
      a.garment_order_id,
      g.sales_order_id,
      r.item_id,
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
      and (p_order_ids is null or a.garment_order_id = any (p_order_ids))
      and public.has_permission('materials_purchase', 'view')
      and public.has_order_access(g.sales_order_id)
  ),
  grp as (
    select
      garment_order_id, sales_order_id, item_id, slice_label, colour, uom_id,
      upper(item_id::text || '|' || slice_label || '|' || coalesce(colour, '')) as req_key,
      sum(qty) as required_qty
    from req
    group by 1, 2, 3, 4, 5, 6
  ),
  ord as (
    select l.garment_order_id, l.req_key, sum(l.quantity) as q
    from public.po_line_items l
    join public.purchase_orders p on p.id = l.purchase_order_id
    where p.status <> 'cancelled' and l.req_key is not null
    group by 1, 2
  )
  select
    grp.garment_order_id,
    grp.sales_order_id,
    so.order_number,
    cu.name,
    g.delivery_date,
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
  join public.garment_order_amendments g on g.id = grp.garment_order_id
  left join public.sales_orders so on so.id = grp.sales_order_id
  left join public.customers cu on cu.id = g.customer_id
  join public.items i on i.id = grp.item_id
  left join public.config_lookups cls on cls.id = i.item_class_id
  left join public.uoms u on u.id = grp.uom_id
  left join ord on ord.garment_order_id = grp.garment_order_id and ord.req_key = grp.req_key
  order by so.order_number, cls.name, i.name, grp.slice_label, grp.colour
$$;

-- ---------- 3b · bought-item vendors for a class, with their on-time record ----------
-- On time = received on or before the PO line's promised delivery date, over
-- every received line of that vendor's POs. No history reads as NULL, never 100.
create or replace function public.po_vendors_for_class(p_item_class_id uuid)
returns table (id uuid, code text, name text, lead_days integer, on_time_pct numeric, received_lines integer)
language sql
stable
security definer
set search_path = public
as $$
  with v as (
    select mv.id, mv.code, mv.name, min(c.lead_days) as lead_days
    from public.master_vendors mv
    join public.master_vendor_item_categories c on c.vendor_id = mv.id and c.item_class_id = p_item_class_id
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
         coalesce(hist.n, 0)::integer
  from v left join hist on hist.vendor_id = v.id
  order by v.name
$$;

-- ---------- 3c · the hidden budget check ----------
-- In: [{key, garment_order_id, item_id, uom_id, slice_label, colour, rate}].
-- Out: per key, whether an APPROVED budget prices this line, and whether the
-- rate is above it. The budget figure itself never leaves the function.
-- Matching: the approved budget's material lines on the same RE, item and unit;
-- where there are several (one item in several slices or colours), the one
-- whose description names the slice and colour; a single line is used as is;
-- anything ambiguous counts as "no approved budget" — the safe answer, since
-- that sends the PO to the MD.
create or replace function public.po_budget_check(p_lines jsonb)
returns table (key text, has_budget boolean, above boolean)
language sql
stable
security definer
set search_path = public
as $$
  with inp as (
    select
      x->>'key' as key,
      (x->>'garment_order_id')::uuid as garment_order_id,
      (x->>'item_id')::uuid as item_id,
      nullif(x->>'uom_id', '')::uuid as uom_id,
      upper(coalesce(x->>'slice_label', '')) as slice_label,
      upper(coalesce(x->>'colour', '')) as colour,
      nullif(x->>'rate', '')::numeric as rate
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
    where public.has_permission('materials_purchase', 'view')
  ),
  cand as (
    select inp.key, bl.rate, upper(coalesce(bl.description, '')) as d
    from inp
    join public.order_budget_orders bo on bo.garment_order_id = inp.garment_order_id
    join public.order_budgets b on b.id = bo.budget_id and b.status = 'approved'
    join public.order_budget_lines bl
      on bl.budget_id = b.id
     and bl.source = 'material'
     and bl.garment_order_id = inp.garment_order_id
     and bl.item_id = inp.item_id
     and bl.uom_id is not distinct from inp.uom_id
     and bl.rate is not null
  ),
  pick as (
    select inp.key,
      coalesce(
        (select max(c.rate) from cand c
          where c.key = inp.key
            and (inp.slice_label = '' or position(inp.slice_label in c.d) > 0)
            and (inp.colour = '' or position(inp.colour in c.d) > 0)
          having count(*) = 1),
        (select max(c.rate) from cand c where c.key = inp.key having count(*) = 1)
      ) as budget_rate
    from inp
  )
  select inp.key,
         pick.budget_rate is not null,
         case when pick.budget_rate is null or inp.rate is null then false
              else inp.rate > pick.budget_rate end
  from inp join pick on pick.key = inp.key
$$;

-- AGENTS.md "Function grants": both halves, then the one role that may call.
revoke all on function public.po_requirement_lines(uuid[]) from public, anon;
revoke all on function public.po_vendors_for_class(uuid) from public, anon;
revoke all on function public.po_budget_check(jsonb) from public, anon;
grant execute on function public.po_requirement_lines(uuid[]) to authenticated;
grant execute on function public.po_vendors_for_class(uuid) to authenticated;
grant execute on function public.po_budget_check(jsonb) to authenticated;
