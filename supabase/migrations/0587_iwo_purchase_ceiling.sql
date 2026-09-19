-- 0587 — A work order's purchases are capped at its Material BOM (2026-09-19)
--
-- Client decision (2026-09-19): a purchase order for an Accessories work order
-- may not buy more of a material than the work order's Material BOM plans —
-- REFUSED OUTRIGHT, not warned. On a garment order the budget approval is the
-- financial lock and the ceiling bites only after it; a work order has no
-- budget, so its BOM's purchase quantity is the only approved figure it has.
--
-- The refusal lives in the purchase actions (`refuseOverCeiling`, the order
-- ceiling's own four write paths). This migration widens the read it needs.
--
-- iwo_purchase_check() gains two things and two parameters:
--
--   'lines'     — every Material BOM line naming a material: its purchase
--                 quantity (NULL where the BOM refused to calculate one) and the
--                 unit that quantity is in — the purchase unit, or the
--                 consumption unit when the line buys in that (0584 stores
--                 `purchase_uom_id` NULL for "no pack").
--   'committed' — what OTHER purchase orders already hold for this work order,
--                 per material, so a ceiling cannot be beaten by splitting one
--                 buy across two POs. Cancelled POs release their quantity;
--                 every other status holds it, a draft included — the order
--                 ceiling's rule (bom-ceiling-service.ts).
--   p_exclude_po / p_exclude_line — the same exclusions the order ceiling
--                 takes: submit judges a PO's own lines (so they must not count
--                 twice), an edit judges one line against its siblings.
--
-- STILL SECURITY DEFINER, for 0586's reason: read through RLS, a buyer without
-- Orders ▸ View sees no BOM, and a gate that sees nothing allows.
--
-- The one-argument form is DROPPED rather than overloaded: two signatures under
-- one name is a PostgREST call that resolves by which keys the caller happened
-- to send.

drop function if exists public.iwo_purchase_check(uuid);

create or replace function public.iwo_purchase_check(
  p_iwo_id uuid,
  p_exclude_po uuid default null,
  p_exclude_line uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'code', w.code,
    'iwo_for', w.iwo_for,
    'status', w.status,
    'bom', (
      select jsonb_build_object('is_draft', b.is_draft)
      from public.iwo_material_boms b
      where b.iwo_id = w.id
    ),
    'advised', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', i.item_id, 'name', it.name) order by i.sno)
      from public.iwo_material_boms b
      join public.iwo_material_bom_items i on i.bom_id = b.id
      left join public.items it on it.id = i.item_id
      where b.iwo_id = w.id
        and i.is_advised
        and i.item_id is not null
    ), '[]'::jsonb),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'item_id', i.item_id,
               'name', it.name,
               'purchase_qty', i.purchase_qty,
               'uom', u.code
             ) order by i.sno)
      from public.iwo_material_boms b
      join public.iwo_material_bom_items i on i.bom_id = b.id
      left join public.items it on it.id = i.item_id
      left join public.uoms u on u.id = coalesce(i.purchase_uom_id, i.consumption_uom_id)
      where b.iwo_id = w.id
        and i.item_id is not null
    ), '[]'::jsonb),
    'committed', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', c.item_id, 'qty', c.qty))
      from (
        select pl.item_id, sum(pl.quantity) as qty
        from public.po_line_items pl
        join public.purchase_orders po on po.id = pl.purchase_order_id
        where pl.iwo_id = w.id
          and pl.item_id is not null
          and po.status is distinct from 'cancelled'
          and (p_exclude_po is null or pl.purchase_order_id <> p_exclude_po)
          and (p_exclude_line is null or pl.id <> p_exclude_line)
        group by pl.item_id
      ) c
    ), '[]'::jsonb)
  )
  from public.internal_work_orders w
  where w.id = p_iwo_id
$$;

revoke all on function public.iwo_purchase_check(uuid, uuid, uuid) from public, anon;
grant execute on function public.iwo_purchase_check(uuid, uuid, uuid) to authenticated;

do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'iwo_purchase_check') <> 1 then
    raise exception '0587: expected exactly one iwo_purchase_check';
  end if;
  if has_function_privilege('anon', 'public.iwo_purchase_check(uuid, uuid, uuid)', 'execute') then
    raise exception '0587: iwo_purchase_check is executable by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.iwo_purchase_check(uuid, uuid, uuid)', 'execute') then
    raise exception '0587: iwo_purchase_check is not executable by authenticated';
  end if;
end;
$$;
