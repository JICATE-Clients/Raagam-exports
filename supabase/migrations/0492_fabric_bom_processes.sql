-- ============================================================================
-- Raagam ERP — 0492 Fabric BOM ▸ Fabric Process (the route each fabric runs)
--
-- The legacy "Prepare fabric BOM for Garment order" screen carries a
-- **FabricProcess** tab (client screenshot 2588). It is a two-level tree:
--
--   1. fabric   S No · Fabric Description · Type · Type · [Assort Color] ·
--               [Components]
--   2. process  S No · Stage · Process · LossFor · [Descriptions] · Loss % ·
--               Type
--
-- Level 1 is READ from `order_fabric_bom_lines` (0426) and gets NO table here,
-- for the reason 0490 set out for the three palette panels and 0491 repeated for
-- the Manual tab's first two levels: the line already names the style, the
-- colourway, the structure, the panel and the fabric itself, so a second copy of
-- that description is a second place for one BOM to disagree with itself.
--
--
-- A ROUTE BELONGS TO THE FABRIC, NOT TO THE LINE, AND THAT IS `item_id`
--
-- Client spec 2026-09-01: "the screen must automatically fetch and display
-- separate sections for each unique fabric structure defined in the Fabric
-- Allocation tab (for example, listing Rib and Single Jersey as separate
-- groups)". Screenshot 2588 agrees — its two outer rows are fabric DESCRIPTIONS
-- with their composition brackets, not per-panel lines.
--
-- The first cut of this migration keyed on `line_id`, and that was wrong twice
-- over. A BOM line is one (style, colourway, structure, PANEL) leaf, so a rib
-- used for a collar and the same rib used for a cuff are two lines — and they
-- are knitted, dyed and compacted identically. Keying on the line would ask the
-- operator to enter one route several times and then leave nothing to say the
-- copies were meant to agree.
--
-- `item_id` RATHER THAN `structure_id`, though the spec says "structure". Two
-- lines naming SINGLE JERSEY at different compositions or GSMs are different
-- cloth and may legitimately dye differently; the item is the finer grain and it
-- cannot merge two routes that were never the same. It is also what the
-- screenshot prints, and what the Yarn Process tab (0493) reads its bracket
-- composition out of — so the two tabs group on one key rather than two.
--
-- AND IT REMOVES A WHOLE CLASS OF BUG. `writeLines` deletes and re-inserts every
-- line on each save, matching ids back by `sno`, so a `line_id` here could never
-- be carried across a save and the rows had to travel nested inside their line.
-- `item_id` is a stable master id. These rows go back to being a plain top-level
-- child of the BOM, like `_dias`.
--
-- Only level 2 is new.
--
--
-- WHAT THIS IS *NOT*: IT DOES NOT RE-COST THIS DOCUMENT
--
-- 0426 states the rule this migration had to be checked against, on
-- `order_fabric_bom_lines.wastage_pct`: "the CUTTING room's buffer. NOT process
-- loss — that is step 4, and applying it here as well charges the same loss
-- twice." That still holds, and nothing here touches `requirement.ts`:
-- Calculated Quantities on the Fabric BOM stays order qty x consumption x
-- cutting wastage, exactly as before this migration.
--
-- So what is `loss_pct` for? It is the DECLARATION that step 4 plans against.
-- `order_fabric_plan_stages` (0427) already carries `process_id` and `loss_pct`
-- and solves `input = output / (1 - loss/100)` backwards from the BOM's
-- requirement — and `copyRouteToRest` on that screen says in as many words that
-- there is "deliberately no built-in default route". Today an operator rebuilds
-- every fabric's route by hand on every order. This table is where the route
-- is stated once, on the document that already knows which fabrics exist; the
-- Fabric Plan reads it as a SEED and stays free to override a stage per plan.
--
-- ONE NUMBER, ONE AUTHOR, TWO READERS. That is the whole reason the loss lives
-- here rather than being computed here (decision recorded 2026-09-01).
--
--
-- `loss_pct < 100`, NOT `<= 100`, AND THE GUARD IS BORROWED ON PURPOSE
--
-- Verbatim from 0427's own CHECK, whose comment gives the reason: at exactly
-- 100 the backward solve divides by zero, "which in JS is Infinity rather than
-- an error". A figure declared here is fed to that solve, so it has to satisfy
-- that solve's precondition at the point it is WRITTEN — a 100 stored here and
-- refused there is a document that cannot be planned and does not say why.
--
--
-- UP TO FOUR STAGES, AND THAT CEILING IS THE SCREEN'S, NOT THIS TABLE'S
--
-- Client spec: "the system must support up to 4 distinct stages". The grid
-- stops offering "+ Add process" at four, and nothing here refuses a fifth.
--
-- Stated plainly rather than left to be discovered, because the same honesty
-- was owed once already and paid for: `keepOne` in child-grid.tsx claimed a
-- server half that did not exist, and its own note now records that a hidden
-- button cannot stop a stale client or a direct post. A CHECK cannot express
-- "at most four rows per (bom, item)" — that needs a trigger — and a trigger
-- refusing a save the operator cannot see the cause of is worse than a cap the
-- UI enforces where the operator is standing. If four ever has to be a
-- guarantee rather than a guide, it needs a trigger and this note is the place
-- that says so.
--
--
-- `rate` IS THE BUDGET'S INPUT, AND IT IS FABRIC-WISE BY CONSTRUCTION
--
-- Client spec: "users must be able to input rates based on the fabric structure
-- (e.g. Knitting Rib = ₹10, Single Jersey = ₹9)". Because a route is already
-- keyed to one fabric (above), the rate on a stage IS the fabric-wise rate —
-- there is no second key to state and no way for two rows to disagree about
-- which fabric a rate belongs to.
--
-- NON-NEGATIVE, matching `order_budget_lines.rate` (0428) whose own comment
-- explains why zero is allowed and negative is not: a rate of 0 is a real line
-- (free issue), while a negative one would subtract from the cost total that a
-- purchase ceiling is checked against.
--
-- THE COLOUR-WISE HALF IS NOT HERE YET. The spec also asks for rates that differ
-- by colour combo on finishing stages ("dark colours might require a higher
-- dyeing rate like ₹40"). That is a (stage x colour) grain and needs its own
-- child; it is deliberately left out of this migration rather than guessed at,
-- because the colours come from the BOM lines' own `color_name` and how the
-- screen should offer them is an open question as of 2026-09-01.
--
--
-- STAGE, LOSS FOR AND TYPE ARE OPERATOR-FILLED LOOKUPS, NOT `as const` VALUES
--
-- The legacy screenshot shows GREY and DYED under Stage, "Process wise" under
-- LossFor, and NOTHING under Type — an open dropdown whose contents no
-- screenshot reveals. That is exactly the case `vendor_item_form` /
-- `vendor_supply_type` (0369) set the precedent for: "▾ dropdowns on the legacy
-- screen whose contents the screenshot does not show, so they are managed lists
-- the operator fills through + Add rather than invented `as const` values."
--
-- Contrast 0490's `knit_type`, which is text with a CHECK: three fixed answers
-- that are also `fabric_structure`'s own codes. These three are neither fixed
-- nor already spelled anywhere, so they are `config_lookups` kinds with inline
-- create, reached through `LookupDialogPicker` like every other icon field.
--
-- SEEDED WITH WHAT THE SCREENSHOT SHOWS AND NOT ONE VALUE MORE. GREY and DYED
-- are on the client's own screen against this client's own data; inventing
-- FINISHED, BLEACHED or PRINTED beside them would be the mistake AGENTS.md
-- records under "Near misses" — a defaulted vocabulary the operator did not ask
-- for, which is how the first spell-suggest seed came to "correct" a Packing
-- Accessories name to COTTON. `fabric_process_type` is seeded with nothing at
-- all, because nothing is known about it.
--
--
-- `process_id` POINTS AT `public.processes` AND IS NARROWED BY `for_fabric`
--
-- 0227's master already carries five applicability flags, and `for_fabric` is
-- the one that answers "may this process appear on a fabric's route". The
-- narrowing is a CLIENT-side filter in `lib/orders/fabric-bom/processes.ts`,
-- not a SQL filter, for the "Disabled rows" reason (AGENTS.md): a process whose
-- flag is unticked on the master after this BOM named it must stay visible on
-- the row that holds it, or the field reads as empty and the next save blanks
-- the FK. `order_fabric_plan_stages` (0427) narrows on the same flag.
--
-- NO `location_id`. Fourth child of `order_fabric_boms`, and the three before
-- it carry none — the parent holds it and its policies narrow on
-- `is_current_location()`. Same paragraph as 0490's.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Three lookup kinds. `config_lookups.kind` is a CHECK, not an enum, so a
--    new kind is a constraint swap that RE-STATES the whole list — the edit
--    0369, 0372, 0398 and 0415 each made. The list below is 0415's (the last
--    migration to touch this constraint) plus the three at the end.
-- ---------------------------------------------------------------------------
alter table public.config_lookups
  drop constraint if exists config_lookups_kind_check;

alter table public.config_lookups
  add constraint config_lookups_kind_check check (kind = any (array[
    'attribute','levy','material_category','material_attribute','yarn_count',
    'yarn_purity','composition','process','component','gauge','knitting_dia',
    'out_doc_term','commodity','item_class','hsn_code','city','state',
    'department','designation','internal_department','ship_type','payment_term',
    'employee_category','team','account_schedule','vendor_group','agent_type',
    'agent','packing_list_format','commercial_invoice_format','shift_category',
    'doc_track','doc_menu','doc_value_type','doc_value_from','style_category',
    'coordinate','style_component','structure','trims_category','size',
    'roll_form_print','warehouse','ta_activity_type','fabric_structure',
    'fabric_type','yarn_type','duty_category','vendor_item_form',
    'vendor_supply_type','vendor_service_type','assortment_type','fabric_color',
    -- 0492: Fabric BOM ▸ Fabric Process. Three ▾ columns whose vocabularies the
    -- legacy screen does not fully reveal — see the header.
    'fabric_stage','process_loss_for','fabric_process_type'
  ]));


-- ---------------------------------------------------------------------------
-- 2. The two values the screenshot actually shows, and nothing else.
--    `where not exists` so a re-run adds nothing and a value the operator has
--    since renamed is never overwritten — 0279's idiom.
-- ---------------------------------------------------------------------------
insert into public.config_lookups (kind, code, name, is_active)
select 'fabric_stage', v.code, v.name, true
from (values
  ('grey', 'GREY'),
  ('dyed', 'DYED')
) as v(code, name)
where not exists (
  select 1 from public.config_lookups where kind = 'fabric_stage' and code = v.code
);

insert into public.config_lookups (kind, code, name, is_active)
select 'process_loss_for', v.code, v.name, true
from (values
  ('process_wise', 'PROCESS WISE')
) as v(code, name)
where not exists (
  select 1 from public.config_lookups where kind = 'process_loss_for' and code = v.code
);

-- `fabric_process_type` is DELIBERATELY UNSEEDED. The legacy column is blank on
-- both rows of the screenshot and no other evidence names a single value, so
-- the honest state is an empty list the operator extends through "+ Add" —
-- the same call 0415 made for `fabric_color`.


-- ---------------------------------------------------------------------------
-- 3. The route rows.
-- ---------------------------------------------------------------------------
create table if not exists public.order_fabric_bom_processes (
  id          uuid primary key default gen_random_uuid(),
  bom_id      uuid not null references public.order_fabric_boms(id) on delete cascade,
  -- WHICH FABRIC. The group, not the line — see the header. An `items` row of
  -- item class FABRIC, the same thing `order_fabric_bom_lines.item_id` names.
  item_id     uuid not null references public.items(id),
  sno         integer not null default 0,
  -- GREY / DYED — the fabric's STATE going into this step, not the step itself.
  stage_id    uuid references public.config_lookups(id),
  process_id  uuid references public.processes(id),
  -- "Process wise" — how the loss below is measured.
  loss_for_id uuid references public.config_lookups(id),
  -- Legacy draws this as a [Click] opening a sub-list. FREE TEXT here, matching
  -- the "Details" column of the Garment Order's own Style ▸ Process grid
  -- (0411/0412), whose note argues the same point from the same evidence: the
  -- Process cell beside it carries the ⓘ glyph every master-backed field in
  -- this app carries, and this one carries none. A third nesting level (BOM →
  -- fabric → process → descriptions) is scope nobody has asked for.
  description text,
  -- Declared here, PLANNED with in step 4. See the header: this does not enter
  -- this document's own arithmetic.
  loss_pct    numeric(6,2)
    check (loss_pct is null or (loss_pct >= 0 and loss_pct < 100)),
  -- The fabric-wise processing rate this stage costs (client spec 2026-09-01).
  -- Non-negative, matching order_budget_lines.rate (0428).
  rate        numeric(14,4) check (rate is null or rate >= 0),
  type_id     uuid references public.config_lookups(id),
  created_at  timestamptz not null default now()
);

create index if not exists idx_ofbp_bom  on public.order_fabric_bom_processes(bom_id);
create index if not exists idx_ofbp_item on public.order_fabric_bom_processes(item_id);

-- One step per position per fabric, so a re-ordered route cannot leave two rows
-- claiming the same place. The shape of 0427's own guard on
-- `order_fabric_plan_stages(line_id, sno)`, widened to this table's key — and it
-- is what makes `normalizeProcesses` renumbering densely PER FABRIC a
-- requirement rather than a tidiness: one counter across the document would
-- collide on the second fabric.
create unique index if not exists uq_ofbp_item_sno
  on public.order_fabric_bom_processes(bom_id, item_id, sno);

comment on table public.order_fabric_bom_processes is
  'Fabric BOM ▸ Fabric Process (0492). The route one FABRIC runs — knitting, '
  'dyeing, stentering, compacting — with the stage it enters each step in, the '
  'loss that step costs and its rate. Keyed to the fabric ITEM, not to a BOM '
  'line: a rib collar and a rib cuff are two lines and one route. DECLARATIVE '
  'on loss — it does not enter this BOM''s own requirement arithmetic (0426 '
  'reserves process loss for step 4); it is what order_fabric_plan_stages '
  '(0427) plans against, and what the Budget''s process lines cost from.';

comment on column public.order_fabric_bom_processes.item_id is
  'The fabric this route belongs to — one route per fabric per BOM, however '
  'many lines name it. NOT a line reference: order_fabric_bom_lines ids are '
  'rewritten on every save (writeLines deletes and re-inserts, matching back by '
  'sno), so nothing keyed to a line survives one.';

comment on column public.order_fabric_bom_processes.loss_pct is
  'Percentage of this step''s input lost. Strictly below 100, verbatim from '
  '0427: at 100 the backward solve input = output / (1 - loss/100) divides by '
  'zero, which in JS is Infinity rather than an error.';

comment on column public.order_fabric_bom_processes.rate is
  'The fabric-wise processing rate for this stage (Knitting Rib 10, Single '
  'Jersey 9). Fabric-wise needs no second key because the route is already '
  'keyed to one fabric. Colour-wise rates are a (stage x colour) grain and are '
  'deliberately not in 0492.';

comment on column public.order_fabric_bom_processes.stage_id is
  'config_lookups kind ''fabric_stage'' — GREY, DYED. An operator-filled list, '
  'seeded only with the two the client''s own screen shows (0492).';


-- ---------- RLS — the child shape, copied from 0490 which copied 0426 --------
do $rls$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'order_fabric_bom_processes'
  ) then
    create policy order_fabric_bom_processes_read on public.order_fabric_bom_processes
      for select to authenticated using (public.has_permission('orders','view'));
    create policy order_fabric_bom_processes_insert on public.order_fabric_bom_processes
      for insert to authenticated with check (public.has_permission('orders','create'));
    create policy order_fabric_bom_processes_update on public.order_fabric_bom_processes
      for update to authenticated using (public.has_permission('orders','edit'))
      with check (public.has_permission('orders','edit'));
    create policy order_fabric_bom_processes_delete on public.order_fabric_bom_processes
      for delete to authenticated using (public.has_permission('orders','delete'));
  end if;
end $rls$;

alter table public.order_fabric_bom_processes enable row level security;
