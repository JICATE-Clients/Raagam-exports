-- ============================================================================
-- 0844 · CANCEL A KNITTING ORDER WITH YARN OUT — YARN BACK TO STOCK, FABRIC FREED
--
-- Session 4 spec (2026-11-14, "Order Reset Engine"): cancelling a Knitting Order
-- puts the yarn it issued back into store stock, and frees its RE fabric lines
-- for a new Knitting Order, with a reason.
--
-- The spec's own SQL named tables this app does not have (`knitting_programs`
-- went in 0828; `outward_dcs`, `bin_stock_ledger`, `re_fabric_requirements`
-- never existed). Mapped onto the real ones:
--
--   yarn re-credit → each SENT yarn DC on the order is undone by
--                    `knitting_dc_undo` (0841): the ledger rows are MIRRORED
--                    back to the store · bin · lot · owner they left. Stock is
--                    an append-only ledger here, never an UPDATE of a balance.
--   fabric freed   → nothing to write. A fabric slice counts as "programmed"
--                    only on a KO whose status is not 'cancelled'
--                    (knitting-service.ts loadKnitCandidates / getKnitOrderOptions),
--                    so the status change below is what releases it.
--   reason         → new `cancel_reason` / `cancelled_at` / `cancelled_by`.
--
-- Before this, Cancel was offered only while no yarn had gone out; the operator
-- had to undo each DC by hand first (0841). Now it is one call, one transaction.
--
-- REFUSED, nothing half-done (a refusal rolls the whole call back):
--   - fabric received / yarn returned / written off on the order → "full yarn
--     back" is no longer true; delete those receipts first, or Close the order;
--   - a DC that also carries ANOTHER Knitting Order's yarn (0832) — undoing it
--     would pull that order's yarn back too;
--   - yarn moved between orders at the knitter (the undo's own refusal);
--   - closed, already cancelled, or waiting for the MD.
-- ============================================================================

alter table public.process_orders
  add column if not exists cancel_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles (id);

comment on column public.process_orders.cancel_reason is
  'Why the order was cancelled (0844 knitting_order_cancel). Mandatory there.';

create or replace function public.knitting_order_cancel(p_order_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  v_dc record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.has_permission('stores', 'edit') then
    raise exception 'You do not have permission to cancel a knitting order' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Say why the knitting order is cancelled' using errcode = '22023';
  end if;

  select * into o from public.process_orders where id = p_order_id for update;
  if not found or o.process_type <> 'knitting' then
    raise exception 'Knitting order not found' using errcode = 'P0002';
  end if;
  if not public.is_current_location(o.location_id) then
    raise exception 'A knitting order is cancelled in its own unit — switch unit in the top bar' using errcode = '42501';
  end if;
  if coalesce(o.close_pending, false) then
    raise exception '% is waiting for the MD to close it — it cannot be cancelled', coalesce(o.code, 'This order') using errcode = 'P0001';
  end if;
  if o.status not in ('draft', 'issued', 'in_process', 'partially_received') then
    raise exception '% is % — only an open order can be cancelled', coalesce(o.code, 'This order'), o.status using errcode = 'P0001';
  end if;
  if exists (select 1 from public.knitting_receipts k where k.process_order_id = o.id) then
    raise exception 'Fabric or yarn has come back on % — delete its Fabric Receipts / Yarn Returns first, or close the order instead',
      coalesce(o.code, 'this order') using errcode = 'P0001';
  end if;

  -- Every live DC carrying this order's yarn (a DC may carry several orders — 0832).
  for v_dc in
    select distinct d.id, d.code, d.status
      from public.dc_line_items x
      join public.process_order_lines pol on pol.id = x.process_order_line_id
      join public.delivery_challans d on d.id = x.delivery_challan_id
     where pol.process_order_id = o.id and d.status <> 'cancelled'
  loop
    if exists (select 1 from public.dc_line_items x
                where x.delivery_challan_id = v_dc.id
                  and (x.process_order_line_id is null
                       or x.process_order_line_id not in (select id from public.process_order_lines where process_order_id = o.id))) then
      raise exception 'DC % also carries another knitting order''s yarn — undo that DC from its order first', coalesce(v_dc.code, '')
        using errcode = 'P0001';
    end if;
    if v_dc.status = 'issued' then
      perform public.knitting_dc_undo(v_dc.id);          -- yarn back to its store · bin · lot
    elsif v_dc.status = 'draft' then
      update public.delivery_challans set status = 'cancelled' where id = v_dc.id;   -- moved nothing
    else
      raise exception 'DC % is % — it cannot be taken back', coalesce(v_dc.code, ''), v_dc.status using errcode = 'P0001';
    end if;
  end loop;

  update public.process_orders
     set status = 'cancelled',
         cancel_reason = v_reason,
         cancelled_at = now(),
         cancelled_by = auth.uid()
   where id = o.id;
  return o.code;
end;
$$;

revoke all on function public.knitting_order_cancel(uuid, text) from public, anon;
grant execute on function public.knitting_order_cancel(uuid, text) to authenticated;

comment on function public.knitting_order_cancel(uuid, text) is
  'Cancel a knitting order (0844): every sent yarn DC undone through knitting_dc_undo (stock back to its bin), status cancelled with a reason; its fabric slices are free for a new KO.';
