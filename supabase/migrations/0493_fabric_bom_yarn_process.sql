-- ============================================================================
-- Raagam ERP — 0493 Fabric BOM ▸ Yarn Process
--
-- The fifth tab of the Fabric BOM (client spec, 2026-09-01; legacy screenshot
-- 2587). It answers ONE question per yarn: does this raw yarn need a treatment —
-- in practice yarn dyeing — before it reaches the knitting machines, and what
-- does that treatment cost in material?
--
--     Yarn Description (read) · Yarn Process ▾ · Process Loss % · Purchase Wt
--
--
-- THE ROWS ARE DERIVED. THE ANSWERS ARE STORED. THAT SPLIT IS THE WHOLE TABLE.
--
-- The client's rule is explicit and has two halves: "the system must
-- automatically read the selected fabrics from the Fabric Allocation tab,
-- extract the yarn components … and split them into individual row entries", and
-- "the developer must ensure the planner CANNOT manually add new yarns here".
-- So there is no picker, no "+ Add", and no seed button — a row exists because a
-- fabric on this BOM is made of that yarn, and for no other reason.
--
-- What the planner types is the PROCESS and the LOSS, and those must survive.
-- Hence: `item_id` is the row's identity (NOT NULL, unique per BOM), and the
-- screen matches a stored answer back to a derived row by it. A yarn that stops
-- being in any fabric's composition stops rendering and its answer is dropped on
-- the next save — the intended reading of "that fabric is no longer on the BOM",
-- and the same call `normalizeProcesses` (0492) makes for a route whose line has
-- gone.
--
--
-- "THE BRACKET RULE" IS ALREADY STRUCTURED, AND THE DATA PROVES IT
--
-- The client describes extracting the yarns "specified inside the
-- parentheses/brackets of the Yarn Master". In this database that bracket is not
-- the source — it is a RENDERING of the source. Checked against live data on
-- 2026-09-01, 13 of 14 fabrics carry brackets in their name and every one of them
-- matches `material_mixings` exactly:
--
--   SOLID 1X1 LYCRA RIB (30'S COTTON COMBED 95%, 20'S ELASTANE 5%) 100%
--     -> material_mixings: 30'S COTTON COMBED 95.00 + 20'S ELASTANE 5.00
--
-- The name is COMPOSED from the mixing grid (`nameIsComposed` in
-- material-master-screen.tsx), so parsing the string would re-derive what
-- generated it — and would break the moment a yarn's name contained a comma.
-- `lib/orders/amendments/service.ts` already states the rule this depends on:
-- "a Fabric MUST declare `material_mixings` … each mixing line names a yarn".
-- So the bracket rule is implemented by reading the composition. Same fact,
-- read from the side that cannot be mis-parsed.
--
--
-- THE LOSS ENTERS THE ARITHMETIC HERE. THIS REVERSES 0492's SIBLING RULE.
--
-- 0492's Fabric Process tab is DECLARATIVE — its `loss_pct` is planned with in
-- step 4 and never multiplies anything on this document, because 0426 reserves
-- process loss for the Fabric Plan ("applying it here as well charges the same
-- loss twice"). The yarn side is deliberately NOT that, on the client's
-- instruction: "any percentage entered in the Process Loss % field must
-- automatically calculate the extra yarn required and append it to the overall
-- Yarn Purchase Weight", and that weight then "automatically transfer and
-- populate the Yarn Purchase section of the Budget".
--
-- A reader who finds those two rules side by side and assumes one is a mistake
-- is holding a real difference: 0492 declares a route for step 4 to plan, and
-- this computes a PURCHASE FIGURE the budget prices. The double-count 0426 warns
-- about is fabric loss applied twice to fabric; this is a yarn-stage loss applied
-- once, to a yarn quantity nothing else on this document produces.
--
--     Yarn Purchase Wt = Gross Fabric Required (kg) x share x (1 + loss/100)
--
-- `x (1 + loss/100)`, THE CLIENT'S OWN FORM, CHOSEN OVER 0427's WITH THE
-- DIVERGENCE PUT TO THEM AND CONFIRMED (2026-09-01). `order_fabric_plan_stages`
-- solves the same kind of loss as `input = output / (1 - loss/100)` and 0427's
-- header argues at length that the uplift form under-buys: at 10% on 100 kg this
-- gives 110, which loses 11 and delivers 99, where the backward solve gives
-- 111.12 and delivers 100. The client was shown both figures and chose this one.
-- **Do not "fix" it to 0427's form** — that is a decision to re-open with them,
-- not a bug to correct. `yarnPurchaseWeight()` in
-- lib/orders/fabric-bom/yarn-process.ts is the single implementation, with
-- vectors in scripts/check-yarn-process.mts.
--
--
-- `share` IS THE HALF THE SPEC DOES NOT MENTION AND CANNOT BE SKIPPED
--
-- The formula as written maps one fabric to one yarn. A fabric has SEVERAL —
-- 1X1 LYCRA RIB is 95% cotton and 5% elastane — so charging each yarn the whole
-- fabric weight would buy 100% cotton AND 100% elastane, i.e. twice the yarn for
-- a two-yarn fabric and three times for a three-yarn one. The share is
-- `material_mixings.blend_pct`.
--
-- AND IT IS OFTEN NULL, BY DESIGN. The material master HIDES the % column for a
-- Single Yarn fabric and for a yarn-dyed one (`hidePct` in
-- material-master-screen.tsx), so 11 of the 18 live mixing rows carry no
-- percentage. Two cases, two different right answers:
--
--   * ONE yarn and no percentage  -> it is the whole fabric. 100%, not a guess.
--   * SEVERAL yarns, no percentages -> REFUSED, with the reason on the row.
--     A yarn-dyed stripe of two counts might be 50/50 or 90/10 and nothing in
--     this database knows which. Splitting equally would be inventing a
--     purchase quantity, which is the one thing a figure a buyer acts on must
--     never be. `refusal_reason` is how this module already says that
--     (`chk_ofbr_answer_or_reason`, 0426) and it names the master to go and fix.
--
--
-- `purchase_qty` IS STORED, NOT PROJECTED — 0418's ARGUMENT, THIRD TIME
--
-- The budget PULLS this figure (`pullCostLines` in lib/orders/budget/service.ts,
-- a new `yarn` source), so it has to be a number that exists after the editor is
-- closed. It is computed in the same write as the requirement it is derived from,
-- for the reason 0426 gives for storing the fabric requirement and 0427 repeats
-- for the plan: "a quantity controller needs a number that cannot move under the
-- purchaser's feet."
--
--
-- NO STAGE, NO LOSS-FOR, NO DESCRIPTION COLUMN — AND THAT IS A DECISION
--
-- The legacy grid (screenshot 2587) nests a full route under each yarn:
-- S No · Stage · Process · For · Descriptions · Loss %. The client's spec
-- flattens it to three fields, and they confirmed the flatten with both shapes
-- in front of them (2026-09-01). One process per yarn is also what the single-
-- term formula above requires; a route of N steps would need the losses to
-- compound and the spec does not say how. The nested version was built first and
-- removed — if it comes back, it comes back with a compounding rule.
--
--
-- NO `location_id`. Fifth child of `order_fabric_boms`, and the four before it
-- carry none — the parent holds it and its policies narrow on
-- `is_current_location()`. Same paragraph as 0490's.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The rows.
-- ---------------------------------------------------------------------------
create table if not exists public.order_fabric_bom_yarns (
  id          uuid primary key default gen_random_uuid(),
  bom_id      uuid not null references public.order_fabric_boms(id) on delete cascade,
  sno         integer not null default 0,

  -- NOT NULL, unlike every other cell in this module, and the exception is the
  -- point: this row is DERIVED. It exists because a fabric on this BOM declares
  -- this yarn, so a row that names none is a row with no reason to exist —
  -- there is no half-typed state to protect, because nothing here is typed.
  item_id     uuid not null references public.items(id),

  -- The treatment, or NOTHING. Blank is a real answer and the ordinary one:
  -- "if the garment utilises solid-dyed fabric, the raw yarn is purchased and
  -- sent directly to knitting without any pre-treatment" (client). A required
  -- field here would make every solid order unsaveable.
  process_id  uuid references public.processes(id),

  -- Percentage of the yarn lost during that treatment.
  --
  -- `< 100`, AND NOT FOR 0427's REASON. There the bound is arithmetic — the
  -- backward solve divides by (1 - loss/100). The client's uplift form has no
  -- singularity, so this bound is a sanity guard rather than a necessity: a
  -- 100% loss means nothing survives the process, which is not a plan. Kept at
  -- the same bound as `order_fabric_plan_stages.loss_pct` and
  -- `order_fabric_bom_processes.loss_pct` so the three read alike, and so the
  -- day the two formulas are reconciled this column is already safe.
  loss_pct    numeric(6,2)
    check (loss_pct is null or (loss_pct >= 0 and loss_pct < 100)),

  -- ---- the computed answer, written by the server ------------------------
  -- Gross fabric required x this yarn's share x (1 + loss/100). See the header
  -- on why it is stored rather than projected.
  purchase_qty numeric(16,4),
  uom_id       uuid references public.uoms(id),
  -- NULL purchase_qty means REFUSED, never "none needed" — this says which case.
  refusal_reason text,

  created_at  timestamptz not null default now(),

  -- A row either carries a quantity or says why it has none. Verbatim in shape
  -- from `chk_ofbr_answer_or_reason` (0426): both filled is two answers nobody
  -- can interpret, neither filled is a row that means nothing.
  constraint chk_ofby_answer_or_reason
    check ((purchase_qty is null) <> (refusal_reason is null))
);

create index if not exists idx_ofby_bom  on public.order_fabric_bom_yarns(bom_id);
create index if not exists idx_ofby_item on public.order_fabric_bom_yarns(item_id);

-- ONE ROW PER YARN PER BOM, and here a unique index is the right tool where it
-- was not for the typed grids of 0490/0492. `item_id` is NOT NULL, so there is
-- no `nulls not distinct` question and no half-typed blank row for two of them
-- to collide on: the rows are derived from a de-duplicated yarn list.
create unique index if not exists uq_ofby_bom_item
  on public.order_fabric_bom_yarns(bom_id, item_id);

comment on table public.order_fabric_bom_yarns is
  'Fabric BOM ▸ Yarn Process (0493). One row per yarn the BOM''s fabrics are '
  'made of — DERIVED from material_mixings and never added by hand — carrying '
  'the treatment that yarn needs, its loss %, and the resulting purchase '
  'weight. The Budget pulls purchase_qty as its Yarn Purchase lines.';

comment on column public.order_fabric_bom_yarns.item_id is
  'The yarn. NOT NULL because the row is derived: it exists because a fabric on '
  'this BOM declares this yarn in material_mixings (the structured form of the '
  'legacy "bracket rule" — see the migration header).';

comment on column public.order_fabric_bom_yarns.process_id is
  'The yarn treatment, typically YARN DYEING. NULL is the ordinary answer for a '
  'solid fabric, whose yarn goes straight to knitting untreated.';

comment on column public.order_fabric_bom_yarns.purchase_qty is
  'Gross fabric required x this yarn''s blend share x (1 + loss_pct/100). The '
  'client''s own uplift form, chosen over 0427''s backward solve with the '
  'divergence put to them (2026-09-01) — do not "fix" it to 0427''s. Stored, '
  'never projected: a purchase is raised off it.';

comment on column public.order_fabric_bom_yarns.refusal_reason is
  'Why this yarn has no purchase weight — most often a fabric whose several '
  'yarns declare no blend percentages, where any split would be invented.';


-- ---------------------------------------------------------------------------
-- 2. The one process the client names, so the ▾ is not empty on day one.
--
-- "A selection of raw yarn treatments (primarily Yarn Dyeing / யான் டையிங்)"
-- — the client's own words, and the ONLY value they give. Seeded because the
-- live `processes` master holds four rows and NONE of them has a single
-- applicability flag set (checked 2026-09-01), so without this the dropdown is
-- empty and the tab cannot be used at all — the "empty master may be
-- unreachable" trap, arriving as a feature that looks broken on arrival.
--
-- ONE VALUE AND NOT ONE MORE. Adding DOUBLING, GASSING or MERCERISING beside it
-- would be the defaulted-vocabulary mistake AGENTS.md files under "Near misses",
-- where an invented word list "corrected" a Packing Accessories name to COTTON.
-- The planner extends the list on Master Data ▸ Materials ▸ Processes.
--
-- `where not exists` on the NAME, so a re-run adds nothing — and so an existing
-- YARN DYEING row (however it was spelled into being) is left exactly as it is
-- rather than duplicated beside itself.
-- ---------------------------------------------------------------------------
insert into public.processes (name, for_yarn, is_conversion)
select 'YARN DYEING', true, true
where not exists (
  select 1 from public.processes where upper(trim(name)) = 'YARN DYEING'
);


-- ---------------------------------------------------------------------------
-- 3. The Budget gains a `yarn` source.
--
-- "Once saved, the calculated yarn list, along with these final adjusted
-- purchase weights, must automatically transfer and populate the Yarn Purchase
-- section of the Budget" (client). 0428's `order_budget_lines.source` already
-- distinguishes PULLED sources (`fabric`, `material` — "a pulled line's quantity
-- is a stored requirement somebody else computed, so re-typing it would be a
-- second answer to an answered question") from typed ones. Yarn is a third
-- pulled source and not a variety of `material`: a material line comes from the
-- Material BOM, and putting yarn under the same word would make the budget
-- unable to say which document it came from or which section to show it in.
--
-- A CHECK cannot be altered in place, so this is the drop-and-recreate under the
-- same name that 0480 established as the idiom — anything looking the
-- constraint up by name keeps finding it.
-- ---------------------------------------------------------------------------
alter table public.order_budget_lines
  drop constraint if exists order_budget_lines_source_check;

alter table public.order_budget_lines
  add constraint order_budget_lines_source_check
  check (source in ('fabric','material','yarn','process','cmt','expense','income'));

comment on column public.order_budget_lines.source is
  'fabric | material | yarn are PULLED (the two BOMs, and the Fabric BOM''s '
  'Yarn Process tab); process | cmt | expense | income are typed. A pulled '
  'line''s quantity is a stored requirement somebody else computed, so '
  're-typing it would be a second answer to an answered question.';


-- ---------- RLS — the child shape, copied from 0490 which copied 0426 --------
do $rls$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'order_fabric_bom_yarns'
  ) then
    create policy order_fabric_bom_yarns_read on public.order_fabric_bom_yarns
      for select to authenticated using (public.has_permission('orders','view'));
    create policy order_fabric_bom_yarns_insert on public.order_fabric_bom_yarns
      for insert to authenticated with check (public.has_permission('orders','create'));
    create policy order_fabric_bom_yarns_update on public.order_fabric_bom_yarns
      for update to authenticated using (public.has_permission('orders','edit'))
      with check (public.has_permission('orders','edit'));
    create policy order_fabric_bom_yarns_delete on public.order_fabric_bom_yarns
      for delete to authenticated using (public.has_permission('orders','delete'));
  end if;
end $rls$;

alter table public.order_fabric_bom_yarns enable row level security;


-- ---------------------------------------------------------------------------
-- VERIFY (run by hand; each must return what the comment says)
--
--   -- the answer-or-reason guard is a real CHECK, not a convention (expect 1)
--   select count(*) from pg_constraint
--    where conrelid = 'public.order_fabric_bom_yarns'::regclass
--      and contype = 'c' and conname = 'chk_ofby_answer_or_reason';
--
--   -- the budget accepts a yarn line (expect the 7-value list)
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'order_budget_lines_source_check';
--
--   -- exactly one yarn-flagged process, so the ▾ has something in it (expect 1)
--   select count(*) from public.processes where for_yarn and not inactive;
-- ---------------------------------------------------------------------------
