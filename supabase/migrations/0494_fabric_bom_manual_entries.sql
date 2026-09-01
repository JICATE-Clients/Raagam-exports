-- ============================================================================
-- Raagam ERP — 0494 Fabric BOM ▸ Manual — RE-GRAINED to the client's spec
--
-- 0491 built this tab three hours ago from screenshot 2586 alone, and the client
-- has since supplied the actual specification. It disagrees on the GRAIN, which
-- is the one thing a screenshot cannot show, so 0491's table is dropped and
-- replaced rather than extended. Every table involved held ZERO rows, verified
-- from the catalog before this ran — the same freedom 0404 / 0408 / 0430 / 0434
-- all took, and the reason this is a replacement and not a migration path.
--
-- The client's framing, quoted because it sets the standard of care: fabric and
-- yarn are "70% to 80% of the total garment order value", so this tab is "the
-- heart of the material calculation system — any minor error in this screen will
-- collapse the downstream purchasing, knitting, dyeing, and budgeting
-- calculations".
--
--
-- WHAT 0491 GOT WRONG, AND IT IS ONE THING
--
-- It hung the size rows off `order_fabric_bom_lines`, one line per component,
-- because the FabricAllocation grid is keyed that way. The spec's entry is
-- keyed differently: a **fabric structure plus a SET of components**, with one
-- combined weight for the set.
--
--     Entry 1   Single Jersey   Front Body + Back Body     60 dia   180 g
--     Entry 2   Single Jersey   Sleeve                     52 dia    20 g
--     Entry 3   Rib             Neck                       28 dia    50 g
--
-- The client calls these Scenario A (grouped) and Scenario B (split), and the
-- choice between them is the planner's: "If the CAD department has provided a
-- single combined weight for multiple components … the planner can select Front
-- Body, Back Body and Sleeve together". A per-component table cannot hold that
-- 180 g without inventing a split between Front and Back that nobody typed —
-- and that invented number would drive a purchase.
--
--
-- THE ENTRY IS THE COUNTING UNIT (client decision, 2026-09-01)
--
-- Requirement rows are produced per ENTRY, and `order_fabric_bom_lines` stops
-- producing them. Three consequences, all deliberate:
--
--  1. A grouped 180 g is multiplied ONCE, not once per component. Attributing it
--     to each of the three covered lines would plan the order at 540 g.
--  2. The FabricAllocation line keeps its whole job — it is the fabric's
--     IDENTITY (item, colour, GSM range, sub-type, split) — and loses only its
--     claim on the arithmetic.
--  3. **The "no duplicate component" rule is what makes this safe**, and that is
--     why the client lists it under bugs to avoid rather than under polish: once
--     a component is used in one entry it is withdrawn from every other entry's
--     dropdown, so the entries PARTITION the garment. Sum the entries and you
--     have the garment's fabric weight exactly once.
--
-- IT IS NOT A DATABASE CONSTRAINT, and that is a judgement rather than an
-- omission. `unique (entry_id, component_id)` below stops the same panel twice
-- in ONE entry, which is unambiguous. Across the document it cannot be a
-- constraint: one BOM legitimately covers several styles (`order_fabric_boms`
-- has one row per ORDER, and an order carries many styles), and FRONT BODY of a
-- tee and FRONT BODY of a polo are two panels wearing one master row. A
-- `unique (bom_id, component_id)` would reject that at Save, on a document the
-- operator has no way to fix. The withdrawal happens where the client asked for
-- it — in the dropdown — so a component that is not offered cannot be chosen.
--
--
-- TWO MODES, AND THEY BOTH PRODUCE GRAMS
--
-- The spec's `Direct` and `Calculated` are two ways to reach ONE figure, not two
-- kinds of entry:
--
--     direct       the planner types the gram weight per size. "This is the
--                  primary method."
--     calculated   grams are derived from the panel measurements and the
--                  structure's GSM — "structural measurements, garment
--                  dimensions and fit classes".
--
-- So `width` / `length` / `length_tolerance` sit on the size row beside `grams`
-- and are the CALCULATED mode's inputs. `grams` is stored in both modes: in
-- direct mode it is typed, in calculated mode it is the derived figure written
-- down. Storing it either way is what lets every downstream reader — the
-- requirement, the yarn rollup, the budget — ask one question and get one
-- answer, without knowing which mode produced it.
--
-- THE CALCULATED FORMULA IS `manual.ts`'s, and this migration does not encode
-- it. `2 x width x effective length x gsm / 1e7` was confirmed by the client on
-- 2026-09-01 and is vectored in `check-fabric-bom.mts`; the "fit classes" half
-- of the spec's sentence has no data behind it in this schema yet, and inventing
-- one would be the failure this file is a rewrite of.
--
--
-- THE ARITHMETIC, VERBATIM FROM THE SPEC
--
--     Net Kg   = Order Quantity x grams / 1000
--     Gross Kg = Net Kg x (1 + wastage% / 100)
--
-- The client's own worked example: 10,510 pcs x 50 g Neck / 1000 = 525.5 Kg.
--
-- **THIS IS THE ENGINE WE ALREADY HAVE, NOT A SECOND ONE.**
-- `fabricRequirementFor` computes `slice.qty x consumption x (1 + wastage/100)`,
-- so `consumption = grams / 1000` makes the two identical. Nothing in
-- `requirement.ts` needed a new formula — which is the point. A second
-- multiplication written beside the first is how two screens come to report
-- different fabric for one order, and `doc/orders-six-step.md` names these two
-- steps as the pair that must never do that.
--
-- Formula 3 (yarn purchase = Σ gross x composition %) is deliberately NOT here.
-- That is the YarnProcess tab's (0493) and the Budget's, reading these rows.
--
--
-- `wastage_pct` LIVES ON THE ENTRY, AND IT IS THE ONE 0426 ALREADY MEANS
--
-- The spec's "Wastage / Damage % — the planned process loss allowance" is the
-- BOM's own allowance, the slot `order_fabric_bom_lines.wastage_pct` occupies.
-- It moves to the entry because the entry is now what multiplies. It is still
-- NOT the knitting / dyeing / compacting losses: those are step 4's
-- (`order_fabric_plans`, 0427), and 0426's rule stands — "applying it here as
-- well charges the same loss twice".
--
--
-- `size_id` AND `structure_id` ARE NULLABLE, like every cell in this module
--
-- A grid row is filled left to right and a half-filled one is how an operator
-- works. `normalizeManual*` in actions.ts decides what is worth STORING; this
-- table decides what is legal. The one NOT NULL is
-- `manual_components.component_id`, because a component row with no component is
-- not a half-filled row — it is a row with no content at all, and the unique
-- index below would admit exactly one of them per entry and then reject the next.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. 0491's grain goes. Verified 0 rows in the catalog first.
-- ---------------------------------------------------------------------------
drop table if exists public.order_fabric_bom_line_sizes;

-- The mode moved from the LINE to the ENTRY with the grain. Dropped rather than
-- left in place: a column nothing writes is one the next reader has to work out
-- the deadness of, and `order_fabric_bom_lines` is a table three sessions are
-- reading this week.
alter table public.order_fabric_bom_lines
  drop constraint if exists chk_ofbl_consumption_mode;
alter table public.order_fabric_bom_lines
  drop column if exists consumption_mode;


-- ---------------------------------------------------------------------------
-- 2. The entry — one fabric structure, one weight configuration.
-- ---------------------------------------------------------------------------
create table if not exists public.order_fabric_bom_manual_entries (
  id          uuid primary key default gen_random_uuid(),
  bom_id      uuid not null
                references public.order_fabric_boms(id) on delete cascade,
  sno         integer not null default 0,

  -- "Fabric Structure Dropdown: loaded from the structures selected in previous
  -- steps". `categories`, the same target as `order_fabric_bom_lines.structure_id`
  -- (0409 · 0426) and `garment_order_amendment_combo_structures.structure_id` —
  -- so an entry and an allocation line name one structure by one id, which is
  -- what lets the entry resolve its fabric ITEM off the lines.
  structure_id uuid references public.categories(id),

  -- direct | calculated — see the header. NOT NULL with a default because there
  -- is no "not chosen yet": the planner is always doing one or the other, and
  -- direct is the client's stated primary method.
  calc_mode   text not null default 'direct'
                check (calc_mode in ('direct', 'calculated')),

  -- "Wastage / Damage %" — the planned loss allowance, applied to Net to give
  -- Gross. Same range check `order_fabric_bom_lines.wastage_pct` carries, so the
  -- two cannot disagree about what a percentage is.
  wastage_pct numeric(6,2) not null default 0
                check (wastage_pct >= 0 and wastage_pct <= 100),

  created_at  timestamptz not null default now()
);

create index if not exists idx_ofbme_bom
  on public.order_fabric_bom_manual_entries(bom_id);

comment on table public.order_fabric_bom_manual_entries is
  'Fabric BOM ▸ Manual (0494) — one weight configuration: a fabric structure, a '
  'SET of components (see _components) and a gram weight per size (see _sizes). '
  'THE ENTRY IS THE COUNTING UNIT: requirement rows are produced per entry, and '
  'order_fabric_bom_lines no longer produces any. See the migration header.';


-- ---------------------------------------------------------------------------
-- 3. Which panels this entry's weight covers — the Component multi-select.
-- ---------------------------------------------------------------------------
create table if not exists public.order_fabric_bom_manual_components (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid not null
                 references public.order_fabric_bom_manual_entries(id) on delete cascade,

  -- The `components` MASTER (0228) — never `garment_style_components`, whose ids
  -- are rewritten on every save of the order (0421). Same target
  -- `order_fabric_bom_lines.component_id` points at.
  component_id uuid not null references public.components(id),

  created_at   timestamptz not null default now()
);

create index if not exists idx_ofbmc_entry
  on public.order_fabric_bom_manual_components(entry_id);

-- ONE PANEL ONCE PER ENTRY. Two rows are two claims on one weight and the
-- multi-select cannot express the difference. Across entries this is NOT
-- constrained — see the header for why that would reject a legitimate
-- multi-style BOM, and where the rule is enforced instead.
create unique index if not exists uq_ofbmc_entry_component
  on public.order_fabric_bom_manual_components(entry_id, component_id);

comment on table public.order_fabric_bom_manual_components is
  'Which garment panels one Manual entry''s weight covers (0494). A grouped '
  'entry names several — Front Body + Back Body + Sleeve at one combined weight. '
  'The client''s "no duplicate component allocation" rule is enforced in the '
  'dropdown, not here: one BOM covers several styles, and a cross-entry unique '
  'index would reject FRONT BODY appearing on a tee and on a polo.';


-- ---------------------------------------------------------------------------
-- 4. The size row — the gram weight and the widths it is knitted at.
-- ---------------------------------------------------------------------------
create table if not exists public.order_fabric_bom_manual_sizes (
  id               uuid primary key default gen_random_uuid(),
  entry_id         uuid not null
                     references public.order_fabric_bom_manual_entries(id) on delete cascade,
  sno              integer not null default 0,

  -- The order's own size, from `config_lookups` — the same target
  -- `order_fabric_bom_requirements.size_id` (0426) points at, so a manual row
  -- and the requirement row it feeds name one size by one id.
  size_id          uuid references public.config_lookups(id),

  -- "Dia / Width: the knitting/finishing diameter (60 Dia, 52 Dia, 28 Dia)".
  -- numeric(10,2) to match `order_fabric_bom_dias.dia` (0490),
  -- `order_fabric_bom_lines.dia` and `order_cad_marker_layouts.dia` — one type
  -- across all four, so a value can be compared rather than string-matched. The
  -- screen prepopulates it from the dias declared on Color/Print Details and
  -- leaves it editable, which is the client's own instruction.
  dia              numeric(10,2),

  -- "Purchase Width: the commercial width at which fabric is purchased." A
  -- SECOND width and not a duplicate of the dia: cloth is knitted at one and
  -- invoiced at another, and purchasing needs the one it buys against.
  purchase_width   numeric(10,2),

  -- THE FIGURE EVERYTHING DOWNSTREAM MULTIPLIES: the fabric weight in GRAMS for
  -- one garment of this size, for the panels this entry covers.
  --
  -- GRAMS AND NOT KILOGRAMS, because that is what the planner is given and what
  -- the CAD room measures in (`order_cad_component_weights.grams`, 0460, is the
  -- same unit for the same reason). numeric(14,3) keeps a milligram, which is
  -- past any real measurement and costs nothing.
  --
  -- Stored in BOTH modes — typed in direct, derived in calculated — so a reader
  -- never has to know which mode produced it. See the header.
  grams            numeric(14,3),

  -- The CALCULATED mode's inputs, in centimetres. Null on a direct entry, and
  -- kept on one that has been switched back: a sheet the planner may switch
  -- forward to again is work, and a save that erased it would make the mode
  -- dropdown destructive.
  width            numeric(10,2),
  length           numeric(10,2),
  length_tolerance numeric(10,2),

  created_at       timestamptz not null default now()
);

create index if not exists idx_ofbms_entry
  on public.order_fabric_bom_manual_sizes(entry_id);

-- ONE ROW PER SIZE PER ENTRY. Two rows are two gram weights for one size, of
-- which the requirement would take one and say nothing about the other.
-- `nulls not distinct` (PG 15+; this database is 17.6) makes that true of an
-- unnamed size as well — under the default, the commonest half-filled case
-- would be admitted without limit.
create unique index if not exists uq_ofbms_entry_size
  on public.order_fabric_bom_manual_sizes(entry_id, size_id)
  nulls not distinct;

comment on table public.order_fabric_bom_manual_sizes is
  'Fabric BOM ▸ Manual (0494) — one size of one entry: the dia it is knitted at, '
  'the width it is purchased at, and the gram weight per garment. Net Kg = order '
  'qty x grams / 1000; Gross Kg = Net x (1 + entry wastage%). width/length/'
  'length_tolerance are the CALCULATED mode''s inputs, not second answers.';


-- ---------------------------------------------------------------------------
-- 5. The requirement now points at an ENTRY, not a line.
-- ---------------------------------------------------------------------------
--
-- `line_id` was NOT NULL (0426), which was right while lines were what
-- exploded. Both parents are kept and exactly one is required per row, so the
-- table can still describe a line-based requirement — nothing reads one today,
-- and dropping the column would throw away 0426's whole shape for a change the
-- client could reverse.
alter table public.order_fabric_bom_requirements
  alter column line_id drop not null;

alter table public.order_fabric_bom_requirements
  add column if not exists entry_id uuid
    references public.order_fabric_bom_manual_entries(id) on delete cascade;

create index if not exists idx_ofbr_entry
  on public.order_fabric_bom_requirements(entry_id);

-- EXACTLY ONE PARENT. A row belonging to both is two claims on one quantity; a
-- row belonging to neither is a requirement nothing can explain. This is the
-- same shape `chk_ofbr_answer_or_reason` already uses one column along — the
-- database saying what the code must not be trusted to remember.
do $parent$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_ofbr_one_parent'
      and conrelid = 'public.order_fabric_bom_requirements'::regclass
  ) then
    alter table public.order_fabric_bom_requirements
      add constraint chk_ofbr_one_parent
      check ((line_id is null) <> (entry_id is null));
  end if;
end $parent$;

-- `uq_ofbr_slice` (0426) keys on `line_id`, so an entry-based document would
-- have every one of its rows collide on a NULL line under NULLS NOT DISTINCT.
-- Rebuilt over the parent that is actually set.
drop index if exists public.uq_ofbr_slice;
create unique index if not exists uq_ofbr_slice
  on public.order_fabric_bom_requirements(
    line_id, entry_id, style_ref_no, combo, size_id
  )
  nulls not distinct;

comment on column public.order_fabric_bom_requirements.entry_id is
  'The Manual entry this requirement was computed from (0494). Exactly one of '
  'line_id / entry_id is set — see chk_ofbr_one_parent. Entries are the counting '
  'unit as of 0494; nothing writes line_id today.';


-- ---------------------------------------------------------------------------
-- 6. RLS — the child shape, the same four policies every sibling carries.
-- ---------------------------------------------------------------------------
--
-- NO `location_id` on any of the three. They are children and grandchildren of
-- `order_fabric_boms`, which carries it and whose policies narrow on
-- `is_current_location()`; they are reached only through that parent, exactly as
-- `_lines`, `_requirements` and `_dias` are. A location here would be a second
-- answer to "which unit is this BOM" that nothing keeps in step with the first.
do $rls$
declare
  t text;
begin
  foreach t in array array[
    'order_fabric_bom_manual_entries',
    'order_fabric_bom_manual_components',
    'order_fabric_bom_manual_sizes'
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
