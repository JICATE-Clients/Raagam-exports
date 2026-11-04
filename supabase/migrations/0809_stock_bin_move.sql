-- 0809 · BIN → BIN — move stock between bins of ONE store (user 2026-11-04, Inventory Dashboard:
-- "build it with assign a bin also").
--
-- Stock Transfer (0803) moves stock between owners and between stores, and refuses a
-- store-to-store transfer whose two stores are the same — so a lot received without a bin, or put
-- in the wrong one, could not be moved at all; TESTBIN had to be corrected by hand (11-04). This
-- adds the fifth type, `bin_to_bin`: same store, same owner, only the bin changes. It is a normal
-- posted Stock Transfer (number, register, print, audit), posted by the unchanged
-- `stock_transfer_post`, which already writes the out-leg at the layer's bin and the in-leg at the
-- line's `to_bin_id`.
--
-- THREE CHANGES, each patched IN PLACE on the live body with its anchor asserted (0803 / 0804's
-- rule), so a newer body is never overwritten by a file copy:
--
--   1. the type is allowed (check constraint);
--   2. the header guard: one store, owner travels (stock_transfer_guard);
--      the line guard: a To bin is required and must differ from the layer's (stock_transfer_line_guard);
--   3. THE FIFO ENGINE'S PASS 0 MATCHES THE BIN EXACTLY (report_stock_layers__all_units).
--
-- WHY 3. Pass 0 drains a transfer / adjustment out-leg from its own receipt's layers, and treated
-- a NULL bin as "any bin". GRN-0014 left 2,500 labels in MAT01 and 500 with no bin; moving the 500
-- unbinned ones would have drained the MAT01 layer instead — MAT01 down to 2,000, the floor still
-- showing 500. Both writers of an origin-carrying out-leg (stock_transfer_post 0803,
-- stock_adjustment_post 0805) stamp the LAYER's own bin, NULL included, so an exact match is what
-- the pass always meant. No ledger row carries origin_ledger_id today (checked 11-04), so this
-- changes no existing figure.

-- 1. The type ---------------------------------------------------------------------------------
alter table public.stock_transfers drop constraint if exists stock_transfers_transfer_type_check;
alter table public.stock_transfers add constraint stock_transfers_transfer_type_check
  check (transfer_type in ('general_to_order', 'order_to_order', 'order_to_general', 'store_to_store', 'bin_to_bin'));

-- 2a. Header guard ------------------------------------------------------------------------------
do $mig$
declare
  v_def text := pg_get_functiondef('public.stock_transfer_guard()'::regprocedure);
  a1 text := E'  elsif new.transfer_type = ''general_to_order'' then\n';
begin
  if position('bin_to_bin' in v_def) > 0 then
    raise notice 'stock_transfer_guard already knows bin_to_bin — skipped';
    return;
  end if;
  if position(a1 in v_def) = 0 then
    raise exception 'stock_transfer_guard has changed since 0803 — patch it by hand from its latest body';
  end if;
  execute replace(v_def, a1,
    E'  elsif new.transfer_type = ''bin_to_bin'' then\n'
    || E'    if new.from_store_id <> new.to_store_id then\n'
    || E'      raise exception ''A bin move stays in one store — use Store → Store to change the store'';\n'
    || E'    end if;\n'
    || E'    -- The owner travels with the stock, as on Store → Store.\n'
    || E'    new.to_garment_order_id := new.from_garment_order_id;\n'
    || E'    new.to_iwo_id := new.from_iwo_id;\n'
    || a1);
end
$mig$;

-- 2b. Line guard --------------------------------------------------------------------------------
do $mig$
declare
  v_def text := pg_get_functiondef('public.stock_transfer_line_guard()'::regprocedure);
  a1 text := E'  new.item_id := src.item_id;\n';
begin
  if position('bin_to_bin' in v_def) > 0 then
    raise notice 'stock_transfer_line_guard already knows bin_to_bin — skipped';
    return;
  end if;
  if position(a1 in v_def) = 0 then
    raise exception 'stock_transfer_line_guard has changed since 0803 — patch it by hand from its latest body';
  end if;
  execute replace(v_def, a1, a1
    || E'  if h.transfer_type = ''bin_to_bin'' then\n'
    || E'    if new.to_bin_id is null then\n'
    || E'      raise exception ''Pick the bin the stock goes to'';\n'
    || E'    end if;\n'
    || E'    if new.to_bin_id is not distinct from src.bin_id then\n'
    || E'      raise exception ''The stock is already in that bin'';\n'
    || E'    end if;\n'
    || E'  end if;\n');
end
$mig$;

-- 3. FIFO pass 0: exact bin ---------------------------------------------------------------------
do $mig$
declare
  v_def text := pg_get_functiondef('public.report_stock_layers__all_units(date, uuid)'::regprocedure);
  a1 text := 'when 0 then l_root[i] = r.root and (r.bin_id is null or l_bin[i] is not distinct from r.bin_id)';
  b1 text := 'when 0 then l_root[i] = r.root and l_bin[i] is not distinct from r.bin_id';
begin
  if position(b1 in v_def) > 0 then
    raise notice 'report_stock_layers__all_units pass 0 already matches the bin exactly — skipped';
    return;
  end if;
  if position(a1 in v_def) = 0 then
    raise exception 'report_stock_layers__all_units has changed since 0803 — patch pass 0 by hand from its latest body';
  end if;
  execute replace(v_def, a1, b1);
end
$mig$;

-- CREATE OR REPLACE keeps each function's ACL, but say it again so the file reads as complete
-- (AGENTS "Function grants": always both public and anon).
revoke all on function public.stock_transfer_guard() from public, anon;
revoke all on function public.stock_transfer_line_guard() from public, anon;
revoke all on function public.report_stock_layers__all_units(date, uuid) from public, anon, authenticated;

comment on column public.stock_transfers.transfer_type is
  'general_to_order · order_to_order · order_to_general · store_to_store · bin_to_bin (0809: same store, same owner, only the bin changes).';
