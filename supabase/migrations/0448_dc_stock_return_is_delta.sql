-- =============================================================================
-- 0448 — A challan's return posts only what has not come back yet
--
-- 0447 shipped `post_dc_stock(dc, direction)` with an 'in' branch that posted
-- `returned_qty` in full. That is correct exactly once. `recordDcReturn`
-- INCREMENTS `returned_qty` as goods arrive, so a second partial return posts the
-- running total again — 600 back, then 400 more, posts 600 and then 1,000, and
-- the processing store ends 600 short of what it actually holds.
--
-- Caught before it could bite: 0447 was applied minutes earlier and no challan
-- had been dispatched.
--
-- ## THE DELTA IS READ FROM THE LEDGER, NOT TRACKED IN A COLUMN
--
-- The ledger already knows what has come back — the `transfer_in` rows this
-- challan has posted into the material store for that item. Subtracting gives
-- the outstanding quantity, which makes the function IDEMPOTENT (running it
-- twice posts nothing the second time) and self-correcting if a posting was ever
-- missed. A `stock_returned_qty` column would be a second copy of a fact the
-- ledger already holds, and the two would drift.
--
-- Everything else about 0447 is unchanged and is restated here because this file
-- replaces the function whole: a transfer PAIR rather than issue/receipt (dyeing
-- is not consumption, and an `issue` would overstate it on every item report),
-- SECURITY DEFINER so a merchandiser can move stock they have no store access
-- to, and both legs inside one function because `transferStock` posts them
-- separately and can half-fail.
-- =============================================================================

create or replace function public.post_dc_stock(
  p_dc_id     uuid,
  p_direction text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loc      uuid;
  v_from     uuid;
  v_to       uuid;
  v_posted   timestamptz;
  v_line     record;
  v_qty      numeric;
  v_already  numeric;
begin
  if p_direction not in ('out', 'in') then
    raise exception 'post_dc_stock: direction must be out or in, not %', p_direction;
  end if;

  select location_id, stock_posted_at into v_loc, v_posted
    from public.delivery_challans where id = p_dc_id;
  if not found then
    raise exception 'post_dc_stock: no such challan';
  end if;

  -- ONCE ONLY on the way out. A second dispatch posting would move the same
  -- goods twice and leave the material store short by the difference.
  if p_direction = 'out' and v_posted is not null then
    raise exception 'This challan has already been posted to stock';
  end if;
  if p_direction = 'in' and v_posted is null then
    raise exception 'This challan has not been dispatched yet — post the dispatch first';
  end if;

  -- The material store the goods leave from and the processing store they sit
  -- in, both resolved at the challan's own location where it names one, so a
  -- two-location business does not move stock out of the wrong building.
  select id into v_from from public.stores
   where store_type = 'material'
     and (v_loc is null or location_id is not distinct from v_loc)
   order by (location_id is not distinct from v_loc) desc
   limit 1;

  select id into v_to from public.stores
   where store_type = 'processing'
     and (v_loc is null or location_id is not distinct from v_loc)
   order by (location_id is not distinct from v_loc) desc
   limit 1;

  if v_from is null or v_to is null then
    raise exception 'post_dc_stock: this location has no % store',
      (case when v_from is null then 'material' else 'processing' end);
  end if;

  for v_line in
    select item_id,
           case when p_direction = 'out' then sent_qty else returned_qty end as qty
      from public.dc_line_items
     where delivery_challan_id = p_dc_id
       and item_id is not null
  loop
    v_qty := coalesce(v_line.qty, 0);

    -- THE DELTA, on the way back only. What the ledger has already brought home
    -- for this challan and item is subtracted, so a second partial return posts
    -- only the new arrivals.
    if p_direction = 'in' then
      select coalesce(sum(quantity), 0) into v_already
        from public.stock_ledger
       where reference_type = 'delivery_challan'
         and reference_id = p_dc_id
         and item_id = v_line.item_id
         and store_id = v_from
         and movement_type = 'transfer_in';
      v_qty := v_qty - coalesce(v_already, 0);
    end if;

    continue when v_qty <= 0;

    insert into public.stock_ledger
      (store_id, item_id, movement_type, quantity, counterparty_store_id, reference_type, reference_id, note)
    values
      (case when p_direction = 'out' then v_from else v_to end,
       v_line.item_id, 'transfer_out', v_qty,
       case when p_direction = 'out' then v_to else v_from end,
       'delivery_challan', p_dc_id,
       case when p_direction = 'out' then 'Sent for processing' else 'Returned from processing' end);

    insert into public.stock_ledger
      (store_id, item_id, movement_type, quantity, counterparty_store_id, reference_type, reference_id, note)
    values
      (case when p_direction = 'out' then v_to else v_from end,
       v_line.item_id, 'transfer_in', v_qty,
       case when p_direction = 'out' then v_from else v_to end,
       'delivery_challan', p_dc_id,
       case when p_direction = 'out' then 'At processor' else 'Back in stock' end);
  end loop;

  if p_direction = 'out' then
    update public.delivery_challans set stock_posted_at = now() where id = p_dc_id;
  end if;
end $$;

-- BOTH GRANTS IN ONE STATEMENT. A new function is born callable by `anon` two
-- independent ways — Postgres's built-in EXECUTE TO PUBLIC and Supabase's own
-- default privileges — and revoking one leaves the other standing. AGENTS.md
-- records 0383 shipping exactly that half-fix. A CREATE OR REPLACE keeps the
-- existing ACL, so this is belt and braces rather than strictly required.
revoke all on function public.post_dc_stock(uuid, text) from public, anon;
grant execute on function public.post_dc_stock(uuid, text) to authenticated;

comment on function public.post_dc_stock(uuid, text) is
  'Post a Delivery Challan''s dispatch or return to stock_ledger as a TRANSFER '
  'pair between the material and processing stores (0447; return made delta-aware '
  '0448). Direction ''in'' posts only what the ledger has not already brought '
  'back, so a second partial return cannot double-post.';

do $assert$
begin
  if exists (
    select 1 from pg_proc p
     where p.proname = 'post_dc_stock'
       and p.pronamespace = 'public'::regnamespace
       and (has_function_privilege('anon', p.oid, 'execute')
            or has_function_privilege('public', p.oid, 'execute'))
  ) then
    raise exception '0448: post_dc_stock is executable by anon or public';
  end if;
  if not has_function_privilege('authenticated', 'public.post_dc_stock(uuid, text)', 'execute') then
    raise exception '0448: authenticated cannot execute post_dc_stock';
  end if;
end $assert$;
