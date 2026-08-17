-- ============================================================================
-- Raagam ERP — 0426 Fabric BOM · fabric by structure, component and colour
--
-- Step 5 of the client's order flow (doc/orders-six-step.md, and the 2026-08-17
-- revision recorded in lib/nav/module-groups.ts). Material BOM answers "which
-- trims and packing items, and how many"; this answers "which fabric, in which
-- colour, for which panel, and how many kilos".
--
--     Fabric Required = Production Target x Consumption per garment
--                       x (1 + Wastage %)
--
--
-- WHY IT IS A SEPARATE DOCUMENT FROM MATERIAL BOM
--
-- The client's split, and the legacy schema agrees — `fabric_boms` and
-- `material_boms` are distinct documents in 0368 too. Fabric is bought by COLOUR
-- and STRUCTURE and is the dominant cost; trims are per-garment counts. The
-- arithmetic differs at the root: a trim line is a RATIO (`no_of_items` per
-- `per_pieces`, 0418) because 2 labels cover 1 piece and 1 metre of tape covers
-- 4, while fabric is a single consumption figure per garment. Forcing fabric
-- through the ratio would make every line carry `per_pieces = 1`, which is a
-- column that always holds the same value — the shape that invites someone to
-- "simplify" it away and take the trims case with it.
--
--
-- KEYED TO `garment_order_amendments`, FOR 0418'S REASON EXACTLY
--
-- `sales_orders` is a 20-column scaffold whose `order_qty` defaults to 0 and is
-- never set by the Garment Order screen. The production target lives on the
-- Approval Qty tab (0413) of `garment_order_amendments`, and a BOM that cannot
-- reach those rows cannot compute anything. A DIRECT FK, not a join through the
-- SC shell: nothing enforces one amendment per shell, so that route is a silent
-- wrong-amendment pick rather than an error.
--
--
-- IT SEEDS FROM THE ORDER, NOT FROM THE STYLE MASTER — doc/orders-six-step.md
-- §3 STEP 4 IS SUPERSEDED HERE
--
-- That section says Fabric BOM "seeds from the Style's components -> fabric
-- mapping, so this step needs 0392". True on 2026-08-10 and not true now: 0408,
-- 0409 and 0410 put the whole fabric tree ON THE ORDER —
-- `garment_order_amendment_combos` -> `_combo_structures` (structure,
-- composition, GSM, solid/melange/yarn_dyed) -> `_combo_components` (coordinate,
-- component, fabric colour, print). That tree is what the operator actually
-- filled in for THIS order, including the per-order colour and print the Style
-- master has no opinion about.
--
-- Seeding from `garment_styles` instead would re-fetch a template the order has
-- already been amended away from, which is the same class of defect as reading a
-- quantity off the SC shell.
--
--
-- A LINE POINTS AT THAT TREE BY VALUE AND BY MASTER ID — NEVER BY TREE ID
--
-- `writeChildren` deletes and reinserts the combo tree wholesale on every save
-- of the order, so `garment_order_amendment_combo_components.id` is not stable:
-- an FK to it dangles the first time anyone reopens the order and presses Save.
-- 0423 records exactly this call for the Material BOM's `component_id`, and
-- 0407 · 0413 · 0414 record it for `style_ref_no` / `combo`.
--
-- So a line identifies its fabric as (style_ref_no TEXT, combo TEXT,
-- structure_id -> categories, component_id -> components). Two stable values and
-- two stable MASTER ids. Composition, GSM and solid/melange/yarn_dyed are NOT
-- copied onto the line — they are read live from the order tree for display,
-- because a copy is a second place for them to disagree with the order.
--
--
-- PROCESS LOSS IS NOT HERE. IT IS STEP 6.
--
-- The PRD asks for "process wise process loss included while calculating the
-- BOM", and the client's 2026-08-17 split puts it one step along: Fabric BOM is
-- FINISHED FABRIC, Fabric Plan walks the route that makes it (yarn purchase ->
-- knitting -> dyeing -> stentering -> compacting) and applies each stage's loss
-- to reach the yarn. `wastage_pct` here is the CUTTING room's buffer on finished
-- fabric and nothing else.
--
-- Naming that boundary is the point. Put knitting loss on the BOM as well and
-- the same loss is applied twice — once here and once by the plan reading this
-- number — which is a 6-8% over-purchase on the largest line in the order and
-- looks entirely plausible on both screens.
--
--
-- `consumption` IS NULLABLE WITH NO DEFAULT
--
-- Same argument 0418 records for `per_pieces`: a default makes an unfinished
-- line silently compute, and the number it produces is spent. The engine refuses
-- a missing consumption and says so; a default would take that refusal away.
--
--
-- THE REQUIREMENT IS STORED, NOT PROJECTED — 0418'S THREE REASONS, UNCHANGED
--
--   1. `report_item_movements` is a VIEW. A live projection cannot reach it, so
--      making fabric visible to the item reports would mean reimplementing the
--      excess, approval and projection maths in plpgsql beside the TypeScript
--      copy — the drift 0413's header and AGENTS.md both ban.
--   2. A quantity controller needs a number that cannot move under the
--      purchaser's feet. `lib/purchase/bom-ceiling.ts` reads the stored figure.
--   3. It stays explainable: the inputs are stored beside the output, so a
--      figure agreed three weeks ago can still be read back after the order has
--      moved on.
--
-- Staleness is therefore a real state, and it is the SAME state Material BOM
-- has: `computed_basis_hash` + `bomStatusOf` in lib/orders/bom-status.ts, which
-- moved out of `material-bom-amendment/` in this change precisely so a second
-- copy of the five-state vocabulary was never written.
--
--
-- ONE FABRIC BOM PER ORDER, AS A CONSTRAINT
--
-- `material_bom_amendments` carries an `amendment_no` and a
-- unique(garment_order_id, amendment_no) — inherited from 0265, when a BOM
-- revision was thought to be a second document. It is not: the `recalculate`
-- state means "the order moved since this was computed" and the operator opens
-- the same document and saves it again (see lib/nav/module-groups.ts on step 3).
-- A NEW table should not inherit a revision number nothing uses, so this one is
-- unique on the order alone — which also makes the work queue's "one row per
-- order" assumption a guarantee rather than a hope.
--
--
-- NO APPROVAL COLUMNS ON THIS TABLE
--
-- doc/orders-six-step.md sketched `status, approved_by, approved_at` on
-- `order_fabric_boms`. The client's answer in doc/prd.md is explicit and
-- narrower: "BOM required no approval. After BOM, budgeting is done using Fabric
-- BOM and Material BOM of various orders which are grouped together. This budget
-- is approved." So approval is a transition on the BUDGET (step 8), and columns
-- here would be an approval gate with no screen behind it — the shape that reads
-- as configured and is inert.
-- ============================================================================


-- ---------- 1. The document -------------------------------------------------

create table if not exists public.order_fabric_boms (
  id                  uuid primary key default gen_random_uuid(),
  garment_order_id    uuid not null
    references public.garment_order_amendments(id) on delete cascade,
  code                text,
  bom_date            date not null default current_date,
  is_draft            boolean not null default true,
  remark              text,
  -- Staleness. See the header; compared, never summed.
  computed_at         timestamptz,
  computed_for_qty    numeric(16,3),
  computed_basis_hash text,
  location_id         uuid references public.locations(id),
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.order_fabric_boms is
  'Step 5 of the order flow: which fabric, in which colour, for which panel, and how much. One per garment order — a revision is the same document recomputed, not a second row (0426).';
comment on column public.order_fabric_boms.garment_order_id is
  'The garment order this BOM plans for. A DIRECT FK for 0418''s reason: nothing enforces one amendment per sales_orders shell, so joining through it is a silent wrong-amendment pick.';
comment on column public.order_fabric_boms.computed_basis_hash is
  'Fingerprint of the sorted (style, combo, production target) triples, from basisFingerprint() in lib/orders/material-bom/requirement.ts — the SAME function the Material BOM uses, because it fingerprints the ORDER, not the BOM.';
comment on column public.order_fabric_boms.computed_for_qty is
  'Total production the requirement was computed against. For DISPLAY: comparing it is not enough to detect staleness — swapping two combos leaves it equal (0418).';

create unique index if not exists uq_order_fabric_bom_order
  on public.order_fabric_boms(garment_order_id);

create index if not exists idx_order_fabric_bom_location
  on public.order_fabric_boms(location_id);


-- ---------- 2. The line -----------------------------------------------------

create table if not exists public.order_fabric_bom_lines (
  id                 uuid primary key default gen_random_uuid(),
  bom_id             uuid not null
    references public.order_fabric_boms(id) on delete cascade,
  sno                int not null default 0,

  -- WHICH fabric, addressed the way the order addresses it. See the header on
  -- why none of these four is a tree id.
  style_ref_no       text,
  combo              text,
  structure_id       uuid references public.categories(id),
  component_id       uuid references public.components(id),

  -- The fabric itself: an `items` row of item class FABRIC. The screen scopes
  -- the picker; nothing here can check it without a round trip, and a rule that
  -- needs one does not belong in a constraint.
  item_id            uuid references public.items(id),

  -- Descriptive, carried from the order's combo tree at seed time so the line
  -- reads without a join, and re-read live when the tree is available. Both
  -- checks allow NULL: a line typed by hand before its structure is chosen is an
  -- ordinary mid-entry state.
  fabric_type        text
    check (fabric_type is null or fabric_type in ('main','trims_fabric')),
  color_name         text,

  -- The arithmetic.
  consumption        numeric(14,4),
  consumption_uom_id uuid references public.uoms(id),
  wastage_pct        numeric(6,2) not null default 0
    check (wastage_pct >= 0 and wastage_pct <= 100),
  requirement_basis  text
    check (requirement_basis is null or requirement_basis in ('colour','colour_size')),

  -- Knitting spec. Carried for step 6 — the knitting stage is planned per
  -- diameter — and shown here because the operator sets it while looking at the
  -- fabric. It drives no arithmetic in THIS step and no requirement row.
  dia                numeric(10,2),

  required_by        date,
  rate               numeric(14,4),
  notes              text,
  created_at         timestamptz not null default now()
);

comment on table public.order_fabric_bom_lines is
  'One fabric, for one structure and panel of one colourway. Addresses the order''s combo tree by VALUE (style_ref_no, combo) and by MASTER id (structure_id, component_id) — never by tree id, which writeChildren rewrites on every save (0407 · 0413 · 0414 · 0423).';
comment on column public.order_fabric_bom_lines.combo is
  'The colourway this fabric is for; NULL = every combo on the order. TEXT, matching the Combos tab''s own key (0397).';
comment on column public.order_fabric_bom_lines.structure_id is
  'The fabric structure — SINGLE JERSEY, 1X1 LYCRA RIB. References `categories`, which is where 0409 moved the order''s own structure column.';
comment on column public.order_fabric_bom_lines.component_id is
  'Which panel this fabric is cut for — FRONT BODY, COLLAR. References the `components` MASTER (0228), not garment_style_components, whose ids are rewritten on every save of the Style (0421 · 0423).';
comment on column public.order_fabric_bom_lines.consumption is
  'Fabric per garment, in consumption_uom_id. NULLABLE WITH NO DEFAULT on purpose: a default makes an unfinished line compute and the number is spent (0418 records the same call for per_pieces).';
comment on column public.order_fabric_bom_lines.wastage_pct is
  'The CUTTING room''s buffer on finished fabric. NOT process loss — knitting, dyeing and finishing losses belong to Fabric Plan (step 6), and putting them here too applies each one twice (0426).';
comment on column public.order_fabric_bom_lines.requirement_basis is
  'How this line splits: colour | colour_size. No ''order'' basis — fabric is dyed per colourway, so one un-split figure is never right for it. And the second value is NOT the Material BOM''s ''size'', which collapses the colour axis on purpose (a Medium label is a Medium label whatever the shirt) — collapsing colour is exactly what a dyed fabric cannot do, so it is spelled out rather than reusing a word that means the opposite one table along (0426).';
comment on column public.order_fabric_bom_lines.dia is
  'Knitting diameter. Descriptive here; step 6 plans the knitting stage per diameter. Drives no requirement row.';

create index if not exists idx_ofbl_bom on public.order_fabric_bom_lines(bom_id);
create index if not exists idx_ofbl_item on public.order_fabric_bom_lines(item_id);


-- ---------- 3. The stored requirement ---------------------------------------

create table if not exists public.order_fabric_bom_requirements (
  id                 uuid primary key default gen_random_uuid(),
  bom_id             uuid not null
    references public.order_fabric_boms(id) on delete cascade,
  line_id            uuid not null
    references public.order_fabric_bom_lines(id) on delete cascade,
  -- Denormalised for 0418's stated reason: report_item_movements needs an item
  -- column it can group by without a second join, and a requirement whose line
  -- was retyped must keep pointing at the fabric it was computed for.
  item_id            uuid references public.items(id),
  sno                int not null default 0,
  basis              text not null check (basis in ('colour','colour_size')),
  style_ref_no       text,
  combo              text,
  size_id            uuid references public.config_lookups(id),
  slice_label        text not null,

  -- The inputs AS THEY STOOD, so a frozen number stays explainable.
  basis_qty          numeric(16,3) not null,
  consumption        numeric(14,4) not null,
  wastage_pct        numeric(6,2)  not null default 0,

  -- The output. NULL is a refusal, never a zero.
  required_qty       numeric(16,4),
  refusal_reason     text,
  consumption_uom_id uuid references public.uoms(id),
  created_at         timestamptz not null default now(),

  -- A row either answers or says why. Both filled would be a number nobody can
  -- interpret; neither filled is a row that means nothing at all.
  constraint chk_ofbr_answer_or_reason
    check ((required_qty is null) <> (refusal_reason is null))
);

comment on table public.order_fabric_bom_requirements is
  'One requirement row per fabric line per slice (colour, or colour x size). Computed by lib/orders/fabric-bom/requirement.ts and STORED so a purchase order has a fixed number to be checked against — 0418''s header argues this at length.';
comment on column public.order_fabric_bom_requirements.required_qty is
  'Finished fabric required, rounded UP at the consumption UOM''s decimal_places_allowed. NULL means REFUSED, never "none needed" — refusal_reason says which case.';
comment on column public.order_fabric_bom_requirements.basis_qty is
  'The production target this row was computed from. Stored so the figure stays explainable after the order moves.';

create index if not exists idx_ofbr_bom  on public.order_fabric_bom_requirements(bom_id);
create index if not exists idx_ofbr_line on public.order_fabric_bom_requirements(line_id);
create index if not exists idx_ofbr_item on public.order_fabric_bom_requirements(item_id);

-- NULLS NOT DISTINCT, for 0348's stated reason on uq_material_uom_conversions_line
-- and 0418's on uq_mba_req_slice: the default lets unlimited "blank" duplicates
-- through, and every slice key here carries nulls by design (a colour-basis row
-- nulls size_id). A duplicate double-counts into a purchase.
create unique index if not exists uq_ofbr_slice
  on public.order_fabric_bom_requirements(line_id, style_ref_no, combo, size_id)
  nulls not distinct;


-- ---------- 4. RLS — the `orders` module, the four policies every sibling has -

do $rls$
declare
  t text;
begin
  foreach t in array array[
    'order_fabric_boms',
    'order_fabric_bom_lines',
    'order_fabric_bom_requirements'
  ] loop
    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = t
    ) then
      execute format($f$
        create policy %1$s_read on public.%1$s
          for select to authenticated using (public.has_permission('orders','view'));
        create policy %1$s_insert on public.%1$s
          for insert to authenticated with check (public.has_permission('orders','create'));
        create policy %1$s_update on public.%1$s
          for update to authenticated using (public.has_permission('orders','edit'))
          with check (public.has_permission('orders','edit'));
        create policy %1$s_delete on public.%1$s
          for delete to authenticated using (public.has_permission('orders','delete'));
      $f$, t);
    end if;
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $rls$;


-- ---------- 5. The item reports learn about fabric --------------------------
--
-- `report_item_movements` is the ONE fact source every item report slices
-- (the raagam-report-data contract). Fabric requirement rows carry an `item_id`
-- and a quantity, so leaving them out would make "planned consumption" mean
-- trims only — an under-count that reads as a complete answer, which is the
-- failure AGENTS.md names under Cascading filters.
--
-- The whole view is restated because `create or replace view` takes the full
-- definition. Fragments 1-5 are 0418's, character for character; fragment 6 is
-- the only new text. A REFUSED row carries `required_qty` NULL and is excluded —
-- it is a question the operator has not answered, not a quantity of zero.

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
  and coalesce(case when k.kind = 's' then dli.sent_qty else dli.returned_qty end, 0) > 0

union all

-- 6. Fabric BOM: the STORED requirement (0426).
--
--    Fragment 4 above is the same idea for trims and packing. Both read a number
--    rather than re-deriving one, so the excess, approval and projection maths
--    exists once — in TypeScript — and not a second time in plpgsql.
--
--    NO RATE AND NO VALUE, matching fragment 4. A `planned` row carries a
--    QUANTITY; the money for a plan is the Budget's (step 7), and putting a rate
--    here would let an item report total a planned cost beside a purchased one
--    as though the two had been reconciled.
--
--    NO PARTY EITHER, and this one differs from fragment 4 on purpose. A trim
--    line names its vendor on the BOM; fabric sourcing is step 6's decision and
--    has not been taken when this row is written. Fragment 4's shape
--    ('vendor', mbai.vendor_id) would put the literal 'vendor' against a null
--    id — a party_type claiming a party that is not there, which reads in a
--    grouped report as an unnamed supplier rather than as "not yet sourced".
select
  r.id,
  'order_fabric_bom_requirements',
  'planned',
  'neutral',
  false,
  coalesce(b.bom_date, b.created_at::date),
  r.item_id,
  r.consumption_uom_id,
  r.required_qty,
  null::numeric,
  null::numeric,
  null::uuid,
  b.location_id,
  null::text,
  null::uuid,
  'order_fabric_bom',
  b.id,
  b.code,
  r.slice_label
from public.order_fabric_bom_requirements r
join public.order_fabric_boms b on b.id = r.bom_id
where b.is_draft is not true
  and r.item_id is not null
  and r.required_qty is not null;

-- The views are the RPCs' private plumbing, not a client surface (0352).
revoke all on public.report_item_movements from public, anon, authenticated;


-- ============================================================================
-- Read the result back out of the catalog.
--
-- `{"success": true}` means the SQL ran, not that it achieved its goal — 0383
-- and 0386 both reported success over a no-op. Each of these must come back
-- exactly as described or the migration has not done what its header claims.
--
--   -- three tables, RLS on, four policies each (expect 3 rows, 4/4/4)
--   select c.relname, c.relrowsecurity, count(p.policyname)
--     from pg_class c
--     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
--     left join pg_policies p on p.tablename = c.relname and p.schemaname = 'public'
--    where c.relname like 'order_fabric_bom%'
--    group by 1, 2;
--
--   -- the view really has a sixth fragment (expect 1)
--   select count(*) from pg_views
--    where schemaname = 'public' and viewname = 'report_item_movements'
--      and definition like '%order_fabric_bom_requirements%';
--
--   -- one BOM per order is a CONSTRAINT, not a convention (expect 1)
--   select count(*) from pg_indexes
--    where schemaname = 'public' and indexname = 'uq_order_fabric_bom_order';
--
-- No new FUNCTION is created here, so the `revoke all on function … from public,
-- anon` idiom (AGENTS.md, Function grants) has nothing to apply to. The view's
-- revoke above is the separate, existing rule from 0352.
-- ============================================================================
