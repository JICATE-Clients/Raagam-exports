-- 0789 · GRN EXCESS QUANTITY LOCK IN THE DATABASE (user 2026-10-31: "the backend database
-- function validates the inward quantity against the pending PO qty and rejects any excess").
--
-- The screen and createGrn already refuse a Today Recd above the pending balance, and the 3%
-- tolerance + Store Manager override are gone from both. But grn_post leaned on the 0620
-- tolerance trigger, which lets an AUTHORISED over-receipt through — so a request that got
-- past the app could still post one.
--
-- A TRIGGER ON THE PO LINE, not another copy of grn_post: whatever writes `received_qty`
-- (a GRN post, a replacement, anything later), a PO line may never stand received beyond
-- what it still has open — quantity − closed (rejection short-close, 0780) − balance closed
-- (0782). No tolerance band, no override.

create or replace function public.po_line_refuse_excess_receipt()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(new.received_qty, 0)
     > coalesce(new.quantity, 0) - coalesce(new.closed_qty, 0) - coalesce(new.balance_closed_qty, 0) + 0.0005 then
    raise exception 'Excess quantity blocked: % — only % is pending on the PO',
      coalesce(new.description, 'a line'),
      greatest(coalesce(old.quantity, 0) - coalesce(old.closed_qty, 0) - coalesce(old.balance_closed_qty, 0) - coalesce(old.received_qty, 0), 0)
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_po_line_refuse_excess_receipt on public.po_line_items;
create trigger trg_po_line_refuse_excess_receipt
  before update of received_qty, closed_qty, balance_closed_qty, quantity on public.po_line_items
  for each row
  when (coalesce(new.received_qty, 0) > coalesce(old.received_qty, 0)
        or coalesce(new.closed_qty, 0) <> coalesce(old.closed_qty, 0)
        or coalesce(new.balance_closed_qty, 0) <> coalesce(old.balance_closed_qty, 0)
        or new.quantity is distinct from old.quantity)
  execute function public.po_line_refuse_excess_receipt();

revoke all on function public.po_line_refuse_excess_receipt() from public, anon;
