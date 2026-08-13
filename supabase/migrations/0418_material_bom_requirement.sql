-- ============================================================================
-- Raagam ERP — 0418 Material BOM ▸ the requirement, stored
--
-- Step 3 of the client's six-step garment order flow (doc/orders-six-step.md).
-- 0265 built the screen's SHAPE — header + Items grid + Processes grid + a
-- read-only quantity tab — and doc/masters-open-questions.md has carried a red
-- "Calculated Quantities formula unknown" against it ever since. This is the
-- formula, and the columns it needs.
--
--     Total Material Required = SKU Quantity x (Number of Items / Number of Pieces)
--
--
-- WHY THIS IS RE-KEYED TO `garment_order_amendments`
--
-- `material_bom_amendments.sales_order_id` points at `sales_orders`, which is a
-- 20-column scaffold. The real garment order is `garment_order_amendments` (49
-- columns), and — decisively — its Approval Qty tab (0413) is where "SKU
-- Quantity" already lives: qty + excess + approval + projection, per style and
-- per combo. A BOM that cannot reach those rows cannot compute anything.
--
-- A DIRECT FK, not a join through the SC shell. Resolving the order by matching
-- `material_bom_amendments.sales_order_id` to
-- `garment_order_amendments.sales_order_id` works today only because each
-- amendment mints its own shell; nothing enforces 1:1, so a `.limit(1)` on that
-- join is a silent wrong-amendment pick rather than an error.
--
-- `sales_order_id` KEEPS ITS COLUMN and its data, and leaves the Zod input and
-- the UI instead — the withdrawal pattern AGENTS.md records for `amend_type`.
-- The SC No is read through garment_order_amendments -> sales_orders.order_number,
-- which is where 0395's trigger stamps it.
--
-- Every table this touches holds ZERO rows in this database (verified from the
-- catalog, 2026-08-13), which is what makes the re-key and the rename below free
-- — the same argument 0404 used when it moved the Garment Order onto customers.
--
--
-- `quantity_nos` IS RENAMED, NOT JOINED BY A NEW COLUMN
--
-- It is the NUMERATOR of a ratio, not a quantity, and leaving that name on it
-- guarantees someone sums it. Someone already did: lib/reports/registry.ts
-- declared `qtyColumn: "quantity_nos"` with the caveat "Per-piece BOM qty x order
-- qty". Renaming makes the compiler enumerate every reader instead of leaving
-- them to be found one bug at a time.
--
--
-- `per_pieces` IS NULLABLE WITH NO DEFAULT — deliberately, and it is the one
-- column here most likely to be "tidied" later
--
-- A default of 1 makes an unfinished line silently compute, and the number it
-- produces goes onto a real purchase order. That is `conversionFactor`'s stated
-- reason for refusing a missing `alt_qty` rather than assuming 1, and it is the
-- same failure one table along. The engine refuses a blank divisor; a default
-- would take that refusal away from it.
--
--
-- `requirement_basis` IS A CHECKED TEXT ENUM, NOT `attribute_id`
--
-- The legacy "Attribute" column decides how a material's requirement SPLITS —
-- one bulk figure for the order, one row per colour, one row per size. 0265
-- modelled it as `attribute_id -> config_lookups(kind='material_attribute')`.
-- Four reasons that cannot drive arithmetic, and they compound:
--
--   1. That lookup holds exactly ONE row in this database, "STYLE", hand-typed
--      by an operator and seeded by no migration. A switch on it resolves to "no
--      basis" for every row — the feature inert and looking configured.
--   2. `config_lookups.name` is operator-editable and stored in CAPITALS
--      (AGENTS.md), so `name = 'Color-wise'` compiles, runs and quietly matches
--      nothing. That is the nominated-vendor failure verbatim, and the
--      supply-type case split ('Nominated' vs 'nominated') is the precedent for
--      it happening in this table's own neighbourhood.
--   3. Order/colour/size is a property of the REQUIREMENT, not of the material.
--      Two meanings on one column is how the Attribute picker ends up offering
--      "STYLE" as a split basis.
--   4. A CHECK is a database-level guarantee the engine's switch is exhaustive.
--      lib/data-io writes past the screen, and a uuid FK cannot express "one of
--      three".
--
-- Lowercase, matching this schema's own idiom: `ratio_for in ('master','inner')`
-- (0414), `process_type in ('yarn','fabric')` (0368). `attribute_id` keeps its
-- column as the classification it is and leaves the Zod input.
--
--
-- WHY THE REQUIREMENT IS STORED RATHER THAN PROJECTED
--
--   1. THE REPORT FACT SOURCE IS SQL AND THE ENGINE IS TYPESCRIPT.
--      `report_item_movements` is a view. A live projection cannot reach it, so
--      making `qty_planned` correct would mean reimplementing the excess,
--      approval, projection and basis maths in plpgsql — a second copy of
--      `rejectionFor`, which is the drift 0413's header and AGENTS.md both ban.
--   2. A QUANTITY CONTROLLER NEEDS SOMETHING THAT CANNOT MOVE UNDER THE
--      PURCHASER'S FEET. If the requirement is live, an over-purchase raised in
--      March silently clears itself when someone edits the order in April. That
--      makes the audit unfalsifiable, which is worse than absent.
--   3. 0413's PRECEDENT IS STRONGER HERE, NOT WEAKER. It stored `qty` because
--      nothing could derive it. Here something CAN — which is exactly why the
--      row also carries the INPUTS it was derived from (`basis_qty`,
--      `no_of_items`, `per_pieces`, `excess_pct`). A frozen number with no
--      provenance is unexplainable at the moment it is challenged, and "why does
--      the PO say 1,340?" is precisely when it gets challenged.
--   4. A REFUSAL GETS RESOLVED ONCE, by the person who can fix it. A live
--      projection renders its null on the BOM screen, the PO, the indent and the
--      report — four places re-deciding what a dash means.
--
-- `refusal_reason` is stored beside `required_qty` for the same reason. A
-- refusal that survives only in the browser is one nobody reading the document
-- later can act on.
--
--
-- STALENESS IS NEVER STORED
--
-- There is no `is_stale` column, and adding one would be wrong rather than
-- redundant: it is invalidated by an edit to a DIFFERENT document, which nothing
-- on this side can observe. It is derived on every read.
--
-- `computed_for_qty` ALONE IS NOT ENOUGH, and this is the trap the hash exists
-- for. WHITE 300 / NAVY 200 becoming WHITE 200 / NAVY 300 leaves the total at
-- 500 while every colour-wise requirement row is wrong — so the screen would
-- report "Updated" over a material plan that no longer matches the order.
-- `computed_basis_hash` fingerprints the sorted (style, combo, target) triples.
--
--
-- APPLIED IN TWO RECORDS, 2026-08-13. The MCP applied this as
-- `material_bom_requirement_schema` (sections 1-5) and
-- `report_item_movements_reads_stored_bom_requirement` (section 6), then the
-- verify block was run separately. Every assertion in it passed and the state
-- was re-read from the catalog afterwards. Comment text differs in punctuation
-- only. This file is the source of truth for WHY; supabase_migrations records
-- WHEN.
--
-- MOQ IS NOT ON THE REQUIREMENT TABLE, and its absence is deliberate
--
-- A colour-wise explosion makes six rows for one material; an MOQ of 500 applied
-- per row orders 3,000 of something the order needs 100 of. The supplier's
-- minimum is a minimum per ORDER, so it stays on the item line and is applied as
-- a rollup after the explosion.
-- ============================================================================


-- ---------- 1. Re-key the BOM to the garment order --------------------------

alter table public.material_bom_amendments
  add column if not exists garment_order_id uuid
    references public.garment_order_amendments(id) on delete cascade,
  add column if not exists computed_at         timestamptz,
  add column if not exists computed_for_qty    numeric(16,3),
  add column if not exists computed_basis_hash text;

comment on column public.material_bom_amendments.garment_order_id is
  'The garment order this BOM plans for. A DIRECT FK, not a join through sales_order_id: nothing enforces one amendment per SC shell, so that route is a silent wrong-amendment pick (0418).';
comment on column public.material_bom_amendments.sales_order_id is
  'WITHDRAWN from the UI and the Zod input by 0418; column and data kept. The SC No is read through garment_order_id -> garment_order_amendments -> sales_orders.order_number.';
comment on column public.material_bom_amendments.computed_for_qty is
  'Total production the requirement was computed against. For DISPLAY — comparing it is not enough to detect staleness, see computed_basis_hash (0418).';
comment on column public.material_bom_amendments.computed_basis_hash is
  'Fingerprint of the sorted (style, combo, production target) triples, from basisFingerprint() in lib/orders/material-bom/requirement.ts. Swapping two combos leaves computed_for_qty equal and changes this (0418).';

create unique index if not exists uq_mba_order_amendment_no
  on public.material_bom_amendments(garment_order_id, amendment_no);

create index if not exists idx_mba_garment_order
  on public.material_bom_amendments(garment_order_id);


-- ---------- 2. The item line: the ratio, the wastage, the basis -------------

do $rename$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'material_bom_amendment_items'
       and column_name  = 'quantity_nos'
  ) then
    alter table public.material_bom_amendment_items
      rename column quantity_nos to no_of_items;
  end if;
end $rename$;

alter table public.material_bom_amendment_items
  add column if not exists requirement_basis text
    check (requirement_basis is null or requirement_basis in ('order','colour','size')),
  add column if not exists per_pieces numeric(14,3),
  add column if not exists excess_pct numeric(6,2) not null default 0
    check (excess_pct >= 0 and excess_pct <= 100),
  add column if not exists required_by date,
  add column if not exists style_ref_no text;

comment on column public.material_bom_amendment_items.no_of_items is
  'How many of this material one batch of garments uses — the NUMERATOR. Renamed from quantity_nos by 0418: it is a ratio term, not a quantity, and reports were summing it.';
comment on column public.material_bom_amendment_items.per_pieces is
  'How many garments no_of_items covers — the DIVISOR. NULLABLE WITH NO DEFAULT on purpose: a default of 1 makes an unfinished line compute and puts the result on a purchase order (0418).';
comment on column public.material_bom_amendment_items.excess_pct is
  'The line''s own wastage buffer, labelled "Wastage %" on screen. Multiplies the MATERIAL figure. Distinct from the order header''s excess_pct, which is already inside the production target (0418).';
comment on column public.material_bom_amendment_items.requirement_basis is
  'How the requirement splits: order | colour | size. A CHECKed enum rather than attribute_id, whose lookup holds one hand-typed row and whose name is operator-editable (0418).';
comment on column public.material_bom_amendment_items.attribute_id is
  'Classification only. It does NOT drive the split — see requirement_basis (0418).';
comment on column public.material_bom_amendment_items.style_ref_no is
  'Which style this material is for; NULL = every style. By VALUE, like every other cross-child reference here, because writeChildren reinserts children wholesale and an id FK would dangle (0407 · 0413 · 0414).';
comment on column public.material_bom_amendment_items.required_by is
  'The whole of legacy step 7 (Material Planning): a date on a line, not a document (doc/orders-six-step.md).';


-- ---------- 3. The stored requirement ---------------------------------------

create table if not exists public.material_bom_amendment_requirements (
  id                 uuid primary key default gen_random_uuid(),
  amendment_id       uuid not null references public.material_bom_amendments(id) on delete cascade,
  item_line_id       uuid not null references public.material_bom_amendment_items(id) on delete cascade,
  -- Denormalised: report_item_movements needs an item column it can group by
  -- without a second join, and a requirement whose line was retyped must keep
  -- pointing at the material it was computed for.
  item_id            uuid references public.items(id),
  sno                int  not null default 0,
  basis              text not null check (basis in ('order','colour','size')),
  style_ref_no       text,
  combo              text,
  size_id            uuid references public.config_lookups(id),
  slice_label        text not null,
  -- The inputs AS THEY STOOD, so a frozen number stays explainable.
  basis_qty          numeric(16,3) not null,
  no_of_items        numeric(14,3) not null,
  per_pieces         numeric(14,3) not null,
  excess_pct         numeric(6,2)  not null default 0,
  -- The output. NULL is a refusal, never a zero.
  required_qty       numeric(16,4),
  refusal_reason     text,
  consumption_uom_id uuid references public.uoms(id),
  uom_conversion_id  uuid references public.material_uom_conversions(id) on delete set null,
  purchase_qty       numeric(16,4),
  purchase_uom_id    uuid references public.uoms(id),
  created_at         timestamptz not null default now(),
  -- A row either answers or says why. Both filled would be a number nobody can
  -- interpret; neither filled is a row that means nothing at all.
  constraint chk_mba_req_answer_or_reason
    check ((required_qty is null) <> (refusal_reason is null))
);

comment on table public.material_bom_amendment_requirements is
  'One requirement row per BOM line per slice (whole order / colour / size). Computed by lib/orders/material-bom/requirement.ts and STORED so a purchase order has a fixed number to be checked against — see 0418''s header.';
comment on column public.material_bom_amendment_requirements.required_qty is
  'The requirement in the consumption unit, rounded UP at that UOM''s decimal_places_allowed. NULL means REFUSED, never "none needed" — refusal_reason says which case.';
comment on column public.material_bom_amendment_requirements.basis_qty is
  'The production target this row was computed from. Stored so the figure stays explainable after the order moves.';
comment on column public.material_bom_amendment_requirements.purchase_qty is
  'The same requirement in the supplier''s pack unit. NULL when unanswerable — it never falls back to the base figure, because a metres number under a "Cone" heading is the worst available wrong answer.';

create index if not exists idx_mba_req_amendment
  on public.material_bom_amendment_requirements(amendment_id);
create index if not exists idx_mba_req_line
  on public.material_bom_amendment_requirements(item_line_id);
create index if not exists idx_mba_req_item
  on public.material_bom_amendment_requirements(item_id);

-- NULLS NOT DISTINCT, for 0348's stated reason on uq_material_uom_conversions_line:
-- the default lets unlimited "blank" duplicates through, and every slice key here
-- carries nulls by design (order basis nulls all three). A duplicate double-counts
-- into a purchase.
create unique index if not exists uq_mba_req_slice
  on public.material_bom_amendment_requirements(item_line_id, style_ref_no, combo, size_id)
  nulls not distinct;


-- ---------- 4. Processes: from a bare item to a tracked send-out ------------

alter table public.material_bom_amendment_processes
  add column if not exists process_id uuid references public.processes(id),
  add column if not exists vendor_id  uuid references public.master_vendors(id),
  add column if not exists qty_out    numeric(16,3),
  add column if not exists qty_in     numeric(16,3),
  add column if not exists status     text not null default 'planned'
    check (status in ('planned','sent','part_received','received'));

-- master_vendors, NOT public.vendors. 0377 already repointed this table's
-- sibling `material_bom_amendment_items.vendor_id` for exactly this reason: the
-- nominated-vendor picker hands back a master id, and the wrong FK rejects every
-- save. Balance (qty_out - qty_in) is derived, never stored.
comment on column public.material_bom_amendment_processes.vendor_id is
  'The processor this material is sent to. References master_vendors, matching the items grid (0377 · 0418).';
comment on column public.material_bom_amendment_processes.qty_out is
  'Sent for processing. No Delivery Challan is generated from here — public.delivery_challans has no lines table on this path, and a half-built DC is worse than none (0418).';

create index if not exists idx_mba_proc_vendor
  on public.material_bom_amendment_processes(vendor_id);


-- ---------- 5. RLS on the new table (0265's block, verbatim) ----------------

do $rls$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'material_bom_amendment_requirements'
  ) then
    execute $f$
      create policy material_bom_amendment_requirements_read on public.material_bom_amendment_requirements
        for select to authenticated using (public.has_permission('orders','view'));
      create policy material_bom_amendment_requirements_insert on public.material_bom_amendment_requirements
        for insert to authenticated with check (public.has_permission('orders','create'));
      create policy material_bom_amendment_requirements_update on public.material_bom_amendment_requirements
        for update to authenticated using (public.has_permission('orders','edit'))
        with check (public.has_permission('orders','edit'));
      create policy material_bom_amendment_requirements_delete on public.material_bom_amendment_requirements
        for delete to authenticated using (public.has_permission('orders','delete'));
    $f$;
  end if;
end $rls$;

alter table public.material_bom_amendment_requirements enable row level security;


-- ---------- 6. The report fact source reads the stored number ---------------
--
-- Fragment 4 of `report_item_movements` computed planned consumption as
-- `mbai.quantity_nos * so.order_qty`. `qty_planned` was therefore 0 in every
-- item report for every amendment-backed BOM, because the Garment Order screen
-- mints its sales_orders shell without an order_qty. Not an error, not a missing
-- column — just "nothing planned", which is the exact shape AGENTS.md warns
-- about under Cascading filters.
--
-- The whole view is restated because `create or replace view` takes the full
-- definition; only fragment 4 differs from 0352.

create or replace view public.report_item_movements as

-- 1. The stock ledger: the spine. These are real, posted movements.
select
  sl.id                                       as fact_id,
  'stock_ledger'::text                        as fact_source,
  (case
     when sl.reference_type = 'opening_stock' then 'opening'
     when sl.movement_type = 'receipt'        then 'received'
     when sl.movement_type = 'issue'          then 'issued'
     when sl.movement_type = 'return'         then 'returned'
     else sl.movement_type
   end)::text                                 as fact_kind,
  (case
     when sl.movement_type in ('receipt','return','transfer_in','adjust_in')
       then 'in' else 'out'
   end)::text                                 as direction,
  true                                        as posts_to_ledger,
  sl.txn_date,
  sl.item_id,
  sl.uom_id,
  sl.quantity,
  sl.rate,
  sl.value,
  sl.store_id,
  sl.location_id,
  (case
     when g.id  is not null then 'vendor'
     when vr.id is not null then 'vendor'
     when cr.id is not null then 'buyer'
   end)::text                                 as party_type,
  coalesce(g.vendor_id, vr.vendor_id, cr.buyer_id) as party_id,
  coalesce(sl.reference_type, 'manual')::text as doc_type,
  sl.reference_id                             as doc_id,
  coalesce(g.code, vr.code, cr.code, mr.code) as doc_code,
  sl.note
from public.stock_ledger sl
left join public.grns g
  on g.id = sl.reference_id and sl.reference_type = 'grn'
left join public.vendor_returns vr
  on vr.id = sl.reference_id
 and sl.reference_type in ('vendor_return', 'vendor_return_replacement')
left join public.csp_receipts cr
  on cr.id = sl.reference_id and sl.reference_type = 'csp_receipt'
left join public.material_requisitions mr
  on mr.id = sl.reference_id and sl.reference_type = 'material_requisition'

union all

-- 2. Purchase orders: demand placed, not yet stock. Never posts to the ledger.
select
  pli.id,
  'po_line_items',
  'ordered',
  'neutral',
  false,
  coalesce(po.order_date, po.created_at::date),
  pli.item_id,
  pli.uom_id,
  pli.quantity,
  pli.unit_price,
  pli.amount,
  null::uuid,
  po.location_id,
  'vendor',
  po.vendor_id,
  'purchase_order',
  po.id,
  po.code,
  pli.description
from public.po_line_items pli
join public.purchase_orders po on po.id = pli.purchase_order_id
where po.status <> 'cancelled' and pli.item_id is not null

union all

-- 3. GRN lines as *documented*. Deliberately duplicated against the ledger's
--    'received' rows: GRN stock-in in grn-actions.ts is wrapped in a swallowed
--    try/catch, so the two can silently diverge. Reporting both is what makes
--    that divergence visible instead of invisible.
select
  gli.id,
  'grn_line_items',
  (case when k.kind = 'a' then 'grn_accepted' else 'grn_rejected' end),
  'neutral',
  false,
  g.grn_date,
  pli.item_id,
  pli.uom_id,
  (case when k.kind = 'a' then gli.accepted_qty else gli.rejected_qty end),
  pli.unit_price,
  round(pli.unit_price *
        (case when k.kind = 'a' then gli.accepted_qty else gli.rejected_qty end), 2),
  null::uuid,
  g.location_id,
  'vendor',
  g.vendor_id,
  'grn',
  g.id,
  g.code,
  gli.description
from public.grn_line_items gli
join public.grns g on g.id = gli.grn_id
join public.po_line_items pli on pli.id = gli.po_line_item_id
cross join (values ('a'), ('r')) as k(kind)
where g.status = 'posted'
  and pli.item_id is not null
  and coalesce(case when k.kind = 'a' then gli.accepted_qty else gli.rejected_qty end, 0) > 0

union all

-- 4. Material BOM: the STORED requirement (0418).
--
--    It used to read `mbai.quantity_nos * so.order_qty`, and that was 0 for
--    every amendment-backed BOM in this database: the Garment Order screen mints
--    its `sales_orders` row only to be stamped with an SC No and never sets
--    `order_qty`, which defaults to 0. The column was there, the join was there,
--    and every item report said "nothing planned" - the failure AGENTS.md names
--    under Cascading filters, where an empty report reads as a real answer.
--
--    The requirement now has its own rows, computed by
--    lib/orders/material-bom/requirement.ts against the order's production
--    target (qty + excess + approval + projection) and split by order / colour /
--    size. So this reads a number rather than re-deriving one - which also means
--    the excess and rejection maths is not reimplemented in plpgsql beside the
--    TypeScript copy.
--
--    A REFUSED row carries `required_qty` NULL and is excluded. It is not a
--    quantity of zero; it is a question the operator has not answered, and
--    summing it as 0 is what this whole fragment was rewritten to stop.
select
  r.id,
  'material_bom_amendment_requirements',
  'planned',
  'neutral',
  false,
  coalesce(mba.amend_date, mba.created_at::date),
  r.item_id,
  r.consumption_uom_id,
  r.required_qty,
  null::numeric,
  null::numeric,
  null::uuid,
  so.location_id,
  'vendor',
  mbai.vendor_id,
  'material_bom_amendment',
  mba.id,
  mba.code,
  r.slice_label
from public.material_bom_amendment_requirements r
join public.material_bom_amendment_items mbai on mbai.id = r.item_line_id
join public.material_bom_amendments mba on mba.id = r.amendment_id
left join public.sales_orders so on so.id = mba.sales_order_id
where mba.is_draft is not true
  and r.item_id is not null
  and r.required_qty is not null

union all

-- 5. Delivery challans: material sitting at a processor. OFF-BOOK — dc_line_items
--    never posts a stock movement, so this material is invisible to stock_balances.
select
  dli.id,
  'dc_line_items',
  (case when k.kind = 's' then 'sent_out' else 'came_back' end),
  (case when k.kind = 's' then 'out' else 'in' end),
  false,
  dc.dc_date,
  dli.item_id,
  dli.uom_id,
  (case when k.kind = 's' then dli.sent_qty else dli.returned_qty end),
  null::numeric,
  null::numeric,
  null::uuid,
  dc.location_id,
  'vendor',
  dc.vendor_id,
  'delivery_challan',
  dc.id,
  dc.code,
  dli.description
from public.dc_line_items dli
join public.delivery_challans dc on dc.id = dli.delivery_challan_id
cross join (values ('s'), ('r')) as k(kind)
where dli.item_id is not null
  and coalesce(case when k.kind = 's' then dli.sent_qty else dli.returned_qty end, 0) > 0;

-- The views are the RPCs' private plumbing, not a client surface (0352).
revoke all on public.report_item_movements from public, anon, authenticated;


-- ============================================================================
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal. 0383 and
-- 0386 both applied cleanly and both left a function anon-callable; 0386 shipped
-- an `alter default privileges ... in schema public` that runs, succeeds and
-- does nothing at all.
--
-- Four of these assert an ABSENCE or a REFUSAL, which is the half that cannot be
-- checked by looking at the DDL above:
--   - `quantity_nos` is GONE, so the rename happened rather than a second column
--     appearing beside it;
--   - `per_pieces` has NO default, which is the one column a later tidy-up would
--     "fix" into a silent 1;
--   - the basis CHECK actually REJECTS a wrong value (asserted by trying one);
--   - the slice index actually REFUSES a duplicate (asserted by inserting one).
-- ============================================================================

do $verify$
declare
  v_null    text;
  v_default text;
  v_def     text;
  probe_goa uuid;
  probe_mba uuid;
  probe_line uuid;
begin
  -- ---- 1. the re-key ----
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'material_bom_amendments'
       and column_name in ('garment_order_id')
  ) then
    raise exception '0418: material_bom_amendments.garment_order_id was not added';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'material_bom_amendments'
       and column_name = 'computed_basis_hash'
  ) then
    raise exception '0418: computed_basis_hash was not added — a bare total cannot detect a combo swap';
  end if;

  -- ---- 2. the rename, asserted as an ABSENCE ----
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'material_bom_amendment_items'
       and column_name = 'quantity_nos'
  ) then
    raise exception '0418: quantity_nos still exists — the rename did not happen';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'material_bom_amendment_items'
       and column_name = 'no_of_items'
  ) then
    raise exception '0418: no_of_items is missing';
  end if;

  -- ---- 3. per_pieces must stay nullable AND defaultless ----
  select is_nullable, column_default into v_null, v_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'material_bom_amendment_items'
     and column_name = 'per_pieces';
  if v_null is null then
    raise exception '0418: per_pieces was not added';
  end if;
  if v_null <> 'YES' or v_default is not null then
    raise exception
      '0418: per_pieces must be NULLABLE with NO default (got nullable=%, default=%) — a default of 1 makes an unfinished line compute onto a purchase order',
      v_null, v_default;
  end if;

  -- ---- 4. the requirement table ----
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'material_bom_amendment_requirements'
  ) then
    raise exception '0418: material_bom_amendment_requirements was not created';
  end if;

  -- ---- 5. the report view actually moved off the 0-planned expression ----
  select pg_get_viewdef('public.report_item_movements'::regclass, true) into v_def;
  if v_def is null then
    raise exception '0418: report_item_movements does not exist';
  end if;
  if position('material_bom_amendment_requirements' in v_def) = 0 then
    raise exception '0418: report_item_movements does not read the stored requirement';
  end if;
  if position('quantity_nos' in v_def) > 0 then
    raise exception '0418: report_item_movements still references quantity_nos';
  end if;

  -- ---- 6. the probe rows every remaining assertion needs ----
  insert into public.garment_order_amendments (amend_date, excess_pct, pack, mult_ord)
    values (current_date, 0, false, false)
    returning id into probe_goa;
  insert into public.material_bom_amendments (garment_order_id, amend_date)
    values (probe_goa, current_date)
    returning id into probe_mba;
  insert into public.material_bom_amendment_items (amendment_id, sno)
    values (probe_mba, 1)
    returning id into probe_line;

  -- ---- 7. the basis CHECK refuses a wrong value ----
  --
  -- Against a REAL amendment_id. Written first against a null one, where the
  -- not-null violation fires before the CHECK is ever consulted and the
  -- assertion passes without testing anything — which is the shape of a check
  -- that reports success while doing nothing.
  begin
    update public.material_bom_amendment_items
       set requirement_basis = 'Color-wise'
     where id = probe_line;
    raise exception '0418: requirement_basis admitted "Color-wise" — the CHECK is not doing its job';
  exception when check_violation then
    null;                                                 -- expected
  end;

  -- …and accepts a right one.
  update public.material_bom_amendment_items
     set requirement_basis = 'colour'
   where id = probe_line;

  -- ---- 8. the slice index refuses a duplicate, asserted BY VIOLATING IT ----
  begin
    insert into public.material_bom_amendment_requirements
      (amendment_id, item_line_id, basis, slice_label, basis_qty, no_of_items, per_pieces, required_qty)
    values (probe_mba, probe_line, 'order', 'Whole order', 600, 2, 1, 1200),
           (probe_mba, probe_line, 'order', 'Whole order', 600, 2, 1, 1200);
    raise exception '0418: uq_mba_req_slice admitted a duplicate slice — NULLS NOT DISTINCT is missing';
  exception when unique_violation then
    null;                                                 -- expected
  end;

  -- A DIFFERENT slice under the same line must still be accepted, or the index
  -- is too tight and a colour-wise explosion could never be stored.
  insert into public.material_bom_amendment_requirements
    (amendment_id, item_line_id, basis, combo, slice_label, basis_qty, no_of_items, per_pieces, required_qty)
  values (probe_mba, probe_line, 'colour', 'WHITE', 'WHITE', 300, 2, 1, 600),
         (probe_mba, probe_line, 'colour', 'NAVY',  'NAVY',  200, 2, 1, 400);
  if (select count(*) from public.material_bom_amendment_requirements
       where item_line_id = probe_line) <> 2 then
    raise exception '0418: two different combos under one BOM line were refused';
  end if;

  -- ---- 9. a row must answer OR say why, never both and never neither ----
  begin
    insert into public.material_bom_amendment_requirements
      (amendment_id, item_line_id, basis, combo, slice_label, basis_qty, no_of_items, per_pieces,
       required_qty, refusal_reason)
    values (probe_mba, probe_line, 'colour', 'RED', 'RED', 100, 2, 1, 200, 'Pieces must be more than 0');
    raise exception '0418: a requirement row was allowed to carry both a quantity and a refusal';
  exception when check_violation then
    null;                                                 -- expected
  end;

  -- Cascades clean everything: requirements -> items -> amendment -> order.
  delete from public.garment_order_amendments where id = probe_goa;
  if exists (select 1 from public.material_bom_amendment_requirements where amendment_id = probe_mba) then
    raise exception '0418: deleting the garment order left orphaned requirement rows';
  end if;
end $verify$;
