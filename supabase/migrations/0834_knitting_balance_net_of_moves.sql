-- 0834 · An order's loss % leaves out the yarn moved on to another Knitting Order at the
-- knitter (0833). That kg is already off the balance (its DC lines count it as returned); it
-- must also come off what was "sent", or the loss reads too low on the order it left.
create or replace function public.knitting_order_balance(p_order_id uuid)
returns table (issued_kg numeric, balance_kg numeric, loss_pct numeric)
language sql
stable
security definer
set search_path = public
as $$
  with dc as (
    select coalesce(sum(x.sent_qty), 0) as sent,
           coalesce(sum(greatest(x.sent_qty - coalesce(x.returned_qty, 0) - coalesce(x.shortage_qty, 0), 0)), 0) as bal
      from public.dc_line_items x
      join public.delivery_challans d on d.id = x.delivery_challan_id
     where x.process_order_line_id in (select id from public.process_order_lines where process_order_id = p_order_id)
       and d.status not in ('draft', 'cancelled')
  ), moved as (
    select coalesce(sum(qty_kg), 0) as kg
      from public.knitting_receipt_yarns where process_order_id = p_order_id and kind = 'transferred'
  )
  select dc.sent - moved.kg,
         dc.bal,
         case when dc.sent - moved.kg > 0 then round(dc.bal / (dc.sent - moved.kg) * 100, 3) end
    from dc, moved;
$$;
revoke all on function public.knitting_order_balance(uuid) from public, anon;
grant execute on function public.knitting_order_balance(uuid) to authenticated;
