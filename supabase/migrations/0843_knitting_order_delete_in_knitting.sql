-- ============================================================================
-- 0843 · DELETE AN "IN KNITTING" ORDER FROM THE LIST, IN ONE CLICK
--
-- User 2026-11-14: KO/26-27/0003 and 0004 (ROJA FAB, yarn sent, nothing back)
-- had to be deleted — "now delete it and give access in ui for delete". The bin
-- on an In Knitting row was greyed: the operator had to open the order, undo
-- its yarn DC (0841), go back to the list, and only then delete.
--
-- Now `knitting_order_delete` does those steps itself, in ONE transaction:
--   1. each SENT yarn DC on the order is undone through `knitting_dc_undo`
--      (0841) — the yarn goes back to the bin it left, the DC is cancelled;
--   2. the order (now Issued) and its DCs are deleted as before.
-- Every refusal is the undo's own sentence, and refusing rolls the whole call
-- back, so nothing is half-done:
--   - fabric received, yarn returned or moved at the knitter → "delete those first";
--   - a DC that moved yarn between two orders, or carries another order's yarn;
--   - an order closed, cancelled-with-history or waiting for the MD.
-- Undoing needs stores:edit (the undo's own check) on top of stores:delete.
--
-- Body = 0841's, with step 1 added before the status check. Nothing else moved.
-- ============================================================================

create or replace function public.knitting_order_delete(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  v_dcs uuid[];
  v_dc uuid;
begin
  if not public.has_permission('stores', 'delete') then
    raise exception 'You do not have permission to delete a knitting order' using errcode = '42501';
  end if;
  select * into o from public.process_orders where id = p_order_id for update;
  if not found or o.process_type <> 'knitting' then
    raise exception 'Knitting order not found' using errcode = 'P0002';
  end if;
  if not public.is_current_location(o.location_id) then
    raise exception 'A knitting order is deleted in its own unit — switch unit in the top bar' using errcode = '42501';
  end if;

  -- 0843: yarn at the knitter, nothing back — undo each sent DC first (yarn back to its bin).
  if o.status in ('in_process', 'partially_received') then
    for v_dc in
      select distinct x.delivery_challan_id
        from public.dc_line_items x
        join public.process_order_lines pol on pol.id = x.process_order_line_id
        join public.delivery_challans d on d.id = x.delivery_challan_id
       where pol.process_order_id = o.id and d.status = 'issued'
    loop
      perform public.knitting_dc_undo(v_dc);
    end loop;
    select * into o from public.process_orders where id = p_order_id;
  end if;

  if o.status not in ('draft', 'issued', 'cancelled') then
    raise exception '% still has yarn or fabric at the knitter — delete its receipts first, or close it', coalesce(o.code, 'This order')
      using errcode = 'P0001';
  end if;

  select array_agg(distinct x.delivery_challan_id) into v_dcs
    from public.dc_line_items x join public.process_order_lines pol on pol.id = x.process_order_line_id
   where pol.process_order_id = o.id;
  if v_dcs is not null then
    if exists (select 1 from public.delivery_challans where id = any (v_dcs) and status not in ('draft', 'cancelled')) then
      raise exception 'A yarn DC is out against % — undo it first', coalesce(o.code, 'this order') using errcode = 'P0001';
    end if;
    if exists (select 1 from public.dc_line_items x
                where x.delivery_challan_id = any (v_dcs)
                  and (x.process_order_line_id is null
                       or x.process_order_line_id not in (select id from public.process_order_lines where process_order_id = o.id))) then
      raise exception 'A DC on % also carries another knitting order''s yarn — cancel this order instead', coalesce(o.code, 'this order')
        using errcode = 'P0001';
    end if;
    delete from public.delivery_challans where id = any (v_dcs);   -- lines cascade
  end if;

  delete from public.process_orders where id = o.id;   -- fabric and yarn lines cascade
  return o.code;
end;
$$;

revoke all on function public.knitting_order_delete(uuid) from public, anon;
grant execute on function public.knitting_order_delete(uuid) to authenticated;
