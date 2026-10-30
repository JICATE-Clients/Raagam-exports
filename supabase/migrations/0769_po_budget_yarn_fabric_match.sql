-- 0769 — THE BUDGET CHECK READS YARN AND FABRIC LINES TOO (user 2026-10-30).
--
-- 0759/0760 put an order's Fabric BOM yarn and cloth on Raise PO, but the one matching
-- rule (`po_budget_rate_core`, 0761) still read only `source = 'material'` budget lines
-- — the Material BOM's. The Order Budget prices yarn as `source = 'yarn'` (description =
-- the yarn's name) and bought cloth as `source = 'fabric'` (description = "<fabric> ·
-- GREIGE FABRIC ROLL WEIGHT"), so every Yarn and Fabric line on an APPROVED budget read
-- "No budget" and went to the MD as unbudgeted.
--
-- Not the cause, checked: the rate compared is the typed rate × exchange rate, ex-GST
-- (2026-10-28) — no GST is added before the comparison.
--
-- The rule per source, each still "exactly one candidate, or none":
--   material — unchanged (0738): item + UOM + description "<item> · <slice>[ · <colour>]".
--   yarn     — item + UOM on the order. A yarn PO line has no slice; the budget holds one
--              line per yarn.
--   fabric   — item + UOM on the order. The PO line is split by DIA × colourway; the
--              budget prices the cloth once, so every slice of it reads that one rate.
-- A fabric the budget priced only as KNITTING / DYEING (`fabric_process`) — knitted
-- in-house from bought yarn — still reads "No budget" when bought as cloth: that is the
-- true answer, the budget never priced buying it.
--
-- Body otherwise identical to 0761 (the live body, checked 2026-10-30).

create or replace function public.po_budget_rate_core(p_lines jsonb)
returns table (key text, rate numeric, budget_rate numeric)
language sql stable security definer set search_path = public
as $$
  with inp as (
    select
      x->>'key' as key,
      (x->>'garment_order_id')::uuid as garment_order_id,
      (x->>'item_id')::uuid as item_id,
      nullif(x->>'uom_id', '')::uuid as uom_id,
      upper(trim(coalesce(x->>'slice_label', ''))) as slice_label,
      upper(trim(coalesce(x->>'colour', ''))) as colour,
      nullif(x->>'rate', '')::numeric as rate
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
  ),
  cand as (
    select inp.key, bl.rate
    from inp
    join public.items i on i.id = inp.item_id
    join public.order_budget_orders bo on bo.garment_order_id = inp.garment_order_id
    join public.order_budgets b on b.id = bo.budget_id and b.status = 'approved'
    join public.order_budget_lines bl
      on bl.budget_id = b.id
     and bl.source in ('material', 'yarn', 'fabric')
     and bl.garment_order_id = inp.garment_order_id
     and bl.item_id = inp.item_id
     and bl.uom_id is not distinct from inp.uom_id
     and bl.rate is not null
    where bl.source in ('yarn', 'fabric')
       or upper(trim(bl.description)) in (
            upper(i.name) || ' · ' || inp.slice_label,
            upper(i.name) || ' · ' || inp.slice_label || ' · ' || inp.colour
          )
  ),
  pick as (
    select inp.key,
      (select max(c.rate) from cand c where c.key = inp.key having count(*) = 1) as budget_rate
    from inp
  )
  select inp.key, inp.rate, pick.budget_rate
  from inp join pick on pick.key = inp.key
$$;
revoke all on function public.po_budget_rate_core(jsonb) from public, anon, authenticated;
