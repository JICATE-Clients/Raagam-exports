-- 0738 · po_budget_check matches the budget line by its EXACT name (fixes 0737)
--
-- 0737 matched a budget line when its description CONTAINED the slice text. A
-- size slice is one or two letters, so "L" was found inside "LABEL" and every
-- washcare-label size matched every other: five candidates, none unique, so the
-- line read "no approved budget" — and had it matched, it could have matched
-- the wrong size's rate. And a colour the budget line does not carry (it names
-- the colour only when one slice holds two — service.ts pullCostLines) excluded
-- the right line outright.
--
-- The budget pull writes a material line as `ITEM · SLICE` or
-- `ITEM · SLICE · COLOUR` (capitals on save). So a line matches when its
-- description IS one of those two strings. One match is the rate; none or
-- several is "no approved budget" — the safe answer, which routes to the MD.
create or replace function public.po_budget_check(p_lines jsonb)
returns table (key text, has_budget boolean, above boolean)
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
    where public.has_permission('materials_purchase', 'view')
  ),
  cand as (
    select inp.key, bl.rate
    from inp
    join public.items i on i.id = inp.item_id
    join public.order_budget_orders bo on bo.garment_order_id = inp.garment_order_id
    join public.order_budgets b on b.id = bo.budget_id and b.status = 'approved'
    join public.order_budget_lines bl
      on bl.budget_id = b.id
     and bl.source = 'material'
     and bl.garment_order_id = inp.garment_order_id
     and bl.item_id = inp.item_id
     and bl.uom_id is not distinct from inp.uom_id
     and bl.rate is not null
    where upper(trim(bl.description)) in (
      upper(i.name) || ' · ' || inp.slice_label,
      upper(i.name) || ' · ' || inp.slice_label || ' · ' || inp.colour
    )
  ),
  pick as (
    select inp.key,
      (select max(c.rate) from cand c where c.key = inp.key having count(*) = 1) as budget_rate
    from inp
  )
  select inp.key,
         pick.budget_rate is not null,
         case when pick.budget_rate is null or inp.rate is null then false
              else inp.rate > pick.budget_rate end
  from inp join pick on pick.key = inp.key
$$;

revoke all on function public.po_budget_check(jsonb) from public, anon;
grant execute on function public.po_budget_check(jsonb) to authenticated;
