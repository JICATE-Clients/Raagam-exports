-- 0758 — YARN BAGS AND FABRIC ROLLS ON A PO LINE (user 2026-10-26, Raise PO Task 2).
--
-- YARN is delivered in whole bags (50 kg, 60 kg …) and a supplier will not break one
-- open, so the Purchase Manager types the Bag Weight and the No. of Bags and the PO
-- weight is their product. FABRIC is ordered by weight with its No. of Rolls and Dia.
--
--   bag_weight — kg in one bag (yarn); NULL when the line is not bought in bags.
--   bags       — whole bags ordered (yarn); quantity = bags × bag_weight.
--   dia        — the fabric's dia / width as the trade writes it ("30", "34 OPEN").
--   rolls      — already on the table since 0359 (int, default 0); now filled.
--
-- WHOLE BAGS MAY ROUND UP — BY LESS THAN ONE BAG (user decision 2026-10-26: "round
-- up, max one extra bag"). To Order 115 kg in 50 kg bags: 2 bags (100 kg) and 3 bags
-- (150 kg) save; 4 bags (200 kg) is refused. Stated as: a line whose quantity is
-- exactly bags × bag_weight may exceed what is still to buy by LESS than one bag
-- weight. Every other line keeps the hard cap of 0737 unchanged — "excess quantity is
-- not allowed" — because a bag is the only reason to go over.
--
-- `po_line_requirement_cap` is re-created FROM ITS LIVE BODY (read from the catalog
-- on 2026-10-26, last defined in 0740) with only the bag allowance added, so nothing
-- a later migration put into it can have been lost.

alter table public.po_line_items
  add column if not exists bag_weight numeric(10,3),
  add column if not exists bags       integer,
  add column if not exists dia        text;

alter table public.po_line_items
  drop constraint if exists chk_poli_bags;
alter table public.po_line_items
  add constraint chk_poli_bags check (
    (bag_weight is null or bag_weight > 0)
    and (bags is null or bags >= 0)
    -- a bag count means nothing without the weight of a bag, and the reverse
    and ((bags is null) = (bag_weight is null))
  );

comment on column public.po_line_items.bag_weight is 'Kg in one bag (yarn, 0758). With `bags`, quantity = bags × bag_weight.';
comment on column public.po_line_items.bags is 'Whole bags ordered (yarn, 0758). May round the line up past what is left to buy by less than one bag.';
comment on column public.po_line_items.dia is 'Fabric dia / width as written in the trade (0758).';

create or replace function public.po_line_requirement_cap()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_src uuid := coalesce(new.garment_order_id, new.iwo_id);
  v_required numeric;
  v_other numeric;
  v_left numeric;
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

  v_left := greatest(v_required - v_other, 0);

  if new.quantity > v_left + 0.0001 then
    -- WHOLE BAGS (0758): exactly bags × bag weight, and over by less than one bag.
    if new.bag_weight is not null and new.bag_weight > 0 and new.bags is not null
       and abs(new.quantity - new.bags * new.bag_weight) < 0.001
       and new.quantity - v_left < new.bag_weight - 0.0001 then
      return new;
    end if;
    raise exception 'Order qty % is more than the % still to buy on this requirement — excess quantity is not allowed',
      new.quantity, v_left
      using errcode = 'check_violation';
  end if;
  return new;
end
$function$;
