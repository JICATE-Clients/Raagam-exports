-- 0761 — ABOVE-BUDGET ESCALATION: what the MD sees (user 2026-10-27).
--
-- A PO whose rate is above the approved order budget already waits for the MD
-- (Raise PO → `pending_approval`, 0737), and its print is already locked until
-- approval. What the MD could NOT see was the thing being decided: the budget
-- rate beside the quoted one, and what the difference costs the order.
--
-- 1. `po_budget_rate_core` — THE ONE MATCHING RULE. The body of 0738's
--    `po_budget_check` (exact description match, one candidate or none), now
--    returning the figure. Callable by no client role: only the two definer
--    wrappers below reach it, so the rule cannot fork into two copies.
-- 2. `po_budget_check` — recreated on the core from its LIVE body (0738),
--    unchanged in what it returns: the Purchase Manager still gets yes / no,
--    never the figure (spec point 7).
-- 3. `po_budget_rates` — the figure, for `materials_purchase:approve` only.
-- 4. `purchase_orders.budget_reason` — the Purchase Manager's optional remark
--    on why a rate is above budget, sent with the PO to the MD.

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
  select inp.key, inp.rate, pick.budget_rate
  from inp join pick on pick.key = inp.key
$$;
revoke all on function public.po_budget_rate_core(jsonb) from public, anon, authenticated;

create or replace function public.po_budget_check(p_lines jsonb)
returns table (key text, has_budget boolean, above boolean)
language sql stable security definer set search_path = public
as $$
  select c.key,
         c.budget_rate is not null,
         case when c.budget_rate is null or c.rate is null then false
              else c.rate > c.budget_rate end
  from public.po_budget_rate_core(p_lines) c
  where public.has_permission('materials_purchase', 'view')
$$;
revoke all on function public.po_budget_check(jsonb) from public, anon;
grant execute on function public.po_budget_check(jsonb) to authenticated;

create or replace function public.po_budget_rates(p_lines jsonb)
returns table (key text, budget_rate numeric)
language sql stable security definer set search_path = public
as $$
  select c.key, c.budget_rate
  from public.po_budget_rate_core(p_lines) c
  where public.has_permission('materials_purchase', 'approve')
$$;
revoke all on function public.po_budget_rates(jsonb) from public, anon;
grant execute on function public.po_budget_rates(jsonb) to authenticated;

alter table public.purchase_orders add column if not exists budget_reason text;
comment on column public.purchase_orders.budget_reason is
  'Purchase Manager''s remark on why a rate is above the approved budget (0761), shown to the MD.';
