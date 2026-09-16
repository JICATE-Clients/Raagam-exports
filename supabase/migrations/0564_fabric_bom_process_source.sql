-- ============================================================================
-- Raagam ERP — 0564 Fabric BOM ▸ Fabric Process: WHERE THE CLOTH COMES FROM.
--
-- `doc/order/fabriprocess.md` §2, client recording 2026-09-16 — "Default Rule
-- No. 1 vs Default Rule No. 2":
--
--   Rule 1  yarn_knit        buy raw grey yarn, knit greige rolls, then dye /
--                            wash / print. The route runs whole. This is what
--                            every fabric in this database has always been.
--   Rule 2  greige_purchase  buy ready-knitted greige rolls from the market.
--                            "Selecting Greige Fabric Purchase disables and
--                            suppresses Yarn Purchase and Knitting in the
--                            calculation engine. On the Material Requirement
--                            Sheet, the demand shifts directly to Greige
--                            Fabric Roll Weight (in Kg) rather than raw grey
--                            yarn."
--           dyed_purchase    incoming finished dyed rolls — "the engine
--                            similarly suppresses both Greige Knitting and
--                            Dyeing steps."
--
--
-- IT IS PER FABRIC, WHICH IS WHY IT SITS ON THIS TABLE
--
-- The user's own call (2026-09-16), and it is not the obvious one: a source
-- reads as a decision about an ORDER — "this season we are buying cloth". It
-- is not. One order legitimately buys greige rolls for the collar rib while
-- knitting the body, and a per-order flag could not express that without a
-- second exception mechanism beside it. `order_fabric_bom_process_scope` is
-- already exactly one row per (bom, fabric), keyed `item_id`, and already
-- carries the OTHER two facts that reshape a fabric's route (0528's
-- `assort_color_wise` / `component_wise`). A third belongs beside them rather
-- than in a table of its own, for 0528's own stated reason: "one table, one
-- shape, no branching on which case a row belongs to."
--
--
-- THE DEFAULT IS RULE 1 AND THE BACKFILL IS THEREFORE A NO-OP
--
-- Every existing row reads `yarn_knit`, which is what it WAS — not a guess
-- standing in for an unanswered question. Nothing in this app could declare a
-- purchased fabric before today, so there is no row whose true source is
-- unknown and none that needs inspecting. `not null default` does the whole
-- backfill; there is deliberately no `update` statement here to go wrong.
--
-- A FABRIC WITH NO SCOPE ROW AT ALL still reads Rule 1, and that has to keep
-- being true in TWO places, not one: absence means "both toggles off" to
-- 0528's readers, and it must also mean "yarn_knit" here. The app side states
-- the same default in `blankFabricProcessScope` and in
-- `fabricBomProcessScopeInput`'s `.default("yarn_knit")`, and `asFabricSource`
-- (lib/orders/fabric-bom/fabric-source.ts) is what makes a text column holding
-- anything else land on Rule 1 rather than on `undefined`.
--
-- `normalizeProcessScopes` (actions.ts) USED TO DROP A ROW WITH BOTH TOGGLES
-- OFF — correctly, while absence and false/false said the same thing. With a
-- third column on the table that is no longer true: a fabric that is
-- `greige_purchase` with neither toggle on is a real answer that has to
-- persist, and the filter is widened in the same change as this migration.
-- Leaving it would have made the Source ▾ a control that saved on some
-- fabrics and silently forgot on others.
--
--
-- `is_knitting` ON `public.processes` — THE SUPPRESSION NEEDS A NOUN
--
-- §2 suppresses two named PROCESSES, Knitting and Dyeing, not two stages.
-- That distinction is load-bearing and costs a column: the Greige stage also
-- holds HEATSETTING (spec §3), which a factory buying greige rolls may still
-- run in-house, so dropping "the Greige stage" would remove a real loss and
-- UNDER-BUY the cloth. `processes.is_dyeing` already exists (0557); nothing
-- distinguishes a Knitting process from any other, which is the same gap 0528
-- named for `is_print` and 0557 named again for `is_dyeing`.
--
-- SAME SHAPE AS BOTH OF THOSE, DELIBERATELY — one process-master flag, seeded
-- once from the master's own data, an operator-maintained checkbox from here
-- on, never re-derived from the name at read time. 0557's rejection of a
-- read-time name match applies here word for word: "KNIT" also appears in
-- Knitting Dia, Flat Knitting and Knit Fabric Inspection, and scoping the
-- seed to `for_fabric = true` is what keeps this flag meaning "the step that
-- makes greige cloth" rather than "any process with KNIT in its name".
--
-- AN UNFLAGGED KNITTING STEP ERRS UPWARD, WHICH IS THE POINT OF PUTTING THE
-- YARN HALF SOMEWHERE ELSE. The yarn suppression does not read this flag at
-- all — `yarnPurchase` skips a purchased fabric outright — so the expensive
-- half of Rule 2 cannot be defeated by an unticked checkbox. What a missing
-- flag costs is a greige demand grossed by a knitting loss it should not
-- carry: an over-buy of a percent or two, never an under-buy.
-- ============================================================================

-- ---------- 1. The source, per (bom, fabric) --------------------------------

alter table public.order_fabric_bom_process_scope
  add column if not exists source text not null default 'yarn_knit';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_ofbps_source'
  ) then
    -- RESTATED IN FULL rather than referenced, the same idiom every
    -- `config_lookups_kind_check` rewrite in this repo uses: a CHECK is only
    -- ever as correct as the last migration to write it, so it says all three
    -- values out loud and a fourth source is a fourth entry here.
    alter table public.order_fabric_bom_process_scope
      add constraint chk_ofbps_source
      check (source in ('yarn_knit', 'greige_purchase', 'dyed_purchase'));
  end if;
end
$$;

comment on column public.order_fabric_bom_process_scope.source is
  'WHERE THIS FABRIC COMES FROM (0564, doc/order/fabriprocess.md §2). '
  'yarn_knit = Default Rule 1, buy grey yarn and knit greige in-house — the '
  'default, and what every row predating this column was. greige_purchase = '
  'Default Rule 2, buy ready-knitted greige rolls: the engine suppresses Yarn '
  'Purchase and Knitting, and the Material Requirement Sheet asks for greige '
  'fabric roll weight in Kg instead of raw grey yarn. dyed_purchase = '
  'incoming finished dyed rolls: suppresses Knitting and Dyeing too. '
  'Suppression REMOVES the step from the ladder; a suppressed step left '
  'standing at 0% loss would divide by 1 and change nothing. Declared per '
  'FABRIC, never per order — one order may buy greige rolls for the collar '
  'rib while knitting the body.';

-- ---------- 2. The noun the suppression reads -------------------------------

alter table public.processes
  add column if not exists is_knitting boolean not null default false;

comment on column public.processes.is_knitting is
  'This process represents the GREIGE KNITTING step. Read by the Fabric BOM '
  'demand engine (0564) to drop Knitting from the ladder of a fabric whose '
  'source is greige_purchase or dyed_purchase, the same way is_dyeing (0557) '
  'and is_print (0528) are read by the Fabric Process picker. Seeded once '
  'from for_fabric processes already named KNIT; an operator-maintained '
  'checkbox from here on, never re-derived from the name at read time — '
  '''KNIT'' also appears in Knitting Dia, Flat Knitting and Knit Fabric '
  'Inspection, which this flag must NOT catch.';

update public.processes
  set is_knitting = true
  where is_knitting = false
    and for_fabric = true
    and name ilike '%knit%'
    -- THE THREE NAMES THE SEED MUST MISS, excluded by name because that is
    -- what the seed matches by. An operator ticking one of them back on is
    -- a decision the checkbox can express; a seed that swept them in is one
    -- nobody would notice until a demand came out short.
    and name not ilike '%dia%'
    and name not ilike '%inspect%'
    and name not ilike '%flat knit%';
