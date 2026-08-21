-- =============================================================================
-- 0447 — A Delivery Challan moves stock, so material at a processor is on-book
--
-- Client, 2026-08-21: "track their receipt back into stock before they can be
-- issued to production."
--
-- ## THIS REVERSES A DOCUMENTED DECISION, DELIBERATELY
--
-- 0418:485-486 and doc/map.md:363-366 both record that DC material is OFF-BOOK:
-- `dc_line_items` posts no stock movement, and `report_item_movements` emits its
-- lines with `posts_to_ledger = false` for exactly that reason. That was a
-- conscious choice and it is being changed on the client's instruction, not
-- tidied away.
--
-- What it bought before: nothing to reconcile. What it cost: `stock_balances`
-- kept showing 1,000 buttons in the material store while they sat at the dyer,
-- and an MRS could issue them to production. That is precisely the failure the
-- client described.
--
-- ## A TRANSFER PAIR, NOT ISSUE/RECEIPT
--
-- Dyeing is not consumption. `postProcessIssue` (stores/process-actions.ts) uses
-- `issue`/`receipt`, which lands in the `issued` bucket of
-- `report_item_movements` and would overstate consumption on every item report.
-- A transfer leaves net stock unchanged and says only WHERE the goods are —
-- which is what `ST-PROC` (store_type 'processing') was seeded for in 0010 and
-- has never been used for.
--
-- ## THE GATE COMES FREE, AND IT IS THE WHOLE ARGUMENT
--
-- `apply_stock_movement()` (0010:64-90) hard-raises on a negative balance, and
-- `stock_balances` is keyed (store_id, item_id). Once the buttons have moved out
-- of the material store, an MRS trying to issue them from there fails with
-- "Insufficient stock" — already rendered as a sentence by `friendlyStock()`.
-- No new gate, no new document, no new status machine. That is the only
-- mechanism in this codebase capable of satisfying the client's sentence.
--
-- ## WHY A SECURITY DEFINER FUNCTION AND NOT TWO CLIENT INSERTS
--
-- Two reasons, and the second is the one that matters:
--
--  1. `stock_ledger`'s insert policy needs `stores` permission AND
--     `can_access_store`. A merchandiser raising a challan has neither.
--     `process-actions.ts` reaches for `createAdminClient()` here, which
--     bypasses `can_access_store` entirely and silently.
--  2. `transferStock` (stores/actions.ts:146-163) commits the out-leg and THEN
--     the in-leg, logging "Transfer partially recorded" if the second fails. Two
--     client inserts are not a transaction. For a statutory movement that is not
--     good enough: a half-posted transfer leaves stock missing from both stores.
--
-- Inside one function both legs are one statement's worth of atomicity, and the
-- permission is granted deliberately rather than by holding an admin client.
--
-- ## WHAT IS NOT DONE HERE, STATED SO IT IS NOT MISTAKEN FOR AN OVERSIGHT
--
-- `report_item_movements` still emits every DC line. Once a challan is posted,
-- its item-movement LISTING shows the dispatch twice — once as the challan line,
-- once as the ledger transfer. BALANCES ARE NOT AFFECTED: the challan line
-- carries `posts_to_ledger = false`, so anything summing stock ignores it. The
-- view is a 6.6k-character union and rebuilding it by hand inside this migration
-- is how a no-op ships (0386), so it is left to whoever owns reports, with this
-- comment as the record.
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
  -- buttons twice and leave the material store short by the difference.
  if p_direction = 'out' and v_posted is not null then
    raise exception 'This challan has already been posted to stock';
  end if;
  if p_direction = 'in' and v_posted is null then
    raise exception 'This challan has not been dispatched yet — post the dispatch first';
  end if;

  -- The material store the goods leave from, and the processing store they sit
  -- in. Both resolved at the challan's own location where it names one, so a
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
    continue when v_qty <= 0;

    -- OUT: material store -> processing store. IN: the reverse.
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
-- records 0383 shipping exactly that half-fix.
revoke all on function public.post_dc_stock(uuid, text) from public, anon;
grant execute on function public.post_dc_stock(uuid, text) to authenticated;

comment on function public.post_dc_stock(uuid, text) is
  'Post a Delivery Challan''s dispatch or return to stock_ledger as a TRANSFER '
  'pair between the material and processing stores (0447). SECURITY DEFINER so a '
  'merchandiser can move stock they have no store access to, and so both legs are '
  'atomic — transferStock posts them separately and can half-fail.';

do $assert$
begin
  -- Not callable without a login. This app has no logged-out surface, and a
  -- SECURITY DEFINER function reachable by anon is a hole straight through RLS.
  if exists (
    select 1 from pg_proc p
     where p.proname = 'post_dc_stock'
       and p.pronamespace = 'public'::regnamespace
       and (has_function_privilege('anon', p.oid, 'execute')
            or has_function_privilege('public', p.oid, 'execute'))
  ) then
    raise exception '0447: post_dc_stock is executable by anon or public';
  end if;

  if not has_function_privilege('authenticated', 'public.post_dc_stock(uuid, text)', 'execute') then
    raise exception '0447: authenticated cannot execute post_dc_stock — the grant did not take';
  end if;

  -- The stores this depends on exist, or every dispatch fails at the counter.
  if not exists (select 1 from public.stores where store_type = 'processing') then
    raise exception '0447: no store of type processing — 0010 seeds ST-PROC';
  end if;
  if not exists (select 1 from public.stores where store_type = 'material') then
    raise exception '0447: no store of type material — 0010 seeds ST-MAT';
  end if;
end $assert$;
