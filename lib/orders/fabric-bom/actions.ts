"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { isYarnDyed, missingFabricLineFields } from "./fabric-line-rules";
/* THE ONE RULE DECIDING WHICH ROUTE STEPS SURVIVE (2026-09-16). It lives in
   `./processes.ts` beside `fabricProcessRowStarted` rather than here because
   the SCREEN reads it too, and a `"use server"` file can export nothing but
   async Server Functions — so this file cannot be the home of a predicate two
   readers share. See its own header for the drift that made it one function. */
import { processRowInScope, stageRouteProblems } from "./processes";
import { yarnShadesFrom } from "./yarn-dyed";
import { fabricBomInput, type FabricBomFormInput, type FabricBomInput } from "./types";
import {
  getBomYarnComposition,
  getFabricProcessLookupRows,
  getFabricProcessRows,
  getOrderFabricSeed,
  getOrderPalette,
  getOrderProduction,
  getOrderStyleComponents,
  type BomYarnComposition,
} from "./service";
import type { OrderFabricSeedRow, OrderPalette } from "./types";
import type { StyleComponentDecl } from "./component-map";
/* NO `fabricBasisOf` / `FabricBasis` ANY MORE (0494). They resolved a LINE's
   Split cell, and `requirementRows` now hardcodes `colour_size` — an entry
   states grams per size, and fabric is dyed per colourway, so there is no second
   basis for it to choose between. Both remain exported for the engine's own
   callers and its vector suite. */
import {
  fabricRequirementRows,
  isRefusal,
  type Refusal,
} from "./requirement";
import { componentIdsOf, consumptionMap, panelKeyOf, type ManualPanel } from "./manual";
import { fabricBomEntryRegister, yarnFabricRequirementReport } from "./reports";
/* Color/Print Details' three panels write the ORDER's palette (client
   2026-09-02). The diff and the citation guard are pure and shared with the
   screen, so the warning an operator sees while typing and the refusal the
   server returns come from one function — see ./palette.ts. */
import {
  citationProblem,
  normPaletteName,
  paletteDiff,
  type PaletteCitation,
} from "./palette";
/* `isRefusal` is NOT re-imported here — `./requirement`'s is already in scope
   above and `yarn-process.ts` re-exports that very function, so a second alias
   would be two names for one predicate. */
import {
  comboKey,
  stageProblem,
  stageProcessQty,
  yarnPurchase,
  yarnStageStarted,
  type FabricComposition,
  type FabricGross,
  type YarnShade,
  type RouteStage,
} from "./yarn-process";
/* WHERE EACH FABRIC COMES FROM (0564) — the rule is client-safe and shared
   with the screen, so the preview and this write suppress the same steps. */
import { asFabricSource, type FabricSource } from "./fabric-source";
import {
  basisFingerprint,
  totalProductionOf,
  isRefusal as isOrderRefusal,
  type OrderProductionInput,
} from "@/lib/orders/material-bom/requirement";
import { kilogramUom } from "@/lib/uom/kilogram";

type Result = { ok: true; id?: string } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}

/**
 * The routes a saved fabric BOM changes.
 *
 * Four, for the reason the Material BOM's `rev()` gives: the BOM's state is a
 * COLUMN on screens that are not this one, so leaving them stale means saving a
 * BOM does not change the badge the operator is looking at. `/orders/setup` is
 * here and not on the Material side because the hub carries a per-card count.
 */
function rev(): void {
  revalidatePath("/orders/fabric-bom");
  revalidatePath("/orders/amendments");
  revalidatePath("/orders/garment-orders");
  revalidatePath("/orders/setup");
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

// ---------------------------------------------------------------------------
// Normalising the lines
// ---------------------------------------------------------------------------

type LineRow = ReturnType<typeof normalizeLines>[number];
type LineRowWithId = LineRow & { id: string };

/**
 * Drop the rows that are only scaffolding, and renumber.
 *
 * A ROW IS EMPTY WHEN IT NAMES NO FABRIC AND CARRIES NO CONSUMPTION. Not "every
 * field is blank": a seeded row arrives with a combo, a structure and a
 * component already filled in from the order, so an all-blank test would keep
 * every seeded row the operator chose not to use — and each of those would then
 * refuse for want of a consumption, filling the Calculated Quantities section
 * with rows the operator deliberately left alone.
 */
function normalizeLines(data: FabricBomInput) {
  return data.lines
    .map((c) => ({
      style_ref_no: clean(c.style_ref_no),
      combo: clean(c.combo),
      structure_id: c.structure_id ?? null,
      coordinate_id: c.coordinate_id ?? null,
      component_id: c.component_id ?? null,
      item_id: c.item_id ?? null,
      fabric_type: clean(c.fabric_type),
      color_name: clean(c.color_name),
      fabric_form: c.fabric_form ?? null,
      layout_type: c.layout_type ?? null,
      required_print: clean(c.required_print),
      specification: clean(c.specification),
      /* THE TWO YARN-DYED CELLS (0513). THIS MAP IS FIELD BY FIELD, so a column
         missing from it is dropped on every save with nothing to say so — the
         same silence the sales registers hit when they rebuilt a row and lost
         `created_by` (AGENTS.md). Add here as well as to the schema. */
      mixing_uom_id: c.mixing_uom_id ?? null,
      no_of_colors: c.no_of_colors ?? null,
      consumption: c.consumption ?? null,
      consumption_uom_id: c.consumption_uom_id ?? null,
      wastage_pct: c.wastage_pct ?? 0,
      requirement_basis: c.requirement_basis ?? null,
      dia: c.dia ?? null,
      required_by: clean(c.required_by),
      rate: c.rate ?? null,
      notes: clean(c.notes),
      sno: 0,
    }))
    .filter((c) => c.item_id !== null || c.consumption != null)
    .map((c, i) => ({ ...c, sno: i + 1 }));
}

/**
 * The Manual entries worth storing, with their components and sizes (0494).
 *
 * AN ENTRY SAYS SOMETHING WHEN IT NAMES A STRUCTURE OR ANY COMPONENT. Not "is
 * complete": a planner who has picked Single Jersey and not yet chosen the
 * panels is mid-entry, and dropping that row would delete what they were in the
 * middle of — the same call `normalizeDias` makes for a knit type with no
 * diameter. What decides whether an entry is ANSWERED is `manualProblem`, and it
 * is a different question from whether it is worth keeping.
 *
 * THE CHILDREN TRAVEL INSIDE THE ENTRY, and it is not a convenience:
 * `order_fabric_bom_manual_components.entry_id` and `_sizes.entry_id` are NOT
 * NULL, and an entry's id does not exist until its insert has run. Carrying them
 * here is what lets `writeLines` pair each set with the id it reads back,
 * without a second index into a list this filter has already thinned.
 */
function normalizeManualEntries(data: FabricBomInput) {
  return data.manualEntries
    .map((e) => ({
      style_ref_no: clean(e.style_ref_no),
      width_form: e.width_form ?? null,
      /* THE CLOTH, NAMED (0522). `structure_id` rides along but is OVERWRITTEN
         from this fabric before the insert — see `withDerivedStructure`. It is
         kept on the shape because `requirementRows` keys the order's GSM by it. */
      item_id: e.item_id ?? null,
      structure_id: e.structure_id ?? null,
      calc_mode: e.calc_mode ?? "direct",
      wastage_pct: e.wastage_pct ?? 0,
      endbit_loss_pct: e.endbit_loss_pct ?? 0,
      assort_color_wise: e.assort_color_wise ?? false,
      /* "SIZE WISE", WHICH THIS NORMALISER DROPPED ON THE FLOOR (2026-09-11).
         The planner's answer reached the action and was validated, and then
         every insert went to Postgres with the column ABSENT — so the stored
         value was the table default on every single save, and the toggle was
         never wired to anything.

         IT LOOKED FIXED FROM BOTH ENDS, which is why it survived a week. The
         screen seeds `size_wise: false` and reads it back with a `?? false`
         fallback; the schema defaults it to false; 0555 flips the column
         default to false. Four statements of one default, all agreeing, and no
         write between them. Before 0555 every entry read back TRUE having never
         been switched on — the grid fanned into a row per size with no
         keystroke anywhere asking for it (client 2026-09-04: "its auto enabled
         so disable it"). 0555 alone would have made it store FALSE just as
         unconditionally, which is the same defect wearing the answer the client
         asked for: a control that looks live and changes nothing, exactly what
         `mba-master-screen.tsx` records for its own `size_wise`.

         0555'S HEADER IS WRONG ON ONE POINT and is left as written, because a
         migration records what was believed when it ran. It says the insert
         "spreads the PARSED entry", so the schema default was what reached
         Postgres. The insert spreads the NORMALIZED entry — this object — and
         the schema's value never survived the map. The column default is still
         worth having as the floor under a `lib/data-io` import, which is 0555's
         other stated reason and is unaffected.

         `?? false` matches `assort_color_wise` above and every other statement
         of this default; the schema has already resolved it, so the coalesce is
         the belt on the braces rather than a second opinion. */
      size_wise: e.size_wise ?? false,
      sno: 0,
      /* DEDUPED ON THE PAIR (0569), because `uq_ofbmc_entry_panel` would reject
         the second copy and take the whole save with it. Keyed through
         `panelKeyOf` rather than by hand: that index counts an unstated
         coordinate as one value (`coalesce` to the all-zero uuid) and so does
         the key, so the two cannot disagree about what a duplicate is. The
         sheet cannot produce one today; a `lib/data-io` import could.

         TOP's ALL BODY AND BOTTOM's ALL BODY SURVIVE EACH OTHER, which is the
         whole of 0569: one component, two coordinates, two panels. */
      panels: dedupePanels(e.panels ?? []),
      /* WHICH COLOURWAYS THIS WEIGHT IS FOR (0567). Deduped for
         `uq_ofbmcb_entry_combo`'s sake, exactly as the panels above are, and
         TRIMMED because the value is compared with `comboKey` downstream while
         being stored verbatim — an untrimmed " WHITE" would store a second row
         the index cannot see as a duplicate.

         KEPT EVEN WHEN THE TOGGLE IS OFF. The rows are only READ when
         `assort_color_wise` is on (see `requirementRows`), and dropping them
         here would make the toggle destructive: switch it off to check a total,
         switch it back, and the ticks are gone. Same reasoning
         `normalizeManualSizes` gives for keeping a calculated mode's
         measurements after a switch back to Direct. */
      combos: [...new Set((e.combos ?? []).map((c) => c.trim()).filter(Boolean))],
      sizes: normalizeManualSizes(e.sizes ?? []),
    }))
    /* A ROW SAYS SOMETHING WHEN IT NAMES A CLOTH OR A PANEL. `item_id` replaced
       `structure_id` here in 0522 for the reason the whole entry changed grain:
       the structure is no longer typed, so a row carrying one and nothing else
       is a row the planner never started. */
    .filter((e) => e.item_id !== null || e.panels.length > 0)
    .map((e, i) => ({ ...e, sno: i + 1 }));
}

/**
 * THE PANELS ONE ENTRY STORES, deduped on the (coordinate, component) PAIR.
 *
 * `uq_ofbmc_entry_panel` (0569) counts an unstated coordinate as one value — it
 * indexes `coalesce(coordinate_id, <all-zero uuid>)` — and `panelKeyOf` spells
 * the same thing, so a payload that names one panel twice is thinned here
 * rather than taking the whole save down at the insert.
 */
function dedupePanels(panels: readonly ManualPanel[]): ManualPanel[] {
  const seen = new Set<string>();
  const out: ManualPanel[] = [];
  for (const p of panels) {
    const k = panelKeyOf(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ coordinate_id: p.coordinate_id ?? null, component_id: p.component_id });
  }
  return out;
}

/**
 * One entry's size rows worth storing, renumbered (0494).
 *
 * A ROW SAYS SOMETHING WHEN IT NAMES A SIZE AND CARRIES ANY FIGURE. Both halves
 * earn their place:
 *
 *  - **A size is required** because these rows are DERIVED — the screen opens one
 *    per size the order states, so an unsized row is scaffolding by definition
 *    and `uq_ofbms_entry_size` would admit exactly one of them and then reject
 *    the next.
 *  - **Any figure will do**, not the grams specifically. A planner who has typed
 *    the width and the length and not yet reached the weight is mid-calculation,
 *    and the dia alone is a real answer about how the cloth is knitted.
 *
 * The entry's own `calc_mode` is deliberately NOT consulted. Measurements
 * entered and then switched back to Direct are work the planner may switch
 * forward to again, and a save that quietly erased them would make the mode
 * dropdown destructive.
 */
function normalizeManualSizes(rows: FabricBomInput["manualEntries"][number]["sizes"]) {
  return rows
    .map((r) => ({
      size_id: r.size_id ?? null,
      dia: r.dia ?? null,
      purchase_width: r.purchase_width ?? null,
      grams: r.grams ?? null,
      table_width: r.table_width ?? null,
      length: r.length ?? null,
      length_tolerance: r.length_tolerance ?? null,
      cons_qty: r.cons_qty ?? null,
      finished_width: r.finished_width ?? null,
      sno: 0,
    }))
    .filter(
      (r) =>
        r.size_id !== null &&
        (r.dia != null ||
          r.purchase_width != null ||
          r.grams != null ||
          r.table_width != null ||
          r.length != null ||
          r.length_tolerance != null ||
          /* `cons_qty` COUNTS AS SAYING SOMETHING (0523). It is the spec's own
             multiplier and a row carrying only it is a row the planner typed
             into — dropping it here would silently discard the figure the CAD
             report gave them. */
          r.cons_qty != null ||
          /* THE "Widths" POPUP'S OTHER FIELD COUNTS TOO (0526) — a row touched
             only through that button and never through the main grid is still
             a row the planner answered. */
          r.finished_width != null),
    )
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

/**
 * The Dia / Size / Width rows worth storing, renumbered (0490).
 *
 * A ROW SAYS SOMETHING WHEN IT CARRIES EITHER HALF. Not "both": an operator who
 * has picked Circular and not yet typed the diameter has said something, and a
 * both-halves test would silently drop the row they were in the middle of —
 * the same failure `toleranceStated` records for a garbage tolerance ("dropping
 * it would delete what the operator was in the middle of typing").
 *
 * A ZERO DIA IS A VALUE, hence `!= null` rather than a truthiness test. It is
 * not a sensible diameter, but it is a typed one, and refusing to store it
 * would make the box appear to accept a figure it then threw away.
 */
function normalizeDias(data: FabricBomInput) {
  return data.dias
    .map((d) => ({
      knit_type: d.knit_type ?? null,
      dia: d.dia ?? null,
      sno: 0,
    }))
    .filter((d) => d.knit_type !== null || d.dia != null)
    .map((d, i) => ({ ...d, sno: i + 1 }));
}

/**
 * The route rows worth storing, renumbered PER FABRIC (0492).
 *
 * ## A ROW SAYS SOMETHING WHEN IT NAMES A PROCESS
 *
 * STRICTER THAN `normalizeDias` ABOVE, and deliberately. A dia keeps either
 * half because both halves are the answer. A route step is a step in a ROUTE:
 * a stage with no process is not a partial step, it is a row that would make
 * step 4 plan a stage it cannot name, and 0427's `stageProblem()` would then
 * refuse the plan with nothing to say which BOM row caused it. The screen still
 * lets the operator type a stage first — the cells hold the cursor while the row
 * is started (`fabricProcessRowStarted`) — this only decides what is WRITTEN.
 *
 * A LOSS OR A RATE WITH NO PROCESS GOES TOO, for that reason and one more: both
 * are figures about a step that does not exist.
 *
 * ## RENUMBERED PER FABRIC, AND IT WAS PER GROUP UNTIL 2026-09-16
 *
 * 0492's unique index was (bom_id, item_id, sno); 0528 widened it to
 * (bom_id, item_id, combo, component_id, sno) for the split routes, and the
 * counter then restarted per (fabric, combo, component) GROUP — WHITE's steps
 * and BLACK's each counting 1, 2, 3, on the reading that they were two routes
 * that happened to share a fabric.
 *
 * THAT READING DIED WITH THE BLANK COMBO (below). Once a step with no colour
 * belongs to EVERY colour, WHITE's route is no longer a self-contained list:
 * it is the unscoped steps and WHITE's own steps, and somebody has to say in
 * what order. Per-group numbering cannot answer that — Knitting, Dyeing and
 * Compacting count 1, 2, 3 in the unscoped group while RED's single Bio-wash
 * counts 1 in its own, so any merge by `sno` puts the Bio-wash SECOND, before
 * the dyeing it is supposed to follow.
 *
 * So `sno` is now the step's position in THE FABRIC'S WHOLE ROUTE, across
 * every group, exactly as the screen's rows are ordered. RED's Bio-wash
 * between Dyeing and Compacting is 3, and the unscoped steps around it are
 * 1, 2 and 4. `stagesForGroup` filters without re-sorting (its own header says
 * so), both readers already fetch ascending — `service.ts:158` sorts the
 * screen's embed, `reports.ts` orders the ladder's query — so **the interleave
 * needs no walker and no new sequencing concept.** It falls out of a numbering
 * that was always implied by "ascending `sno` is chronological".
 *
 * THE ALTERNATIVE WAS CONSIDERED AND REJECTED: append each colour's extras
 * after the shared steps, so a colour's route is "everything unscoped, then
 * its own". That is simpler to compute and wrong for the case the feature
 * exists for — a Bio-wash belongs BETWEEN dyeing and compacting, and the
 * client's own example (a dark shade needing an extra step the light ones do
 * not) says nothing about that step being last. A rule that can only add to
 * the END of a route would silently re-order the one thing an operator came
 * here to position, and compound its loss in the wrong place.
 *
 * `uq_ofbp_item_sno` is satisfied more easily than before, not less: every row
 * of a fabric now holds a distinct `sno`, so the five-column unique cannot
 * collide whatever the combo and component are. The widened index stays as it
 * is — it is still correct, merely no longer load-bearing.
 *
 * ## ORPHANS GO SILENTLY, AND THAT IS THE INTENDED READING
 *
 * A route whose fabric no longer appears on any line is dropped: the operator
 * removed that fabric from the BOM, and keeping steps for cloth this document
 * no longer plans would leave the Budget costing a process nobody ordered. The
 * screen keeps such a card VISIBLE while its rows exist, so this is never the
 * first the operator hears of it.
 *
 * A step whose GROUP no longer matches the fabric's current toggles is
 * dropped the same way — a colour-wise step left over from before "Assort
 * Color Wise" was switched off (it carries a `combo` a now-unified route has
 * nowhere to put). Checked against
 * the SCOPE, not against which colourway/component values still exist on the
 * fabric's lines — the same trust level `stage_id` / `process_id` already get
 * here (the database's own FK is what refuses a value naming nothing real).
 *
 * THE SCREEN'S MIRROR IS `inScope` in `fabric-bom-screen.tsx`'s Fabric Process
 * panel — `(scope.assort_color_wise || !p.combo) && (scope.component_wise ||
 * !p.component_id)` — which decides which rows the grid SHOWS. This docblock
 * named `orphanedProcessCount` until 2026-09-16 and that function no longer
 * exists: it drove the drop-on-save warning the client had removed on
 * 2026-09-04 ("remove this messag too"), and the reference outlived it.
 *
 * The two now agree, and until 2026-09-16 they did not — which is precisely
 * how the blank-combo bug hid. `inScope` has always SHOWN a blank-combo row on
 * a colour-wise route (its first clause is `scope.assort_color_wise ||`, true
 * before the value is even read), while this function deleted it. The operator
 * typed a shared step, saw it on screen, saved, and it was gone: visible,
 * plausible and wrong, with nothing empty and nothing raised.
 */
function normalizeProcesses(
  data: FabricBomInput,
  fabricIds: Set<string>,
  scopeByItem: Map<string, { assort_color_wise: boolean; component_wise: boolean }>,
) {
  const nextSno = new Map<string, number>();
  const out: Record<string, unknown>[] = [];

  for (const p of data.processes) {
    if (!p.process_id) continue;
    if (!fabricIds.has(p.item_id)) continue;
    const scope = scopeByItem.get(p.item_id) ?? { assort_color_wise: false, component_wise: false };
    /* A BLANK `combo` ON A COLOUR-WISE ROUTE MEANS EVERY COLOUR (2026-09-16),
       and it used to mean the row was deleted. The guard was
       `scope.assort_color_wise !== !!p.combo`, i.e. "the toggle and the value
       must agree in BOTH directions", which made the 99% case of the feature
       unwritable: the client's own description is that all colours share one
       sequence and one dark shade needs an extra step, and a route that could
       not carry an uncoloured step forced the shared sequence to be re-typed
       per colourway — four colours x three steps + 1 = thirteen rows for what
       is four.

       THE ENGINE HAS ALWAYS READ IT THIS WAY. `stageCoversCombo` (0504,
       restored 0529) is `comboKey(stageCombo) === "" || … === combo`, and its
       own header says "A BLANK `stageCombo` MEANS EVERY COLOURWAY — the
       ordinary case, and the only thing a blank box can mean here." So this
       guard was the one place in the module that disagreed with the rule the
       arithmetic runs on, and it disagreed by silently deleting rows.

       THE OTHER DIRECTION STILL DROPS, and that half is deliberate: a step
       carrying a colour while the toggle is OFF has nowhere to put it, which
       is the orphan rule the docblock above describes and the screen's own
       `orphanedProcessCount` mirrors. So the test is now one-way. */
    if (!processRowInScope(p, scope)) continue;
    /* PER FABRIC, NOT PER GROUP — see "RENUMBERED PER FABRIC" above for why
       the merge needs one sequence and why appending each colour's extras
       after the shared steps was the wrong answer. */
    const snoKey = p.item_id;
    const sno = (nextSno.get(snoKey) ?? 0) + 1;
    nextSno.set(snoKey, sno);
    out.push({
      item_id: p.item_id,
      combo: p.combo ?? null,
      component_id: p.component_id ?? null,
      sno,
      stage_id: p.stage_id ?? null,
      process_id: p.process_id,
      loss_for_id: p.loss_for_id ?? null,
      loss_pct: p.loss_pct ?? null,
      type_id: p.type_id ?? null,
    });
  }
  return out;
}

/**
 * The per-fabric route SCOPE worth storing (0528 · 0564) — one row per fabric
 * that still exists on the BOM and has something to say about its route.
 *
 * ## "SOMETHING TO SAY" GREW A THIRD MEANING AND THE FILTER HAD TO GROW WITH IT
 *
 * 0528's rule was "at least one toggle on", and it was exactly right while
 * the row held nothing but those two toggles: a fabric with neither needs no
 * row, because absence already reads as "both off" — 0492's original unified
 * shape — so a false/false row would only be a second way to say nothing.
 *
 * 0564 put `source` on the same row, and that sentence stopped being true.
 * A fabric that is `greige_purchase` with NEITHER toggle on is a real answer
 * the operator gave, and the old filter would have dropped it on the floor:
 * the Source ▾ would have saved on a colour-wise fabric and silently forgotten
 * on a unified one, which is worse than not having the control. So the test is
 * now "any toggle on OR a source other than Rule 1", and the default source is
 * what keeps absence meaning what it always meant.
 */
function normalizeProcessScopes(data: FabricBomInput, fabricIds: Set<string>) {
  return data.processScopes
    .filter(
      (s) =>
        fabricIds.has(s.item_id) &&
        (s.assort_color_wise || s.component_wise || asFabricSource(s.source) !== "yarn_knit"),
    )
    .map((s) => ({
      item_id: s.item_id,
      assort_color_wise: s.assort_color_wise,
      component_wise: s.component_wise,
      /* THROUGH `asFabricSource`, NOT `?? "yarn_knit"` — the Zod schema has
         already defaulted an absent field, and this is the second guard for
         the value the schema cannot refuse: a `lib/data-io` import, or a
         stale client, posting a string that is not one of the three. The
         column's own CHECK would reject it and take the whole save with it,
         naming a constraint rather than a fabric. */
      source: asFabricSource(s.source),
    }));
}

// ---------------------------------------------------------------------------
// The stored requirement
// ---------------------------------------------------------------------------

/**
 * The requirement rows a saved BOM's MANUAL ENTRIES explode into (0494).
 *
 * ## THE ENTRY IS THE COUNTING UNIT, AND THE LINES ARE NOT
 *
 * It was one explosion per LINE until 0494 (client decision, 2026-09-01). An
 * entry states one combined weight for a SET of components — Front + Back +
 * Sleeve at 180 g — so exploding the lines it covers would multiply that 180 g
 * three times and plan the order at 540 g. There is no split to apply instead:
 * the client's spec gives a combined figure and no per-panel breakdown, and any
 * split invented here would be a number nobody typed driving a purchase.
 *
 * What keeps the total right is the client's own "no duplicate component
 * allocation" rule (`takenComponentIds` in ./manual.ts): each panel belongs to
 * exactly one entry, so the entries PARTITION the garment and their sum is its
 * fabric weight once.
 *
 * ## IT IS THE SAME ENGINE, FED DIFFERENTLY
 *
 * `fabricRequirementRows` with `bySize` — grams/1000 per size — which computes
 * `slice.qty x consumption x (1 + wastage/100)`, exactly the spec's Formula 1
 * and Formula 2. No second multiplication was written for this tab, deliberately:
 * `doc/orders-six-step.md` names Fabric BOM and Fabric Plan as the pair that
 * must never report different quantities for one order, and two formulas is how
 * that starts.
 *
 * ALWAYS `colour_size`, and the entry has no say in it. Grams are stated per
 * size, so the requirement must carry a size axis; and fabric is dyed per
 * colourway, which is 0426's reason there is no un-split basis on this document
 * at all. An entry is UNSCOPED — it names a structure, not a style or a
 * colourway — so it covers every slice of the order.
 *
 * EVERY ENTRY PRODUCES AT LEAST ONE ROW, including a refused one, for the reason
 * 0426 gives: an entry that simply produced nothing would leave the document
 * with fewer rows than the planner expects and no statement of why — and "fewer
 * rows" is the shape a short order takes, so it reads as an answer.
 */
type EntryRowWithId = ReturnType<typeof normalizeManualEntries>[number] & { id: string };

/**
 * The fabric an entry is for — READ OFF THE ENTRY SINCE 0522.
 *
 * AN ENTRY NAMES THE CLOTH DIRECTLY. Legacy's Manual row leads with a Fabric
 * column and carries no Structure column (client 2026-09-03, screenshots
 * 2666 · 2667), so the planner states which cloth this weight is for and there
 * is nothing left to infer.
 *
 * ## WHAT THIS DELETED, AND WHY THAT IS THE POINT
 *
 * 0494 keyed the entry on a STRUCTURE and resolved the cloth by matching the
 * entry's structure and style against the saved Fabric Lines, narrowing by
 * component and abstaining when more than one fabric survived. That abstention
 * was not a rare edge — its own comment named the case, "a structure carrying
 * two different fabrics across its lines is a real state on a multi-style
 * order" — and its consequence was a requirement row with `required_qty` NULL
 * and a refusal the planner could clear only by restructuring their own BOM.
 *
 * Naming the cloth removes the question instead of answering it better. Two
 * refusals, a component-narrowing pass and a style-matching pass go with it.
 *
 * ## THE UNIT IS THE KILOGRAM, BECAUSE THE FIGURE IS `grams / 1000`
 *
 * Until 2026-09-16 this section read "THE UNIT COMES OFF THE CLOTH" and the
 * row was stamped with `items.base_uom_id`. That was right while a LINE's
 * `consumption` was typed in the cloth's own unit (0426); 0494 made the Manual
 * entry the counting unit, and an entry's figure is a gram weight per garment
 * in BOTH modes (`order_fabric_bom_manual_sizes.grams`, "THE FIGURE EVERYTHING
 * DOWNSTREAM MULTIPLIES"), so `required_qty` has been `cons_qty x grams / 1000`
 * — kilograms — on every row this function has written since. The label kept
 * coming from the old source, and a NOS-based cuff and an MTR-based chambray
 * beside a KGS-based body on ONE yarn (HO/RE/26-27/0007) made `yarnPurchase`
 * refuse "measured in different units" over three figures that were all kg.
 * The Budget priced 16.05 "NOS" of that cuff, and the Entry Register's Unit
 * column printed NOS beside a weight. One mislabel, three readers.
 *
 * So the unit is resolved ONCE per save (`kilogramUom`, shared with the CAD
 * seed) and stamped on every row, and `decimals` is the kilogram's precision.
 * A master with no active kg row REFUSES the save by name rather than writing
 * a weight with no unit behind it. 0562 relabels the rows saved before this.
 */
type EntryFabric = { item_id: string };

/**
 * What the entries' cloths say about themselves — `items.category_id` (which IS
 * the structure, 0405 · 0415 · 0426), by item id. `base_uom_id` is no longer
 * read here: it is the unit the cloth is BOUGHT in, not the unit its weight is
 * planned in (see the section above).
 *
 * READ ONCE PER SAVE rather than joined per entry: a BOM has a handful of
 * entries and they routinely name the same cloth.
 */
type FabricFacts = Map<string, { category_id: string | null }>;

function entryFabric(entry: { item_id: string | null }): EntryFabric | Refusal {
  if (!entry.item_id) {
    /* THE SAME SENTENCE `manualProblem` USES for the same state, deliberately:
       "two spellings of one refusal is how an operator comes to believe there
       are two different problems" (./manual.ts). */
    return { refused: "Choose the fabric this weight is for" };
  }
  return { item_id: entry.item_id };
}

function requirementRows(
  entries: EntryRowWithId[],
  order: OrderProductionInput,
  /* THE ONE UNIT EVERY ROW IS IN — see the section above `EntryFabric`. */
  kg: { id: string; decimals: number | null },
  gsmByStructure: Map<string, number>,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let sno = 0;

  for (const entry of entries) {
    const fabric = entryFabric(entry);

    /* A REFUSAL STILL PRODUCES A ROW, and it still has to satisfy the table's
       own constraints: `basis` is NOT NULL with a CHECK, `consumption` and
       `basis_qty` are NOT NULL, and `chk_ofbr_one_parent` (0494) wants exactly
       one parent. `required_qty` NULL is what carries the meaning; nothing reads
       the rest as a claim. */
    const refuse = (reason: string) => {
      out.push({
        entry_id: entry.id,
        line_id: null,
        item_id: isRefusal(fabric) ? null : fabric.item_id,
        /* THE ENTRY'S OWN STYLE, not null. A refusal row is the document saying
           WHY a quantity is missing, so it has to name what it was refused for —
           and on a multi-style order "some entry could not compute" is not
           something anyone can act on. NULL here still reads as "every style",
           which is a real value on an unscoped entry. */
        style_ref_no: entry.style_ref_no,
        combo: null,
        size_id: null,
        sno: ++sno,
        basis: "colour_size",
        slice_label: "—",
        basis_qty: 0,
        consumption: 0,
        wastage_pct: entry.wastage_pct ?? 0,
        consumption_uom_id: kg.id,
        required_qty: null,
        refusal_reason: reason,
      });
    };

    if (isRefusal(fabric)) {
      refuse(fabric.refused);
      continue;
    }

    /* GSM IS THE ORDER'S, and it is read here rather than on the entry for the
       reason 0426 gives for the seed: a copy on the BOM is a second place for it
       to disagree with the order. It only matters in `calculated` mode, where it
       is what turns the measurements into grams — `consumptionMap` returns
       nothing for a size it cannot weigh, and the engine then refuses that size
       by name rather than planning it at zero. */
    const gsm = entry.structure_id ? (gsmByStructure.get(entry.structure_id) ?? null) : null;

    const bySize = consumptionMap(entry.calc_mode, entry.sizes, gsm);
    const rows = fabricRequirementRows(
      "colour_size",
      /* SCOPED TO THE ENTRY'S STYLE (0495), and to every colourway of it.
         `style_ref_no` NULL still means "every style" — the reading
         `fabricSlices` has given it since 0426 — so an unscoped entry behaves
         exactly as it did under 0494 and a single-style order is unaffected.

         SCOPED BY COLOURWAY ONLY WHEN THE ENTRY SAYS SO (0567). The default is
         still every colourway of the style, and for the reason this comment has
         always given: fabric is dyed per colourway so the requirement must
         SPLIT by it, but the gram weight does not depend on it — one weight per
         size, applied to every colour. That is why the basis is `colour_size`
         and not `size`.

         Assort Colour-Wise reverses only the FIRST half: the entry now names
         which colourways its weight is for, so two shades needing 220g and one
         needing 230g are two entries rather than one weight pretending to
         cover all three. The split itself is unchanged.

         `combos` IS PASSED ONLY WHEN THE TOGGLE IS ON, and that is what keeps
         the stored ticks from acting while it is off — `fabricSlices` reads an
         EMPTY list as a refusal, never as "all", so handing it the rows of an
         entry whose toggle is off would refuse a document that saved
         perfectly well yesterday. */
      {
        style_ref_no: entry.style_ref_no,
        combo: null,
        combos: entry.assort_color_wise ? entry.combos : null,
      },
      {
        /* NO SCALAR. `bySize` being PRESENT is what tells the engine to plan per
           size, and an entry has no single consumption to fall back to — which
           is exactly right, because a fallback would answer with a figure nobody
           typed. Passing `{}` for an unfilled entry is deliberate: the engine
           refuses it slice by slice and names the size. */
        consumption: null,
        wastage_pct: entry.wastage_pct,
        /* THE SECOND ALLOWANCE, COMPOUNDED WITH THE FIRST (0523). Legacy's
           Manual row carries both — "EndBit Loss %" and "Component Proc.
           Loss %" — and the client's spec states the sequential form. Passed
           through so the stored requirement and the figure the screen prints
           come from ONE formula (`requiredKg`), differing only by this route's
           ceiling. */
        endbit_loss_pct: entry.endbit_loss_pct,
        decimals: kg.decimals,
        bySize,
      },
      order,
    );

    if (isRefusal(rows)) {
      refuse(rows.refused);
      continue;
    }

    for (const r of rows) {
      out.push({
        entry_id: entry.id,
        line_id: null,
        item_id: fabric.item_id,
        sno: ++sno,
        basis: "colour_size",
        // The SLICE's keys. `uq_ofbr_slice` keys on them, so a row that did not
        // carry its own colourway and size would collide with its siblings.
        style_ref_no: r.style_ref_no,
        combo: r.combo,
        size_id: r.size_id,
        slice_label: r.label,
        basis_qty: r.qty,
        /* THE SIZE'S OWN CONSUMPTION, because there is no entry-level one.
           Stored per row so the document says what it actually multiplied, which
           is what makes a stored requirement auditable rather than just a total. */
        consumption: (r.size_id ? bySize[r.size_id] : undefined) ?? 0,
        wastage_pct: entry.wastage_pct ?? 0,
        consumption_uom_id: kg.id,
        required_qty: r.required,
        refusal_reason: null,
      });
    }
  }
  return out;
}

/**
 * The order's nominal GSM per structure, for the calculated mode.
 *
 * ONE DISTINCT ANSWER OR NOTHING, which is the same abstain rule `descriptorFor`
 * applies on the screen — and it has to be, or the weight the planner reads
 * while typing and the weight the server stores would differ on exactly the
 * structures whose colourways disagree. Four such (style, structure) pairs were
 * live on 2026-09-01.
 */
function gsmByStructureOf(seed: readonly OrderFabricSeedRow[]): Map<string, number> {
  const seen = new Map<string, Set<number>>();
  for (const r of seed) {
    if (!r.structure_id || r.gsm == null) continue;
    const set = seen.get(r.structure_id) ?? new Set<number>();
    set.add(r.gsm);
    seen.set(r.structure_id, set);
  }
  const out = new Map<string, number>();
  for (const [id, set] of seen) if (set.size === 1) out.set(id, [...set][0]);
  return out;
}

async function uomDecimalMap(
  s: Awaited<ReturnType<typeof createClient>>,
): Promise<Map<string, number | null>> {
  const { data } = await s.from("uoms").select("id, decimal_places_allowed");
  return new Map(
    ((data ?? []) as { id: string; decimal_places_allowed: number | null }[]).map((r) => [
      r.id,
      r.decimal_places_allowed,
    ]),
  );
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function headerOnly(data: FabricBomInput, order: OrderProductionInput | null) {
  /* `full_target`, THE FABRIC RULE — not `totalProductionOf`'s default, which
     is the TRIMS base and leaves the rejection allowance out (2026-09-16).
     This document's own requirement rows are exploded by `fabricSlices`, which
     passes `full_target`, so anything else here stamps the header with a
     quantity the rows beneath it were never computed for: 1040 against 1070 on
     HO/RE/26-27/0007. See `totalProductionOf`'s header. */
  const total = order ? totalProductionOf(order, "full_target") : null;
  return {
    garment_order_id: data.garment_order_id,
    bom_date: data.bom_date,
    is_draft: data.is_draft,
    remark: clean(data.remark),
    // Stamped in the SAME write as the rows it describes. A hash written at a
    // different moment from the requirement it fingerprints is a staleness check
    // that can be wrong in both directions.
    computed_at: order ? new Date().toISOString() : null,
    computed_for_qty: total != null && !isOrderRefusal(total) ? total : null,
    computed_basis_hash: order ? basisFingerprint(order) : null,
  };
}

/**
 * The Yarn Process rows and their stages, with both figures computed
 * (0493 · 0504).
 *
 * ## THERE IS NOTHING TO FILTER AT THE TOP LEVEL, AND THAT IS THE DIFFERENCE
 *
 * `normalizeLines`, `normalizeDias` and `normalizeProcesses` all answer "which
 * of these typed rows did the operator actually mean?". A YARN row is not typed:
 * the screen derives one per yarn the BOM's fabrics declare, so every row that
 * arrives is a yarn this document buys and dropping any of them would drop a
 * purchase line. A yarn with no stages is the ordinary answer for a solid order.
 *
 * The STAGES are typed, so those do filter — on `yarnStageStarted`, the same
 * predicate the screen uses to decide whether a stage's cells hold the cursor.
 * One function, so "kept on save" and "held by the cursor" cannot come apart.
 *
 * ## WHAT IT COMPUTES, AND WHY THE TWO FIGURES ARE DIFFERENT
 *
 *   · the YARN's `purchase_qty` — every colourway's net grossed by the stages
 *     treating it, summed. The Budget's Yarn Purchase line.
 *   · each STAGE's `process_qty` — the purchase weight of the colourways THAT
 *     step treats. The Budget's Yarn Processing line.
 *
 * A stage naming no process gets neither: no quantity, no refusal, no budget
 * line. That is the client's "hidden or locked when no process is assigned" in
 * its strongest form — nothing is produced, so there is nothing to hide.
 *
 * Both are written by the SERVER from the same `FabricGross` figures the
 * requirement rows are built from, in the same pass, so a weight and the
 * requirement it divides can never describe different versions of the document.
 *
 * DE-DUPLICATED BY `item_id` BEFORE INSERT. `uq_ofby_bom_item` would reject the
 * second row anyway, and a rejected batch loses the whole save; the screen
 * cannot produce a duplicate (`deriveYarnRows` keys by yarn) but a `lib/data-io`
 * import or a stale client could, and the failure would be the entire BOM
 * refusing to save with a message naming an index.
 */
type NormalizedYarn = {
  row: Record<string, unknown>;
  stages: Record<string, unknown>[];
};

/**
 * Each declared fabric's OWN process route, for `yarnPurchase`'s per-fabric
 * markup (2026-09-11) — grouped straight off the FORM's `data.processes`
 * (the same rows `normalizeProcesses` is about to write to
 * `order_fabric_bom_processes`), not a second fetch: the yarn total and the
 * route it was grossed by must come from the SAME save, or a Save that
 * changes both a loss % and a yarn's blend in one go could price the yarn
 * against the route it is about to replace.
 *
 * ONLY `process_id` SET, matching `normalizeProcesses`' own minimal filter —
 * deliberately NOT also matching the current assort/component-wise SCOPE
 * toggle the way that function does: a route the operator is mid-editing
 * (toggle flipped, rows not yet re-entered) should still gross up the yarn
 * with whatever loss was last declared, not silently drop to zero loss the
 * moment a toggle changes before its rows are retyped.
 */
function routesByFabricOf(
  data: FabricBomInput,
  fabricIds: ReadonlySet<string>,
  /** THE PROCESS MASTER'S OWN KIND FLAGS (0564), read server-side — see
   *  `processKindsOf`. Empty means "nothing is a Knitting or a Dyeing step",
   *  which suppresses nothing; that is the right reading for a database where
   *  0564's seed has not run, and it errs by buying slightly too much cloth
   *  rather than too little. */
  kinds: ReadonlyMap<string, { is_knitting: boolean; is_dyeing: boolean }> = new Map(),
): Map<string, RouteStage[]> {
  const out = new Map<string, RouteStage[]>();
  for (const p of data.processes) {
    if (!p.process_id || !fabricIds.has(p.item_id)) continue;
    const list = out.get(p.item_id) ?? [];
    const kind = kinds.get(p.process_id);
    list.push({
      combo: p.combo ?? null,
      /* CARRIED SINCE 2026-09-15. Without it a "Component Wise" route (0528)
         read as ONE route and every panel's steps compounded onto every
         weight — see `stagesForGroup`. */
      component_id: p.component_id ?? null,
      loss_pct: p.loss_pct ?? null,
      stage_id: p.stage_id ?? null,
      process_id: p.process_id,
      /* CARRIED SINCE 2026-09-16 (0564) for the same reason `component_id` is:
         the engine needs to know what KIND of step this is, and a route built
         without it suppresses nothing under Rule 2. */
      is_knitting: kind?.is_knitting ?? false,
      is_dyeing: kind?.is_dyeing ?? false,
    });
    out.set(p.item_id, list);
  }
  return out;
}

/**
 * WHICH PROCESSES ARE KNITTING AND WHICH ARE DYEING (0564) — read from the
 * master, server-side, never from the payload.
 *
 * `requirementRows`' own rule, restated: a figure the browser could set is a
 * figure a client could set, and these two flags decide whether a stage's loss
 * compounds into a purchase weight. A payload that could declare its own
 * Knitting step could declare that no step is one, and buy the yarn twice.
 *
 * SCOPED TO THE PROCESSES THIS DOCUMENT ACTUALLY NAMES, so a BOM with no route
 * makes no query at all.
 */
async function processKindsOf(
  s: Awaited<ReturnType<typeof createClient>>,
  data: FabricBomInput,
): Promise<Map<string, { is_knitting: boolean; is_dyeing: boolean }>> {
  const ids = [...new Set(data.processes.map((p) => p.process_id).filter(Boolean))] as string[];
  if (ids.length === 0) return new Map();
  /* `.select()` WITHOUT `!inner` AND WITH NO EMBED — `processes` is a plain
     master here, so AGENTS.md's ambiguous-embed rule has nothing to bite on.
     The error is read rather than coalesced away: a failed read would make
     every step look like neither kind, which under Rule 2 silently restores
     the knitting loss this migration exists to remove. */
  const { data: rows, error } = await s
    .from("processes")
    .select("id, is_knitting, is_dyeing")
    .in("id", ids);
  if (error) {
    /* NOT A THROW AND NOT A SILENT EMPTY MAP. The save must not fail over a
       flag that only refines a markup, but the caller has to be able to tell
       "no process is a knitting step" from "we could not find out" — so the
       failure is surfaced by the one thing every caller already reads, the
       refusal on the affected yarn/cloth row. See `writeYarns`. */
    throw new Error(`Could not read the process master's kind flags: ${error.message}`);
  }
  return new Map(
    ((rows ?? []) as { id: string; is_knitting: boolean | null; is_dyeing: boolean | null }[]).map(
      (r) => [r.id, { is_knitting: r.is_knitting ?? false, is_dyeing: r.is_dyeing ?? false }],
    ),
  );
}

/**
 * EACH FABRIC'S DECLARED SOURCE (0564), straight off the FORM's own
 * `processScopes` — the same rows `normalizeProcessScopes` is about to write,
 * not a second fetch, for `routesByFabricOf`'s stated reason: the yarn total
 * and the source it was computed under must come from the SAME save, or a
 * Save that flips a fabric to Greige Purchase and edits a loss % in one go
 * could price the yarn against the source it is about to replace.
 *
 * DELIBERATELY NOT FILTERED BY `fabricIds` the way `normalizeProcessScopes`
 * is. That filter exists to stop a row being WRITTEN for cloth the BOM no
 * longer plans; a lookup that refuses to answer for such a fabric would just
 * fall back to Rule 1 and quietly re-buy its yarn.
 */
function sourceByFabricOf(data: FabricBomInput): Map<string, FabricSource> {
  return new Map(data.processScopes.map((s) => [s.item_id, asFabricSource(s.source)]));
}

/**
 * THE DYED SHADES THIS SAVE IS STORING, for `yarnPurchase` (0568).
 *
 * BUILT FROM THE FORM'S OWN ROWS, not from a re-read, for `requirementRows`'
 * stated reason one axis over: the purchase weight and the stripes it was
 * divided by must come from the SAME save. A Save that edits a dyeing loss and
 * a stripe width in one go would otherwise price the yarn against the
 * combination it is about to replace.
 *
 * `yarnShadesFrom` (./yarn-dyed.ts) is the join — shares off the repeats,
 * colours and losses off the combinations, paired by stripe POSITION. One
 * implementation, because the screen's own preview must build them the same
 * way or the two figures diverge.
 */
function yarnShadesOf(
  data: FabricBomInput,
  compositions: ReadonlyMap<string, FabricComposition>,
): YarnShade[] {
  const fabricIds = [
    ...new Set((data.yd_repeats ?? []).map((r) => r.item_id).filter(Boolean)),
  ] as string[];
  return fabricIds.flatMap((fabricId) =>
    yarnShadesFrom(
      fabricId,
      (data.yd_repeats ?? [])
        .filter((r) => r.item_id === fabricId)
        .map((r) => ({
          key: `${fabricId}:${r.sno}`,
          sno: r.sno,
          yarn_item_id: r.yarn_item_id ?? null,
          dye_type: r.dye_type === "grey" ? ("grey" as const) : ("dyed" as const),
          color_name: r.color_name ?? "",
          uom_id: r.uom_id ?? null,
          value: r.value ?? null,
          twisted_yarn: r.twisted_yarn ?? "",
        })),
      compositions.get(fabricId) ?? null,
      (data.yd_combinations ?? [])
        .filter((c) => c.item_id === fabricId)
        .map((c) => ({
          combo: c.combo ?? null,
          colors: (c.colors ?? []).map((x) => ({
            sno: x.sno,
            dyeing_loss_pct: x.dyeing_loss_pct ?? 0,
          })),
        })),
    ),
  );
}

function normalizeYarns(
  data: FabricBomInput,
  fabrics: readonly FabricGross[],
  compositions: ReadonlyMap<string, FabricComposition>,
  uomDecimals: Map<string, number | null>,
  /** THE PROCESS MASTER'S KIND FLAGS (0564) — see `processKindsOf`. Read by
   *  the caller so this stays a pure function, the same division `writeYarns`
   *  already draws for `compositions` and `uomDecimals`. */
  processKinds: ReadonlyMap<string, { is_knitting: boolean; is_dyeing: boolean }> = new Map(),
): NormalizedYarn[] {
  /* THE DYED SHADES (0568) — built once for the whole save rather than per
     yarn: `yarnPurchase` filters them itself by (fabric, yarn, colourway), and
     rebuilding the join inside the loop would run `mixingDetailRows` once per
     yarn over the same rows. */
  const shades = yarnShadesOf(data, compositions);
  const seen = new Set<string>();
  const out: NormalizedYarn[] = [];
  const routesByFabric = routesByFabricOf(
    data,
    new Set(fabrics.map((f) => f.fabric_id)),
    processKinds,
  );
  const sourceByFabric = sourceByFabricOf(data);

  for (const y of data.yarns) {
    if (!y.item_id || seen.has(y.item_id)) continue;
    seen.add(y.item_id);

    const kept = y.stages.filter((st) =>
      yarnStageStarted({
        stage_id: st.stage_id,
        process_id: st.process_id,
        loss_for_id: st.loss_for_id ?? null,
        combo: st.combo ?? "",
        description: st.description ?? "",
        /* THE PAYLOAD HAS ALREADY COERCED THIS TO A NUMBER and the shared
           predicate reads text, so the two are bridged HERE rather than by
           loosening the predicate. `?? ""` and not `String(null)`, which is the
           four-character string "null" and is truthy. */
        loss_pct: st.loss_pct == null ? "" : String(st.loss_pct),
      }),
    );

    /* THE UNIT'S PRECISION COMES FROM THE FABRIC, because the yarn is measured
       in whatever the fabric requirement is measured in — this figure is that
       one divided and grossed up, never converted. */
    const uomId = fabrics.find((f) => f.uom_id)?.uom_id ?? null;
    const weight = yarnPurchase(
      y.item_id,
      fabrics,
      compositions,
      routesByFabric,
      /* `combo` SCOPES THE LOSS AGAIN (0504, restored 0529) — the same call the
         screen's `weightFor` makes, deliberately, so the preview and the stored
         figure stay one computation. This is now the YARN'S OWN stages, which
         compound onto whatever its fabric(s) already contribute (see
         `yarnPurchase`'s 2026-09-11 header) — not the sole source any more. */
      kept.map((st) => ({ combo: st.combo ?? null, loss_pct: st.loss_pct ?? null })),
      uomId ? (uomDecimals.get(uomId) ?? null) : null,
      /* WHERE EACH CLOTH COMES FROM (0564) — a fabric bought as greige or dyed
         rolls buys no yarn, so it leaves this sum. The SAME map the screen's
         `weightFor` must pass, for the reason that function's own comment
         gives: the preview and the stored figure are one computation. */
      sourceByFabric,
      /* THE DYED SHADES (0568) — each colour of this yarn grossed by its OWN
         dye-house loss before it becomes grey yarn to buy. The SAME array the
         screen's `weightFor` must pass, for the reason the two arguments above
         already carry: the preview and the stored figure are one computation. */
      shades,
    );

    const refused = isRefusal(weight);
    const byCombo = refused ? [] : weight.byCombo;

    out.push({
      row: {
        sno: out.length + 1,
        item_id: y.item_id,
        ...(refused
          ? { purchase_qty: null, uom_id: null, refusal_reason: weight.refused }
          : { purchase_qty: weight.qty, uom_id: weight.uom_id, refusal_reason: null }),
      },
      stages: kept.map((st, i) => {
        /* A STEP WITH NO PROCESS CARRIES NEITHER FIGURE — see the header, and
           `chk_ofbys_not_both`, which is deliberately weaker than the parent's
           exclusive-or so that this state is representable.

           TWO REASONS A STEP CAN CARRY NO FIGURE (0529, restoring 0520's
           second): the yarn's own refusal, or `stageProblem` — this STEP names a
           colourway the requirement does not have (a combo removed from the
           order, or renamed, after the treatment was recorded). */
        const problem = refused
          ? weight.refused
          : st.process_id
            ? stageProblem(st.combo ?? null, byCombo)
            : null;
        return {
          sno: i + 1,
          stage_id: st.stage_id ?? null,
          process_id: st.process_id ?? null,
          loss_for_id: st.loss_for_id ?? null,
          combo: st.combo ?? null,
          description: st.description ?? null,
          loss_pct: st.loss_pct ?? null,
          ...(st.process_id && !problem
            ? {
                process_qty: stageProcessQty(st.combo ?? null, byCombo),
                uom_id: refused ? null : weight.uom_id,
                refusal_reason: null,
              }
            : { process_qty: null, uom_id: null, refusal_reason: problem }),
        };
      }),
    });
  }
  return out;
}

/**
 * Write the yarns, then their stages from the ids that insert reads back.
 *
 * ITS OWN WRITER, unlike the dias which `writeLines` inlines, because it needs
 * the same `FabricGross` figures the requirement does — so it runs AFTER the
 * requirement rather than before, and the caller passes them in.
 *
 * IT DELETES ITS OWN ROWS, and that moved here on 2026-09-16. The caller's
 * delete loop used to clear `order_fabric_bom_yarns` along with every other
 * child — which meant a payload that named no yarns (because the screen's
 * composition fetch had not resolved) destroyed the stored purchase and put
 * nothing back. The delete now sits one statement before the insert that
 * replaces the rows, so "the screen does not know yet" can be told apart from
 * "this BOM has no yarns" and only the second one clears anything. The stages
 * still go by cascade — they carry `yarn_id`, not `bom_id`, which is why they
 * could never have been in that loop either way.
 */
async function writeYarns(
  s: Awaited<ReturnType<typeof createClient>>,
  bomId: string,
  data: FabricBomInput,
  fabrics: readonly FabricGross[],
  compositions: ReadonlyMap<string, FabricComposition>,
  uomDecimals: Map<string, number | null>,
): Promise<Result> {
  /* THE KIND FLAGS FIRST (0564), and its failure is a SAVE failure rather than
     a silent empty map. A read that failed would make every step look like
     neither a Knitting nor a Dyeing one, so a Rule 2 fabric would be grossed
     by the very stages its source exists to suppress — a wrong purchase weight
     with nothing on screen saying anything went wrong, which is precisely the
     shape this module's own history warns about. Refusing the save is loud and
     recoverable; storing the figure is neither. */
  let processKinds: ReadonlyMap<string, { is_knitting: boolean; is_dyeing: boolean }>;
  try {
    processKinds = await processKindsOf(s, data);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not read the process master's kind flags");
  }

  const yarns = normalizeYarns(data, fabrics, compositions, uomDecimals, processKinds);

  /* AN EMPTY PAYLOAD IS NOT AUTOMATICALLY AN EMPTY ANSWER (2026-09-16).
     A yarn row exists because a cloth on this BOM is MADE of that yarn —
     `deriveYarnRows`' first rule, "never because someone added it". So the
     cloths' own compositions, read server-side here, say what the payload
     SHOULD have contained, and the two disagreeing means the screen sent a
     list it had not finished deriving (see the delete loop's note in
     `updateFabricBom`).

     REFUSED, NOT PAPERED OVER, AND REFUSED BEFORE THE DELETE. Writing nothing
     and returning ok would leave the stored purchase standing against a
     requirement this save has just rewritten — the two-figures-disagreeing
     failure this module's header calls its worst. Refusing keeps the rows that
     ARE there, names what happened, and costs the operator one more Save. */
  if (yarns.length === 0) {
    const clothDeclaresYarn = [...compositions.values()].some((c) => c.components.length > 0);
    if (clothDeclaresYarn) {
      return fail(
        "The yarn rows had not finished loading, so this save could not work out the yarn " +
          "purchase — the previously saved figures have been kept. Reopen the BOM, wait for " +
          "Yarn Process to fill in, and save again.",
      );
    }
    /* NO COMPOSITION ON ANY CLOTH — genuinely no yarns to buy, which is the
       ordinary state of an all-purchased-fabric BOM. Clear whatever a previous
       save left, since nothing is going to replace it. */
    const { error: delErr } = await s.from("order_fabric_bom_yarns").delete().eq("bom_id", bomId);
    if (delErr) return fail(delErr.message);
    return { ok: true };
  }

  /* CLEARED HERE, one statement before the insert that replaces them, so no
     window exists in which the rows are gone and nothing is coming. The stages
     go with them by cascade — they carry `yarn_id`, not `bom_id`. */
  const { error: clearErr } = await s.from("order_fabric_bom_yarns").delete().eq("bom_id", bomId);
  if (clearErr) return fail(clearErr.message);

  const { data: inserted, error } = await s
    .from("order_fabric_bom_yarns")
    .insert(yarns.map((y) => ({ ...y.row, bom_id: bomId })))
    .select("id, sno");
  if (error) return fail(error.message);

  // Matched back by `sno`, which `normalizeYarns` has just made unique and
  // dense. `.select()` does not promise insertion order.
  const bySno = new Map(
    ((inserted ?? []) as { id: string; sno: number }[]).map((r) => [r.sno, r.id]),
  );
  if (yarns.some((y) => !bySno.get(y.row.sno as number))) {
    return fail("Could not read back the saved yarns");
  }

  const stageRows = yarns.flatMap((y) =>
    y.stages.map((st) => ({ ...st, yarn_id: bySno.get(y.row.sno as number) as string })),
  );
  if (stageRows.length) {
    const { error: stErr } = await s
      .from("order_fabric_bom_yarn_stages")
      .insert(stageRows);
    if (stErr) return fail(stErr.message);
  }

  return { ok: true };
}

/**
 * IS THIS REPEAT WORTH STORING? (0512)
 *
 * A row the grid opened and nobody filled says nothing, and storing it would put
 * an empty line in every future reader of the panel. The ADDRESS alone does not
 * count as content — every blank row carries one, because the grid stamps the
 * fabric group onto a row the moment it is created.
 */
const ydRepeatFilled = (r: FabricBomInput["yd_repeats"][number]) =>
  !!(r.yarn_item_id || (r.color_name ?? "").trim() || r.value != null || (r.twisted_yarn ?? "").trim());

/** As `ydRepeatFilled`, for a Combinations row. */
const ydCombinationFilled = (r: FabricBomInput["yd_combinations"][number]) =>
  !!((r.combo ?? "").trim() || (r.yd_combo_name ?? "").trim());

/** As `ydRepeatFilled`, for one row of a Combinations row's nested Color
 *  breakdown (0560). */
const ydCombinationColorFilled = (
  c: FabricBomInput["yd_combinations"][number]["colors"][number],
) => !!(c.yarn_color ?? "").trim();

async function writeLines(
  s: Awaited<ReturnType<typeof createClient>>,
  bomId: string,
  data: FabricBomInput,
  order: OrderProductionInput | null,
): Promise<Result> {
  // Requirements first: they reference the lines, so deleting the other way
  // round leaves the cascade to do it and the order of two deletes becomes a
  // thing to remember rather than a thing to read.
  //
  // THE DIAS JOIN THE SAME DELETE-AND-REINSERT (0490). They reference nothing
  // and nothing references them, so their position in this list is free; they
  // are in it rather than in a writer of their own because a child the save
  // path forgets is a child the next save silently erases — the trap the
  // Garment Order screen records for `prints` and `structures`, whose state and
  // write were deliberately kept after their grids came off the tab.
  //
  // THE ROUTE ROWS ARE IN THE LIST AND THEIR POSITION IN IT IS FREE (0492).
  // They reference `items` and `order_fabric_boms`, never a line, so no cascade
  // can reach them and no delete has to precede another — unlike the
  // requirements above, which are first precisely because they DO reference the
  // lines. They are in the loop at all because they carry `bom_id`; a grandchild
  // like `order_fabric_bom_line_sizes` has none and is cleared by its parent's
  // delete instead.
  for (const t of [
    "order_fabric_bom_requirements",
    "order_fabric_bom_processes",
    /* THE SPLIT TOGGLES (0528). Same position as the routes above and for the
       same reason: keyed on `bom_id` + `item_id`, references no line, so
       nothing forces it before or after any other delete in this list. */
    "order_fabric_bom_process_scope",
    "order_fabric_bom_lines",
    "order_fabric_bom_dias",
    /* THE YARNS ARE NOT IN THIS LOOP ANY MORE (2026-09-16) — `writeYarns`
       deletes them itself, immediately before it writes their replacements.

       THEY WERE HERE, AND IT COST A DOCUMENT ITS YARN PURCHASE. The rows are
       DERIVED from the cloths' compositions, which the screen loads in an
       async effect (`compState`); until it resolves, `comp` is null and
       `yarnRows` is `[]`. A Save in that window sent `yarns: []` — and `[]`
       reaching this loop meant "delete every yarn row", while reaching
       `writeYarns` a moment later meant "nothing to insert". The BOM came out
       the far side with no stored yarn purchase at all and the report saying
       so, over a browser fetch that had merely not finished (five
       `TypeError: Failed to fetch` in the log the day this was found).

       ONE ARRAY, TWO MEANINGS — "this BOM has no yarns" and "the screen does
       not know yet" — which is this repo's most-recorded failure wearing a
       client-side hat. Deleting where we insert is what makes the two
       distinguishable: see `writeYarns`. */
    /* THE MANUAL ENTRIES, AND THEIR COMPONENTS AND SIZES BY CASCADE (0494).
       `order_fabric_bom_manual_components` and `_manual_sizes` are absent from
       this list for the reason they cannot be in it: the loop deletes on
       `bom_id` and both are keyed on `entry_id`. They are GRANDCHILDREN — the
       same shape and the same note the yarn routes carry just above. */
    /* THE MANUAL ENTRIES, AND THEIR COMPONENTS, COLOURWAYS AND SIZES BY
       CASCADE (0494 · 0567). The three grandchildren are absent from this list
       for the reason they cannot be in it: the loop deletes on `bom_id` and all
       three are keyed on `entry_id`. */
    "order_fabric_bom_manual_entries",
    /* THE YARN DYED DETAILS PANELS (0512). In the loop because they carry
       `bom_id`; their position in it is free, like the dias and the routes,
       because they reference no line and no line references them.

       THAT INDEPENDENCE IS THE POINT OF THE TABLES' KEYING, not a happy
       accident. They hold the fabric group's address BY VALUE, so this
       delete-and-reinsert — which destroys and rebuilds every LINE — leaves them
       addressable by the same three values afterwards. Keyed on `line_id` they
       would be cascaded away by an ordinary Save from the Fabric Lines grid,
       which is the Material Attribute orphan bug exactly. */
    "order_fabric_bom_yd_repeats",
    "order_fabric_bom_yd_combinations",
  ]) {
    const { error } = await s.from(t).delete().eq("bom_id", bomId);
    if (error) return fail(error.message);
  }

  const dias = normalizeDias(data);
  if (dias.length) {
    const { error } = await s
      .from("order_fabric_bom_dias")
      .insert(dias.map((d) => ({ ...d, bom_id: bomId })));
    if (error) return fail(error.message);
  }

  /* THE YARN DYED PANELS (0512), written before the lines because nothing here
     needs a line id — the same gain 0492's routes get from keying on `item_id`.

     `ydRepeatFilled` / `ydCombinationFilled` are what decide whether a row is
     worth STORING, the division of labour `normalizeDias` already draws: the
     Zod schema asks "is this valid" and answers yes for a blank row the grid
     opened, and this asks "does this say anything". */
  const ydRepeats = (data.yd_repeats ?? []).filter(ydRepeatFilled);
  if (ydRepeats.length) {
    const { error } = await s
      .from("order_fabric_bom_yd_repeats")
      .insert(ydRepeats.map((r) => ({ ...r, bom_id: bomId })));
    if (error) return fail(error.message);
  }

  const ydCombinations = (data.yd_combinations ?? []).filter(ydCombinationFilled);
  if (ydCombinations.length) {
    const { data: insertedCombinations, error } = await s
      .from("order_fabric_bom_yd_combinations")
      .insert(
        ydCombinations.map((r) => ({
          style_ref_no: r.style_ref_no,
          structure_id: r.structure_id,
          item_id: r.item_id,
          combo: r.combo,
          yd_combo_name: r.yd_combo_name,
          bom_id: bomId,
        })),
      )
      .select("id");
    if (error) return fail(error.message);

    /* THE NESTED COLOR BREAKDOWN (0560) — reference only, see the migration
       header. Written from the just-inserted parents' generated ids, zipped
       by ARRAY INDEX: `.select("id")` on a single multi-row insert with no
       `ON CONFLICT` returns one row per value, in the order the values were
       sent, which `ydCombinations` (the same filtered array, same order) was
       built from. `order_fabric_bom_yd_combinations` has no stable id of its
       own across saves — `writeLines` deletes and reinserts every row of it
       on every save — so there is no earlier id to reuse here even if one
       were wanted. */
    const colorRows = (insertedCombinations ?? []).flatMap((inserted, i) =>
      (ydCombinations[i]?.colors ?? [])
        .filter(ydCombinationColorFilled)
        .map((c) => ({
          combination_id: inserted.id,
          sno: c.sno,
          yarn_color: c.yarn_color,
          /* THE SHADE'S OWN DYEING LOSS (0568). `?? 0` matches the column
             default and this module's reading of every other undeclared
             allowance: nothing said is no markup, never an invented one. */
          dyeing_loss_pct: c.dyeing_loss_pct ?? 0,
        })),
    );
    if (colorRows.length) {
      const { error: colorError } = await s
        .from("order_fabric_bom_yd_combination_colors")
        .insert(colorRows);
      if (colorError) return fail(colorError.message);
    }
  }

  const lines = normalizeLines(data);

  /* THE ROUTES (0492) — WRITTEN FROM THE FABRICS THE LINES NAME, and written
     BEFORE them because nothing here depends on a line id any more. That is the
     whole gain from keying on `item_id`: this used to have to run inside the
     insert block below, paired with the `sno` -> id map, because a route could
     only reach its line through an id the save had just minted.

     `fabricIds` comes from the NORMALIZED lines, so a route for a fabric the
     operator has removed is dropped here rather than left pointing at cloth this
     BOM no longer plans — see `normalizeProcesses`. */
  const fabricIds = new Set(
    lines.map((l) => l.item_id).filter((v): v is string => !!v),
  );
  const scopeRows = normalizeProcessScopes(data, fabricIds);
  if (scopeRows.length) {
    const { error } = await s
      .from("order_fabric_bom_process_scope")
      .insert(scopeRows.map((r) => ({ ...r, bom_id: bomId })));
    if (error) return fail(error.message);
  }
  const scopeByItem = new Map(scopeRows.map((r) => [r.item_id, r]));
  const processRows = normalizeProcesses(data, fabricIds, scopeByItem);
  if (processRows.length) {
    const { error } = await s
      .from("order_fabric_bom_processes")
      .insert(processRows.map((r) => ({ ...r, bom_id: bomId })));
    if (error) return fail(error.message);
  }

  let saved: LineRowWithId[] = [];
  if (lines.length) {
    const { data: inserted, error } = await s
      .from("order_fabric_bom_lines")
      .insert(lines.map((r) => ({ ...r, bom_id: bomId })))
      .select("id, sno");
    if (error) return fail(error.message);
    // Match ids back by `sno`, which `normalizeLines` has just made unique and
    // dense. `.select()` does not promise insertion order.
    const bySno = new Map(
      ((inserted ?? []) as { id: string; sno: number }[]).map((r) => [r.sno, r.id]),
    );
    saved = lines.map((r) => ({ ...r, id: bySno.get(r.sno) as string }));
    if (saved.some((r) => !r.id)) return fail("Could not read back the saved fabric lines");
  }

  /* THE MANUAL ENTRIES, AND THE REQUIREMENT THEY EXPLODE INTO (0494).
     Entries are the counting unit, so this is where the document's fabric
     quantity is decided — see `requirementRows`. They are inserted after the
     lines because `entryFabric` resolves an entry's cloth off the SAVED lines,
     and their own components and sizes travel inside them for the reason
     `normalizeManualEntries` records: `entry_id` is NOT NULL and an entry's id
     does not exist until this insert has run. */
  const rawEntries = normalizeManualEntries(data);

  /**
   * WHAT EACH ENTRY'S CLOTH SAYS ABOUT ITSELF, read once (0522).
   *
   * `items.category_id` IS the structure (0405 · 0415 · 0426) — a fact of the
   * MASTER, so it is read from it rather than trusted from the form, the same
   * call this action already makes for the GSM one block down and for the same
   * reason: a figure the browser could set is a figure a client could set, and
   * the structure reaches a purchase weight through the GSM it keys.
   *
   * `base_uom_id` USED TO BE READ HERE TOO and no longer is: the requirement's
   * unit is the kilogram by construction (see `requirementRows`), and the
   * cloth's buying unit was being stamped on a gram-derived weight.
   *
   * A FAILED QUERY IS AN ERROR, NOT AN EMPTY MAP. Swallowing it would silently
   * derive every structure as NULL and store a BOM whose requirement rows cannot
   * find their GSM — an empty result that reads exactly like a legitimate one
   * (AGENTS.md, "A SECOND FK BREAKS EVERY EXISTING EMBED").
   */
  /* `entryFabricIds`, NOT `fabricIds` — that name is taken one block up by the
     LINES' cloths, which feed the process routes. Two different sets of fabrics
     on one save: the ones the allocation names and the ones the weights name. */
  const entryFabricIds = [
    ...new Set(rawEntries.map((e) => e.item_id).filter(Boolean)),
  ] as string[];
  const fabricFacts: FabricFacts = new Map();
  if (entryFabricIds.length) {
    const { data: fRows, error: fErr } = await s
      .from("items")
      .select("id, category_id")
      .in("id", entryFabricIds);
    if (fErr) return fail(fErr.message);
    for (const r of (fRows ?? []) as { id: string; category_id: string | null }[]) {
      fabricFacts.set(r.id, { category_id: r.category_id });
    }
  }

  /* THE STRUCTURE IS WRITTEN FROM THE CLOTH, NEVER FROM THE FORM (0522). It is
     still stored because the requirement engine keys the order's GSM by it, and
     deriving it here is what keeps "one fact, one place it is typed" true — the
     screen shows it as a read-only cell beside the Fabric and sends whatever it
     last held, which this overwrites. A cloth the master cannot resolve leaves
     the entry's own value alone rather than blanking it. */
  const entries = rawEntries.map((e) =>
    e.item_id
      ? { ...e, structure_id: fabricFacts.get(e.item_id)?.category_id ?? e.structure_id }
      : e,
  );

  let savedEntries: EntryRowWithId[] = [];
  if (entries.length) {
    const { data: inserted, error } = await s
      .from("order_fabric_bom_manual_entries")
      /* `panels`, `combos` AND `sizes` ARE STRIPPED HERE, BY NAME. They
         ride on the normalized entry so that each can be paired with the id
         this insert reads back; PostgREST would reject the whole batch on an
         unknown column, which is the good failure. The bad one is a rename that
         makes any of them resolve to something real, so the strip is written out
         at the one place it has to happen rather than left to a spread. */
      .insert(
        entries.map(({ panels: _c, combos: _cb, sizes: _z, ...e }) => ({
          ...e,
          bom_id: bomId,
        })),
      )
      .select("id, sno");
    if (error) return fail(error.message);
    // Matched back by `sno`, which `normalizeManualEntries` has just made unique
    // and dense. `.select()` does not promise insertion order.
    const bySno = new Map(
      ((inserted ?? []) as { id: string; sno: number }[]).map((r) => [r.sno, r.id]),
    );
    savedEntries = entries.map((e) => ({ ...e, id: bySno.get(e.sno) as string }));
    if (savedEntries.some((e) => !e.id)) {
      return fail("Could not read back the saved manual entries");
    }

    /* THE PAIR IS WRITTEN WHOLE (0569) — `coordinate_id` beside the component,
       so the row says which half of a Set item its weight is for. */
    const componentRows = savedEntries.flatMap((e) =>
      e.panels.map((p) => ({
        entry_id: e.id,
        coordinate_id: p.coordinate_id,
        component_id: p.component_id,
      })),
    );
    if (componentRows.length) {
      const { error: cErr } = await s
        .from("order_fabric_bom_manual_components")
        .insert(componentRows);
      if (cErr) return fail(cErr.message);
    }

    /* THE COLOURWAY SET (0567), beside the panels and for the same reason —
       a grandchild keyed on the entry id this insert has just read back. */
    const comboRows = savedEntries.flatMap((e) =>
      e.combos.map((combo) => ({ entry_id: e.id, combo })),
    );
    if (comboRows.length) {
      const { error: cbErr } = await s.from("order_fabric_bom_manual_combos").insert(comboRows);
      if (cbErr) return fail(cbErr.message);
    }

    const manualSizeRows = savedEntries.flatMap((e) =>
      e.sizes.map((z) => ({ ...z, entry_id: e.id })),
    );
    if (manualSizeRows.length) {
      const { error: zErr } = await s
        .from("order_fabric_bom_manual_sizes")
        .insert(manualSizeRows);
      if (zErr) return fail(zErr.message);
    }
  }

  /* HOISTED OUT OF THE BLOCK BELOW (0493). The Yarn Process rows divide these
     same figures, so the yarn write needs them — and it must see the ones this
     save is storing, not a re-computation, or a yarn purchase could describe a
     different version of the document from the requirement it came out of. */
  let requirement: Record<string, unknown>[] = [];
  let decimals: Map<string, number | null> = new Map();

  if (order && savedEntries.length) {
    /* THE GSM IS READ FROM THE ORDER, SERVER-SIDE, and not taken from the form.
       Same call 0413 makes for the approval tiers and 0426 for the production
       target: a figure the browser could set is a figure a client could set, and
       this one multiplies into a purchase weight in `calculated` mode. */
    const [dp, seed, kg] = await Promise.all([
      uomDecimalMap(s),
      getOrderFabricSeed(data.garment_order_id),
      kilogramUom(s),
    ]);
    decimals = dp;
    /* NO KILOGRAM ROW, NO REQUIREMENT — refused by name, never written with a
       NULL unit: `required_qty` is a weight in kilograms whatever the master
       says, and a row whose unit cannot be named is a figure the Budget
       would price with no unit behind it. */
    if (!kg) {
      return fail("No active kilogram unit on the UOM master — add KGS before saving a Fabric BOM weight");
    }
    requirement = requirementRows(
      savedEntries,
      order,
      { id: kg.id, decimals: decimals.get(kg.id) ?? null },
      gsmByStructureOf(seed),
    );
    if (requirement.length) {
      const { error } = await s
        .from("order_fabric_bom_requirements")
        .insert(requirement.map((r) => ({ ...r, bom_id: bomId })));
      if (error) return fail(error.message);
    }
  }

  /* ---- THE YARN PURCHASE (0493), LAST, BECAUSE IT DIVIDES EVERYTHING ABOVE --
     It runs after the requirement for the same reason the requirement runs after
     the lines: each step needs the ids and the figures the one before it
     produced. `writeYarns` is a no-op when the form sent no yarns, which is
     every BOM whose fabrics declare no composition. */
  const grossRes = await writeYarns(
    s,
    bomId,
    data,
    fabricGrossOf(requirement, savedEntries),
    await compositionMapFor(saved),
    decimals.size ? decimals : await uomDecimalMap(s),
  );
  if (!grossRes.ok) return grossRes;

  return { ok: true };
}

/**
 * The gross requirement behind each (MANUAL ENTRY x COLOURWAY), for the yarn
 * split (0493 · 0504).
 *
 * ## IT WAS KEYED ON `line_id` AND 0494 MADE THAT COLUMN NULL
 *
 * The first cut grouped these rows by `line_id`, which is where the requirement
 * came from when 0493 was written. 0494 made the Manual ENTRY the counting unit
 * and `requirementRows` now writes `entry_id` with `line_id: null` on every row.
 * The old grouping matched nothing — and it did not error: `byLine` came out
 * empty, every fabric's gross read `null`, and every yarn refused "has no
 * calculated requirement yet" while the screen showed a requirement. Worse, the
 * SCREEN's preview and this disagreed, so the figure on screen and the figure
 * stored were different, which is the one thing `yarn-process.ts`'s header says
 * must never happen.
 *
 * ONE ENTRY PER GROUP, NOT ONE PER FABRIC ITEM, and the difference is
 * load-bearing for the same reason the line version gave: two entries may cover
 * one fabric, and if either was REFUSED the yarn beneath it cannot be worked
 * out. Summing to one entry per item would let a good entry paper over a refused
 * one, and the yarn row would print a confident figure covering part of the
 * cloth. `yarnPurchaseWeight` sums the entries itself and refuses on the first
 * null.
 *
 * THE FABRIC COMES OFF THE ROW, not from a join back to the lines. `entryFabric`
 * has already resolved it — including refusing when a structure names two
 * fabrics — and re-deriving it here would be a second answer to a question that
 * function owns. A row whose `item_id` is null could not name its fabric, so it
 * is skipped: there is no yarn to attribute it to.
 */
function fabricGrossOf(
  requirement: readonly Record<string, unknown>[],
  entries: readonly EntryRowWithId[],
): FabricGross[] {
  /* WHICH COMPONENTS EACH ENTRY COVERS — the same panels written to
     `order_fabric_bom_manual_components` a few lines up, so a "Component
     Wise" route (0528) can be resolved per bucket (`stagesForGroup`).

     THE COORDINATE STOPS HERE, deliberately (0569). A route step names a
     component and knows nothing of coordinates, so a Set item's TOP and BOTTOM
     All Body run the same sequence; `componentIdsOf` is the one place that
     flattening lives, and it dedupes so one route cannot be applied twice. */
  const componentsByEntry = new Map(entries.map((e) => [e.id, componentIdsOf(e.panels)]));
  /* KEYED BY (entry, COLOURWAY) SINCE 0504, not by entry alone. A stage may
     treat PURPLE and not GREEN, so the yarn has to be weighed per colourway
     before any loss is applied — summing an entry's slices into one figure first
     would make the combo split unrepresentable. `comboKey` rather than the raw
     value, so the bucket a requirement row lands in and the bucket a stage's
     `For` looks up are spelled identically. */
  const byBucket = new Map<string, FabricGross>();

  for (const r of requirement) {
    const key = (r.entry_id as string | null) ?? (r.line_id as string | null);
    const itemId = r.item_id as string | null;
    if (!key || !itemId) continue;

    const combo = (r.combo as string | null) ?? null;
    const bucket = `${key}::${comboKey(combo)}`;
    const held = byBucket.get(bucket);
    /* A REFUSAL POISONS ITS BUCKET and cannot be un-poisoned by a later slice:
       a fabric that could not be computed for one size of one colourway has no
       total for it. Once null, it stays null. */
    if (held && held.gross === null) continue;

    const qty = r.required_qty as number | null;
    byBucket.set(bucket, {
      fabric_id: itemId,
      combo,
      gross: qty == null ? null : (held?.gross ?? 0) + Number(qty),
      uom_id: (r.consumption_uom_id as string | null) ?? null,
      component_ids: componentsByEntry.get(key) ?? [],
      /* THE STORED REASON, so the saved yarn row refuses in the SAME words the
         screen previewed — the header's rule that this figure is computed once
         and read twice applies to the refusal as much as to the weight. The row
         already carries it (`refuse()` above writes `refusal_reason` beside the
         null `required_qty`); it was simply not being read. */
      refusal: (r.refusal_reason as string | null) ?? null,
    });
  }

  return [...byBucket.values()];
}

/** The fabrics' compositions, keyed for `yarnPurchaseWeight` (0493). Read
 *  server-side from `material_mixings` — never from the payload, for
 *  `requirementRows`' reason: a figure the browser could set is a figure a
 *  client could set, and this one divides a purchase weight. */
async function compositionMapFor(
  lines: readonly LineRowWithId[],
): Promise<Map<string, FabricComposition>> {
  const ids = lines.map((l) => l.item_id).filter((id): id is string => !!id);
  const { compositions } = await getBomYarnComposition(ids);
  return new Map(compositions.map((c) => [c.fabric_id, c]));
}

/**
 * THE FOURTH ENFORCER of the yarn-dyed rule (0513).
 *
 * `missingFabricLineFields` already draws the star, holds the cursor and gates
 * the Save button; AGENTS.md's "one declaration, four enforcers" says the server
 * action is the fourth, and it is the only one a stale client or a future import
 * path cannot walk past.
 *
 * IT RESOLVES THE FABRIC TYPE HERE RATHER THAN TRUSTING THE PAYLOAD. The type
 * lives on `items.fabric_type_id`; a line carries only `item_id`. Reading it from
 * the client would let a caller declare a yarn-dyed cloth to be solid and skip the
 * rule, which is the whole reason the check exists on this side too.
 *
 * ONE QUERY FOR THE WHOLE DOCUMENT, not one per line.
 */
async function yarnDyedProblem(
  s: Awaited<ReturnType<typeof createClient>>,
  data: FabricBomInput,
): Promise<string | null> {
  const ids = [...new Set(data.lines.map((l) => l.item_id).filter(Boolean))] as string[];
  if (ids.length === 0) return null;

  const { data: rows } = await s
    .from("items")
    .select("id, fabric_type:config_lookups!fabric_type_id(name)")
    .in("id", ids);

  /* THE EMBED COMES BACK AS AN ARRAY OR AN OBJECT depending on how PostgREST
     reads the relationship, and the generated types say array. Normalised here
     rather than cast away — a cast that lies is how a null slips through as a
     name and a yarn-dyed fabric reads as untyped. */
  const nameOf = (v: { name: string | null } | { name: string | null }[] | null) =>
    (Array.isArray(v) ? (v[0]?.name ?? null) : (v?.name ?? null));

  const typeById = new Map(
    ((rows ?? []) as unknown as {
      id: string;
      fabric_type: { name: string | null } | { name: string | null }[] | null;
    }[]).map((r) => [r.id, nameOf(r.fabric_type)]),
  );

  for (const l of data.lines) {
    const problems = missingFabricLineFields(
      {
        item_id: l.item_id ?? null,
        mixing_uom_id: l.mixing_uom_id ?? null,
        no_of_colors: l.no_of_colors ?? null,
      },
      typeById.get(l.item_id ?? "") ?? null,
    );
    if (problems.length) return problems[0].message;
  }
  return null;
}

/**
 * THE STAGE RULES, AS A GUARD RATHER THAN AS A DROPDOWN (0570).
 *
 * Client spec 2026-09-18 §2: a fabric line that has moved to DYED / WASH /
 * PRINT cannot revert to GREY, and a stage's primary process is locked to it
 * ("You cannot select Dyeing under a GREY stage tag"). The client chose the
 * strict reading when asked — refuse the save.
 *
 * ## WHY THIS EXISTS WHEN THE PICKER ALREADY NARROWS
 *
 * Because until today the ONLY enforcement was the picker. `normalizeProcesses`
 * writes `stage_id` straight through, `order_fabric_bom_processes.stage_id` is a
 * plain nullable FK whose only CHECKs are on `loss_pct` and `rate`, and the
 * Fabric Process section declared no Save problem at all — so a stale page, a
 * replayed request or a future writer stored any pair at all. AGENTS.md's
 * standing split, which `checkDuplicateName` states in as many words: the
 * screen check is a courtesy, this one is the guard. And the stakes are the four
 * stock ledgers rather than a tidy grid: a live route already carries
 * `[DYED] FABRIC PURCHASE` — greige cloth booked as dyed.
 *
 * ## IT READS THE CLASSIFICATION, IT DOES NOT TRUST THE PAYLOAD
 *
 * `getFabricProcessRows()` is the SAME reader the screen's options come from
 * (exported for this), so "what the grid offered" and "what the save accepts"
 * cannot drift into two select strings. It throws rather than defaulting if
 * `process_fabric_stages` is unreadable, which is deliberate there: an empty map
 * would read as "nothing is classified" and switch the whole rule off silently.
 * Same argument as `processKindsOf` above.
 *
 * ## THE GATES, AND THE ONE RESIDUAL DIVERGENCE, STATED
 *
 * `stageMismatchBlocked`'s floor test runs on the GATED list, so this guard has
 * to gate the same way the screen did or it reports rows the operator was never
 * warned about — the narrowing/twin divergence this module has already suffered
 * three times. `fabricIsYarnDyed` is resolved from `items.fabric_type` here, the
 * same way `yarnDyedProblem` above resolves it and for the same reason (the
 * payload must not be able to answer it).
 *
 * `printDeclared` is passed TRUE rather than re-read from the order's prints,
 * and that is a judgement with a cost worth naming. It only ever WITHHOLDS
 * print-flagged processes from the offered list, so the only way it can matter
 * here is if a stage's ONLY allowed processes are print-flagged: then the screen
 * sees an empty stage (floor in effect, silent) while this guard sees one and
 * refuses. With the shipped classification that cannot happen — the Printed
 * stage also holds DIP-WASH, GUM CUTTING and COMPACTING, and no other stage
 * holds a print-flagged process at all. If someone later classifies a stage to
 * print steps ALONE, the symptom is one refusal the screen did not predict, not
 * lost data; the fix then is to read the order's prints here too.
 */
async function stageRouteProblem(
  s: Awaited<ReturnType<typeof createClient>>,
  data: FabricBomInput,
): Promise<string | null> {
  const rows = data.processes.filter((p) => p.stage_id || p.process_id);
  if (rows.length === 0) return null;

  const [options, lookups] = await Promise.all([
    getFabricProcessRows(),
    getFabricProcessLookupRows(),
  ]);
  if (!lookups.stages.length) return null;

  const fabricIds = [...new Set(rows.map((r) => r.item_id))];
  const { data: itemRows } = await s
    .from("items")
    .select("id, fabric_type:config_lookups!fabric_type_id(name)")
    .in("id", fabricIds);
  /* THE EMBED IS AN ARRAY OR AN OBJECT depending on how PostgREST reads the
     relationship — normalised, never cast away, exactly as `yarnDyedProblem`
     does it. A cast that lies here reads a yarn-dyed fabric as untyped and
     hands the rule the wrong gate. */
  const nameOf = (v: { name: string | null } | { name: string | null }[] | null) =>
    Array.isArray(v) ? (v[0]?.name ?? null) : (v?.name ?? null);
  const typeById = new Map(
    ((itemRows ?? []) as unknown as {
      id: string;
      fabric_type: { name: string | null } | { name: string | null }[] | null;
    }[]).map((r) => [r.id, nameOf(r.fabric_type)]),
  );

  /* THE PAYLOAD ROW IS NOT A SCREEN ROW: it carries no `key` (that is client
     state) and its `sno` is already the position the screen sent. The rule
     needs a stable row identity only to report WHICH row, and the payload's
     own order is the route order — the same order `normalizeProcesses` turns
     into `sno` a few lines below. */
  const problems = stageRouteProblems(
    rows.map((r, i) => ({
      key: String(i),
      item_id: r.item_id,
      combo: r.combo ?? null,
      component_id: r.component_id ?? null,
      stage_id: r.stage_id ?? null,
      process_id: r.process_id ?? null,
      loss_for_id: r.loss_for_id ?? null,
      loss_pct: r.loss_pct == null ? "" : String(r.loss_pct),
      type_id: r.type_id ?? null,
    })),
    options,
    lookups.stages,
    {
      gatesFor: (itemId) => ({
        printDeclared: true,
        fabricIsYarnDyed: isYarnDyed(typeById.get(itemId) ?? null),
      }),
    },
  );
  return problems[0]?.message ?? null;
}

/**
 * THE ORDER'S PALETTE, WRITTEN FROM THIS SCREEN (client 2026-09-02).
 *
 * Color/Print Details' three colour/print panels are the ORDER's lists, and this
 * is the only place outside the Garment Order screen that writes them. The
 * design, the reason a rename is a delete-plus-add, and the reason the payload
 * carries NAMES rather than rows are all in `./palette.ts` — read that first.
 *
 * ## IT RUNS BEFORE THE BOM IS TOUCHED, IN BOTH ACTIONS
 *
 * A refused palette must leave nothing behind. In `createFabricBom` the header
 * insert is what mints the document, so a guard that ran after it would refuse
 * the save having already created a BOM the operator was never told about — and
 * `uq_order_fabric_bom_order` would then reject their second attempt with "this
 * order already has a fabric BOM". Running first makes the refusal free.
 *
 * ## `orders:edit`, NOT THE ACTION'S OWN PERMISSION
 *
 * `createFabricBom` checks `orders:create`, and creating a BOM is not licence to
 * rewrite the order it names. Someone who may raise a BOM but not amend an order
 * gets the BOM and a refusal on the palette, which is the correct pair.
 */
async function writePalette(
  s: Awaited<ReturnType<typeof createClient>>,
  garmentOrderId: string,
  palette: FabricBomInput["palette"],
): Promise<Result> {
  // UNDEFINED IS "NOT MY BUSINESS", and it is the common case: every save from a
  // screen that never opened this tab lands here. An empty ARRAY is the operator
  // emptying a panel and is a real instruction — see the schema's own note.
  if (!palette) return { ok: true };

  if (!(await can("orders", "edit"))) {
    return fail("You cannot change this order's colours — ask for orders:edit");
  }

  const [dyeRes, printRes] = await Promise.all([
    s
      .from("garment_order_amendment_dyeings")
      .select("id, sno, section, color_name")
      .eq("amendment_id", garmentOrderId),
    s
      .from("garment_order_amendment_prints")
      .select("id, sno, print_name")
      .eq("amendment_id", garmentOrderId),
  ]);
  if (dyeRes.error) return fail(`Could not read the order's colours: ${dyeRes.error.message}`);
  if (printRes.error) return fail(`Could not read the order's prints: ${printRes.error.message}`);

  type DyeRow = { id: string; sno: number; section: string | null; color_name: string | null };
  type PrintRow = { id: string; sno: number; print_name: string | null };
  const dyeings = (dyeRes.data ?? []) as unknown as DyeRow[];
  const prints = (printRes.data ?? []) as unknown as PrintRow[];

  const asStored = (rows: { sno: number; name: string | null }[]) => rows;
  const stored = {
    fabric: asStored(
      dyeings.filter((d) => d.section === "fabric").map((d) => ({ sno: d.sno, name: d.color_name })),
    ),
    yarn: asStored(
      dyeings.filter((d) => d.section === "yarn").map((d) => ({ sno: d.sno, name: d.color_name })),
    ),
    print: asStored(prints.map((r) => ({ sno: r.sno, name: r.print_name }))),
  };

  const diffs = {
    fabric: paletteDiff(stored.fabric, palette.fabric),
    yarn: paletteDiff(stored.yarn, palette.yarn),
    print: paletteDiff(stored.print, palette.prints),
  };

  const removedColours = new Set([...diffs.fabric.removed, ...diffs.yarn.removed]);
  const removedPrints = new Set(diffs.print.removed);

  /* THE GUARD, AND IT IS THE ONLY ONE THERE IS. Every column below holds the
     name as TEXT with no foreign key behind it, so a delete would succeed and
     leave the citing row naming a colour the order no longer declares — see
     `PaletteCitation` in ./palette.ts for why each is stored that way. */
  if (removedColours.size || removedPrints.size) {
    const [comboRes, bomRes] = await Promise.all([
      s
        .from("garment_order_amendment_combos")
        .select(
          "combo, structures:garment_order_amendment_combo_structures(yarn_colors, " +
            "components:garment_order_amendment_combo_components(color_name))",
        )
        .eq("amendment_id", garmentOrderId),
      s
        .from("order_fabric_boms")
        .select("id, lines:order_fabric_bom_lines(color_name, required_print)")
        .eq("garment_order_id", garmentOrderId),
    ]);
    if (comboRes.error) return fail(`Could not check the order's combos: ${comboRes.error.message}`);
    if (bomRes.error) return fail(`Could not check the fabric lines: ${bomRes.error.message}`);

    const cites: PaletteCitation[] = [];

    for (const c of (comboRes.data ?? []) as unknown as {
      combo: string | null;
      structures:
        | {
            yarn_colors: string[] | null;
            components: { color_name: string | null }[] | null;
          }[]
        | null;
    }[]) {
      const where = `combo ${normPaletteName(c.combo) || "(unnamed)"}`;
      for (const st of c.structures ?? []) {
        for (const y of st.yarn_colors ?? []) {
          const n = normPaletteName(y);
          if (removedColours.has(n)) cites.push({ name: n, where: `${where}'s yarn colours` });
        }
        for (const comp of st.components ?? []) {
          const n = normPaletteName(comp.color_name);
          if (removedColours.has(n)) cites.push({ name: n, where: `${where}'s structure details` });
        }
      }
    }

    for (const b of (bomRes.data ?? []) as unknown as {
      lines: { color_name: string | null; required_print: string | null }[] | null;
    }[]) {
      for (const l of b.lines ?? []) {
        const c = normPaletteName(l.color_name);
        if (removedColours.has(c)) cites.push({ name: c, where: "a fabric line on this BOM" });
        const pr = normPaletteName(l.required_print);
        if (removedPrints.has(pr)) cites.push({ name: pr, where: "a fabric line on this BOM" });
      }
    }

    const problem = citationProblem(cites);
    if (problem) return fail(problem);
  }

  /* DELETE BY ID, NOT BY NAME. A `.eq("color_name", n)` would be one round trip
     per name AND would re-derive the match with different rules from the ones
     `paletteDiff` just used — `normPaletteName` upper-cases, and the column may
     hold anything. The ids are already in hand and cannot disagree. */
  const dyeIdsToGo = dyeings
    .filter(
      (d) =>
        (d.section === "fabric" && diffs.fabric.removed.includes(normPaletteName(d.color_name))) ||
        (d.section === "yarn" && diffs.yarn.removed.includes(normPaletteName(d.color_name))),
    )
    .map((d) => d.id);
  if (dyeIdsToGo.length) {
    const { error } = await s.from("garment_order_amendment_dyeings").delete().in("id", dyeIdsToGo);
    if (error) return fail(error.message);
  }

  const printIdsToGo = prints
    .filter((r) => diffs.print.removed.includes(normPaletteName(r.print_name)))
    .map((r) => r.id);
  if (printIdsToGo.length) {
    const { error } = await s.from("garment_order_amendment_prints").delete().in("id", printIdsToGo);
    if (error) return fail(error.message);
  }

  /* `sno` CONTINUES FROM THE HIGHEST STORED, per section — it is NOT NULL and
     the order's own tab sorts on it. Counting the surviving rows instead would
     re-use a number the moment anything had ever been deleted, and two rows
     sharing an `sno` sort arbitrarily. */
  const maxDye = (section: string) =>
    Math.max(0, ...dyeings.filter((d) => d.section === section).map((d) => d.sno));
  const maxPrint = Math.max(0, ...prints.map((r) => r.sno));

  const newDyeings = [
    ...diffs.fabric.added.map((name, i) => ({
      amendment_id: garmentOrderId,
      sno: maxDye("fabric") + 1 + i,
      section: "fabric",
      /* `dye_type` NULL, DELIBERATELY. This tab does not show the type (0490
         dropped the column) and a value invented here would be a claim about how
         the colour is achieved that nobody made — which is exactly what
         `combo-rules.ts` reads to decide between a yarn dyeing and a fabric
         dyeing. The order's own tab is where it gets answered. */
      dye_type: null,
      color_name: name,
    })),
    ...diffs.yarn.added.map((name, i) => ({
      amendment_id: garmentOrderId,
      sno: maxDye("yarn") + 1 + i,
      section: "yarn",
      dye_type: null,
      color_name: name,
    })),
  ];
  if (newDyeings.length) {
    const { error } = await s.from("garment_order_amendment_dyeings").insert(newDyeings);
    if (error) return fail(error.message);
  }

  if (diffs.print.added.length) {
    const { error } = await s.from("garment_order_amendment_prints").insert(
      diffs.print.added.map((name, i) => ({
        amendment_id: garmentOrderId,
        sno: maxPrint + 1 + i,
        print_name: name,
      })),
    );
    if (error) return fail(error.message);
  }

  return { ok: true };
}

export async function createFabricBom(data: FabricBomFormInput): Promise<Result> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = fabricBomInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");

  const s = await createClient();

  const ydProblem = await yarnDyedProblem(s, p.data);
  if (ydProblem) return fail(ydProblem);

  /* THE STAGE RULES (0570) — beside the yarn-dyed guard and before anything is
     written, for the reason `writePalette` states: a refusal must leave nothing
     behind, and on the create path the header insert is what mints the
     document. */
  const routeProblem = await stageRouteProblem(s, p.data);
  if (routeProblem) return fail(routeProblem);

  // BEFORE THE HEADER INSERT — see `writePalette`. A refused palette must not
  // leave a BOM behind that the operator was never told about.
  const paletteRes = await writePalette(s, p.data.garment_order_id, p.data.palette);
  if (!paletteRes.ok) return paletteRes;

  const order = await getOrderProduction(p.data.garment_order_id);

  const { data: created, error } = await s
    .from("order_fabric_boms")
    .insert(headerOnly(p.data, order))
    .select("id")
    .single();
  if (error || !created) {
    // ONE BOM PER ORDER IS A CONSTRAINT (`uq_order_fabric_bom_order`, 0426), so
    // this is the ordinary race and the ordinary second click, not a bug. Say
    // what happened in the operator's words — a raw unique-violation string
    // names an index nobody outside this file has heard of.
    return fail(
      error?.code === "23505"
        ? "This order already has a fabric BOM — open it from the queue instead"
        : (error?.message ?? "Failed to create the fabric BOM"),
    );
  }

  const childRes = await writeLines(s, created.id, p.data, order);
  if (!childRes.ok) return childRes;

  await writeAudit({
    action: "order_fabric_bom.created",
    entityType: "order_fabric_bom",
    entityId: created.id,
  });
  rev();
  return { ok: true, id: created.id };
}

export async function updateFabricBom(id: string, data: FabricBomFormInput): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("Forbidden");
  const p = fabricBomInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");

  const s = await createClient();

  /* THE UPDATE CHECKS IT TOO. A rule enforced only on create is enforced once
     per document and never again — every save after the first walks past it,
     which is exactly why `checkDuplicateName` is required in both actions
     (AGENTS.md, Duplicates). */
  const ydProblem = await yarnDyedProblem(s, p.data);
  if (ydProblem) return fail(ydProblem);

  /* THE STAGE RULES (0570) — beside the yarn-dyed guard and before anything is
     written, for the reason `writePalette` states: a refusal must leave nothing
     behind, and on the create path the header insert is what mints the
     document. */
  const routeProblem = await stageRouteProblem(s, p.data);
  if (routeProblem) return fail(routeProblem);

  // Before the update, for the same reason as create: a refusal leaves the
  // document exactly as it was rather than half-written.
  const paletteRes = await writePalette(s, p.data.garment_order_id, p.data.palette);
  if (!paletteRes.ok) return paletteRes;

  const order = await getOrderProduction(p.data.garment_order_id);

  const { error } = await s.from("order_fabric_boms").update(headerOnly(p.data, order)).eq("id", id);
  if (error) return fail(error.message);

  const childRes = await writeLines(s, id, p.data, order);
  if (!childRes.ok) return childRes;

  await writeAudit({
    action: "order_fabric_bom.updated",
    entityType: "order_fabric_bom",
    entityId: id,
  });
  rev();
  return { ok: true, id };
}

export async function deleteFabricBom(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("order_fabric_boms").delete().eq("id", id); // children cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// What the editor asks the server for while it is open
// ---------------------------------------------------------------------------

export type OrderProductionResult =
  | { ok: true; order: OrderProductionInput }
  | { ok: false; error: string };

/**
 * The picked order's Approval Qty, Combos and Assort rows, so the requirement
 * recalculates as the operator types.
 *
 * One round trip per ORDER, not per keystroke: the line changes while the
 * operator works and the order's quantities do not.
 */
export async function loadOrderProduction(
  garmentOrderId: string,
): Promise<OrderProductionResult> {
  if (!(await can("orders", "view"))) return { ok: false, error: "Forbidden" };
  const order = await getOrderProduction(garmentOrderId);
  return order
    ? { ok: true, order }
    : { ok: false, error: "That order could not be read" };
}

export type OrderPaletteResult =
  | { ok: true; palette: OrderPalette }
  | { ok: false; error: string };

/**
 * The order's yarn dyeing, fabric dyeing and roll form prints (0490).
 *
 * A SERVER ACTION PER ORDER, for `loadOrderFabricSeed`'s reason below: the
 * palette belongs to ONE order and the screen's form data is loaded once for
 * every confirmed order on the list.
 *
 * SEPARATE FROM `loadOrderProduction` even though the screen fires both on the
 * same id. That one answers "how many garments", which the requirement engine
 * multiplies on every keystroke; this one answers "which colours", which
 * nothing computes from. Folding them together would make a palette read a
 * dependency of the arithmetic and put a failure to read the dyeing rows in the
 * way of a BOM that does not need them.
 */
export async function loadOrderPalette(
  garmentOrderId: string,
): Promise<OrderPaletteResult> {
  if (!(await can("orders", "view"))) return { ok: false, error: "Forbidden" };
  return { ok: true, palette: await getOrderPalette(garmentOrderId) };
}

export type OrderStyleComponentsResult =
  | { ok: true; decls: StyleComponentDecl[] }
  | { ok: false; error: string };

/**
 * The order's panel-to-fabric declaration, for the Components mapping rules
 * (0495).
 *
 * A SEPARATE ROUND TRIP FROM `loadOrderPalette`, and for the reason that one
 * already records: folded together, a declaration table that failed to read
 * would block a palette that never needed it. Per-order, so it is an action
 * rather than form data — shipping every confirmed order's component map to the
 * browser to use one of them is the payload `loadOrderFabricSeed` beside it
 * already declines to send.
 */
export async function loadOrderStyleComponents(
  garmentOrderId: string,
): Promise<OrderStyleComponentsResult> {
  if (!(await can("orders", "view"))) return { ok: false, error: "Forbidden" };
  return { ok: true, decls: await getOrderStyleComponents(garmentOrderId) };
}

export type OrderFabricSeedResult =
  | { ok: true; rows: OrderFabricSeedRow[] }
  | { ok: false; error: string };

/**
 * The order's own Combos ▸ Detail tree, flattened into candidate BOM lines.
 *
 * A SERVER ACTION AND NOT PART OF THE FORM DATA, because it is per-order and the
 * form data is loaded once for the screen. Shipping every confirmed order's
 * fabric tree to the browser to use one of them is the payload the Material BOM
 * already declines to send for its own order production.
 */
export async function loadOrderFabricSeed(
  garmentOrderId: string,
): Promise<OrderFabricSeedResult> {
  if (!(await can("orders", "view"))) return { ok: false, error: "Forbidden" };
  const rows = await getOrderFabricSeed(garmentOrderId);
  return rows.length > 0
    ? { ok: true, rows }
    : {
        ok: false,
        // EMPTY-AND-EXPLAIN. An order with no fabric tree is a real state — the
        // Combos tab was left blank — and a seed button that silently adds
        // nothing looks broken rather than informative.
        error: "This order's Combos tab names no fabric structures yet",
      };
}

export type BomYarnCompositionResult =
  | { ok: true; data: BomYarnComposition }
  | { ok: false; error: string };

/**
 * The compositions the Yarn Process tab derives its rows from (0493).
 *
 * A SERVER ACTION and not part of the screen's form data, for
 * `loadOrderFabricSeed`'s reason and one sharper one: it answers for the fabrics
 * the FORM holds, which on a BOM being created have not been saved and on one
 * being edited may have just changed. There is no stored row to read, so this
 * could not be form data even in principle.
 *
 * THE IDS COME FROM THE CLIENT AND THAT IS SAFE HERE. They are `items` ids, the
 * query returns nothing but yarn names and blend percentages, and every read is
 * already behind `orders:view`. It is READ-ONLY in every sense that matters: the
 * SAVE path fetches the same compositions again, server-side
 * (`compositionMapFor`), so nothing a client sends here can move a purchase
 * weight.
 *
 * IT NEVER REFUSES ON EMPTINESS. An empty result is a real and common state — a
 * BOM whose fabrics declare no composition — and the SCREEN is where that gets a
 * sentence, because it knows whether the cause is "no fabric named yet" or "this
 * fabric has no Mixing rows". An `ok: false` here would make the tab look broken
 * for an ordinary state, which is the opposite of empty-and-explain.
 */
export async function loadBomYarnComposition(
  fabricItemIds: string[],
): Promise<BomYarnCompositionResult> {
  if (!(await can("orders", "view"))) return { ok: false, error: "Forbidden" };
  return { ok: true, data: await getBomYarnComposition(fabricItemIds) };
}

/**
 * The two per-BOM printable reports (see `./reports.ts`'s own header for what
 * each reads and why neither recomputes a figure a purchase depends on).
 * Thin permission-gated wrappers, the same shape `loadBomYarnComposition`
 * above already uses — the client component that renders them never talks to
 * Supabase directly.
 */
export async function loadFabricBomEntryRegister(bomId: string) {
  if (!(await can("orders", "view"))) return { refused: "Forbidden" };
  return fabricBomEntryRegister(bomId);
}

export async function loadYarnFabricRequirementReport(bomId: string) {
  if (!(await can("orders", "view"))) return { refused: "Forbidden" };
  return yarnFabricRequirementReport(bomId);
}
