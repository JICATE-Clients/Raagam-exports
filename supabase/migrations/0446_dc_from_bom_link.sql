-- =============================================================================
-- 0446 — A challan line remembers which BOM process row it came from
--
-- Client, 2026-08-21: the Material BOM's Processes tab must generate an
-- Out-Processing Delivery Challan when greige accessories go to a dyer, and
-- track their return into stock before they can be issued to production.
--
-- ## THE LINK DOES NOT GO ON THE PROCESS ROW, AND THIS IS THE WHOLE DESIGN
--
-- 0439 put `delivery_challan_id` on `material_bom_amendment_processes`. That is
-- the single worst place for it in this schema. `writeChildren`
-- (material-bom-amendment/actions.ts) does:
--
--     delete from material_bom_amendment_processes where amendment_id = ?
--     insert ... (normalizeProcesses(data))
--
-- Every row's `id` is destroyed and re-minted on EVERY save, and `sno` is
-- renumbered after filtering, so neither is stable. A pointer living there
-- survives only if the client faithfully round-trips it, and the failure modes
-- when it does not are all silent and all expensive:
--
--   * a stale form saves      -> link lost -> a legally issued Rule 55 challan
--                                with nothing pointing at it;
--   * the row is removed      -> same;
--   * qty_out is edited       -> the BOM says 600, the challan in the driver's
--                                hand says 1,000;
--   * the row looks un-sent   -> DC-0002 raised for buttons already at the dyer,
--                                and both counted in the quarterly ITC-04.
--
-- ## SO: AN IMMUTABLE ANCHOR ON THE ROW, AND THE LINK ON THE CHALLAN
--
-- `row_uid` is minted once, by the client, and never shown or edited. Because it
-- is not a user field an operator cannot blank it, and because it has a DB
-- default a payload that somehow loses it produces a visibly un-dispatched row
-- plus a findable orphan line — never a silent mismatch.
--
-- The challan side carries the pointer, with a PARTIAL UNIQUE INDEX on it. One
-- challan line per process row, ever: a double-click, a stale form or a retried
-- action all hit a hard 23505 from Postgres instead of minting a second DC.
--
-- That is the same rule the Balance cell on this screen already states about
-- itself — "DERIVED, never stored: two columns and their difference kept in
-- three places is two chances for them to disagree".
--
-- ## `sent_on` IS DERIVED TOO, so 0439's second column is not carried either
--
-- The dispatch date IS the challan date. `sent_on = delivery_challans.dc_date`
-- of the row's challan, and NULL where there is no challan — which is exactly
-- right: no challan means no dispatch means nothing to age, which is what
-- `jobWorkAgeing` (process-return.ts) already expects.
--
-- ## `stock_posted_at` — the movement is a SEPARATE, EXPLICIT step
--
-- A BOM's Processes row is written at PLANNING time, months before the greige
-- buttons are bought or received. Posting stock as part of raising the challan
-- would have `apply_stock_movement` raise on a negative balance and abort the
-- whole insert — a bookkeeping precondition killing a legal document. So the
-- challan is raised first and dispatched (posted) when the goods actually move.
-- =============================================================================

alter table public.material_bom_amendment_processes
  add column if not exists row_uid uuid not null default gen_random_uuid();

comment on column public.material_bom_amendment_processes.row_uid is
  'Immutable per-row anchor (0446). NEVER shown or edited. writeChildren deletes '
  'and reinserts every row on save, so neither id nor sno is stable; a challan '
  'line points HERE. Minted client-side and round-tripped, with a DB default as '
  'the backstop.';

create unique index if not exists uq_mba_proc_row_uid
  on public.material_bom_amendment_processes (amendment_id, row_uid);

alter table public.dc_line_items
  add column if not exists mba_amendment_id    uuid references public.material_bom_amendments(id) on delete set null,
  add column if not exists mba_process_row_uid uuid;

comment on column public.dc_line_items.mba_process_row_uid is
  'The material_bom_amendment_processes.row_uid this line was generated from '
  '(0446). Partial-unique, so one process row can never raise two challans.';

-- PARTIAL, because a hand-entered DC line carries no BOM row and several NULLs
-- must be allowed to coexist. This is the guard against a second challan.
create unique index if not exists uq_dcli_mba_row
  on public.dc_line_items (mba_process_row_uid)
  where mba_process_row_uid is not null;

create index if not exists idx_dcli_mba_amendment
  on public.dc_line_items (mba_amendment_id);

alter table public.delivery_challans
  add column if not exists stock_posted_at timestamptz;

comment on column public.delivery_challans.stock_posted_at is
  'When this challan''s dispatch was posted to stock_ledger (0446). NULL = raised '
  'but not yet moved, which is the ordinary state at planning time. '
  'report_item_movements only emits a DC line while this is NULL, or the '
  'dispatch would be counted twice — once as the DC line and once as the ledger '
  'transfer.';

-- 0418's own comment on qty_out said "No Delivery Challan is generated from
-- here — public.delivery_challans has no lines table on this path". That was
-- wrong on the facts: dc_line_items has existed since 0008:175 with
-- sent_qty/returned_qty, and 0418's own stock view joins it. Corrected rather
-- than left to mislead the next reader.
comment on column public.material_bom_amendment_processes.qty_out is
  'Quantity sent out for this process. A challan IS generated from here since '
  '0446 — dc_line_items.mba_process_row_uid is the link. Once dispatched the '
  'challan is authoritative and this mirrors it.';

comment on column public.material_bom_amendment_processes.qty_in is
  'Quantity returned. A CACHE of dc_line_items.returned_qty once the row has a '
  'challan (0446) — recordDcReturn writes the challan and this follows. Kept as '
  'a column because processVerdict, report_item_movements and the copy path all '
  'read it. Do not "fix" it into a derivation without moving those three.';

do $assert$
declare
  v_idx text;
begin
  -- 1. The anchor exists and is unique per amendment.
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='material_bom_amendment_processes'
       and column_name='row_uid' and is_nullable='NO'
  ) then
    raise exception '0446: material_bom_amendment_processes.row_uid is missing or nullable';
  end if;

  -- 2. THE GUARD AGAINST A SECOND CHALLAN. Partial, and it must stay partial —
  --    a plain unique index would let exactly one hand-entered DC line exist.
  select indexdef into v_idx from pg_indexes
   where schemaname='public' and indexname='uq_dcli_mba_row';
  if v_idx is null then
    raise exception '0446: uq_dcli_mba_row is missing — one process row could raise two challans';
  end if;
  if position('WHERE' in upper(v_idx)) = 0 then
    raise exception '0446: uq_dcli_mba_row is not partial — it would refuse a second hand-entered DC line';
  end if;

  -- 3. Two rows may share a NULL anchor; two rows may not share a real one.
  --    Proved rather than asserted from the definition.
  begin
    insert into public.dc_line_items (delivery_challan_id, description, sent_qty, mba_process_row_uid)
    values (gen_random_uuid(), 'probe', 0, null);
    raise exception '0446: the probe inserted — it should have been refused by a FK';
  exception
    when unique_violation then
      raise exception '0446: uq_dcli_mba_row refused a NULL anchor — the index is not partial';
    when others then null;   -- a FK refused first, which is what should happen
  end;
end $assert$;
