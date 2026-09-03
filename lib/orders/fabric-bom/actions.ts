"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { missingFabricLineFields } from "./fabric-line-rules";
import { fabricBomInput, type FabricBomFormInput, type FabricBomInput } from "./types";
import {
  getBomYarnComposition,
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
import { consumptionMap } from "./manual";
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
  stageProcessQty,
  yarnPurchase,
  yarnStageStarted,
  type FabricComposition,
  type FabricGross,
} from "./yarn-process";
import {
  basisFingerprint,
  totalProductionOf,
  isRefusal as isOrderRefusal,
  type OrderProductionInput,
} from "@/lib/orders/material-bom/requirement";

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
      sno: 0,
      /* DEDUPED, because `uq_ofbmc_entry_component` would reject the second copy
         and take the whole save with it. The multi-select cannot produce one
         today; a `lib/data-io` import could. */
      component_ids: [...new Set(e.component_ids ?? [])],
      sizes: normalizeManualSizes(e.sizes ?? []),
    }))
    /* A ROW SAYS SOMETHING WHEN IT NAMES A CLOTH OR A PANEL. `item_id` replaced
       `structure_id` here in 0522 for the reason the whole entry changed grain:
       the structure is no longer typed, so a row carrying one and nothing else
       is a row the planner never started. */
    .filter((e) => e.item_id !== null || e.component_ids.length > 0)
    .map((e, i) => ({ ...e, sno: i + 1 }));
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
      width_tolerance: r.width_tolerance ?? null,
      cons_qty: r.cons_qty ?? null,
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
          r.width_tolerance != null ||
          /* `cons_qty` COUNTS AS SAYING SOMETHING (0523). It is the spec's own
             multiplier and a row carrying only it is a row the planner typed
             into — dropping it here would silently discard the figure the CAD
             report gave them. */
          r.cons_qty != null),
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
 * ## RENUMBERED PER FABRIC, WHICH `uq_ofbp_item_sno` REQUIRES
 *
 * 0492's unique index is (bom_id, item_id, sno), so the counter restarts on each
 * fabric. One running counter across the document would not collide — it would
 * just number the second fabric's first step 5 — but the ordinal is what the
 * screen renders as `#`, and a route reading "#5 #6" under a fabric with two
 * steps is a document explaining itself wrongly.
 *
 * ## ORPHANS GO SILENTLY, AND THAT IS THE INTENDED READING
 *
 * A route whose fabric no longer appears on any line is dropped: the operator
 * removed that fabric from the BOM, and keeping steps for cloth this document
 * no longer plans would leave the Budget costing a process nobody ordered. The
 * screen keeps such a card VISIBLE while its rows exist, so this is never the
 * first the operator hears of it.
 */
function normalizeProcesses(data: FabricBomInput, fabricIds: Set<string>) {
  const nextSno = new Map<string, number>();
  const out: Record<string, unknown>[] = [];

  for (const p of data.processes) {
    if (!p.process_id) continue;
    if (!fabricIds.has(p.item_id)) continue;
    const sno = (nextSno.get(p.item_id) ?? 0) + 1;
    nextSno.set(p.item_id, sno);
    out.push({
      item_id: p.item_id,
      sno,
      stage_id: p.stage_id ?? null,
      process_id: p.process_id,
      loss_for_id: p.loss_for_id ?? null,
      description: clean(p.description),
      loss_pct: p.loss_pct ?? null,
      type_id: p.type_id ?? null,
    });
  }
  return out;
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
 * ## THE UNIT COMES OFF THE CLOTH, NOT OFF THE LINES
 *
 * `items.base_uom_id` — the same fact `FabricOption.base_uom_id` already feeds
 * into a line's `consumption_uom_id` (0513), so this reads it one hop earlier
 * and the two cannot disagree. It also removes the second reason this function
 * needed the lines: two lines of one fabric measured differently used to make
 * the requirement's own unit a coin toss.
 *
 * NULL is a real answer (a master row created without a base unit) and falls
 * through to `uomPrecision`, which floors at 2 decimals.
 */
type EntryFabric = { item_id: string; uom_id: string | null };

/**
 * What the entries' cloths say about themselves — `items.category_id` (which IS
 * the structure, 0405 · 0415 · 0426) and `items.base_uom_id` (the unit), by item
 * id.
 *
 * READ ONCE PER SAVE rather than joined per entry: a BOM has a handful of
 * entries and they routinely name the same cloth.
 */
type FabricFacts = Map<string, { category_id: string | null; base_uom_id: string | null }>;

function entryFabric(
  entry: { item_id: string | null },
  fabrics: FabricFacts,
): EntryFabric | Refusal {
  if (!entry.item_id) {
    /* THE SAME SENTENCE `manualProblem` USES for the same state, deliberately:
       "two spellings of one refusal is how an operator comes to believe there
       are two different problems" (./manual.ts). */
    return { refused: "Choose the fabric this weight is for" };
  }
  return {
    item_id: entry.item_id,
    uom_id: fabrics.get(entry.item_id)?.base_uom_id ?? null,
  };
}

function requirementRows(
  entries: EntryRowWithId[],
  /* THE CLOTHS, NOT THE LINES (0522). This used to take `LineRowWithId[]` so
     `entryFabric` could search them for the entry's fabric; the entry names it
     now, and all this needs is what that cloth's own master row says. */
  fabrics: FabricFacts,
  order: OrderProductionInput,
  uomDecimals: Map<string, number | null>,
  gsmByStructure: Map<string, number>,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let sno = 0;

  for (const entry of entries) {
    const fabric = entryFabric(entry, fabrics);

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
        consumption_uom_id: isRefusal(fabric) ? null : fabric.uom_id,
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

         NEVER SCOPED BY COMBO. Fabric is dyed per colourway, so the requirement
         must SPLIT by it, but the gram weight does not depend on it: an entry
         states one weight per size and the explosion applies it to every
         colourway of the style. That is the whole reason the basis is
         `colour_size` rather than `size`. */
      { style_ref_no: entry.style_ref_no, combo: null },
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
        decimals: fabric.uom_id ? (uomDecimals.get(fabric.uom_id) ?? null) : null,
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
        consumption_uom_id: fabric.uom_id,
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
  const total = order ? totalProductionOf(order) : null;
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

function normalizeYarns(
  data: FabricBomInput,
  fabrics: readonly FabricGross[],
  compositions: ReadonlyMap<string, FabricComposition>,
  uomDecimals: Map<string, number | null>,
): NormalizedYarn[] {
  const seen = new Set<string>();
  const out: NormalizedYarn[] = [];

  for (const y of data.yarns) {
    if (!y.item_id || seen.has(y.item_id)) continue;
    seen.add(y.item_id);

    const kept = y.stages.filter((st) =>
      yarnStageStarted({
        stage_id: st.stage_id,
        process_id: st.process_id,
        loss_for_id: st.loss_for_id ?? null,
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
      /* ONLY THE LOSS SINCE 0520. `For` describes how the loss is measured and
         no longer scopes it, so the engine is not handed a value it would only
         ignore — the same call the screen's `weightFor` makes, deliberately, so
         the preview and the stored figure stay one computation. */
      kept.map((st) => ({ loss_pct: st.loss_pct ?? null })),
      uomId ? (uomDecimals.get(uomId) ?? null) : null,
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

           THE YARN'S OWN REFUSAL IS THE ONLY REASON LEFT (0520). `stageProblem`
           used to add a second — a step naming a colourway the requirement does
           not have — and a step can no longer name one, so that state is
           unrepresentable rather than merely rare. See its note in
           `yarn-process.ts` for why a guard that cannot fire was deleted rather
           than kept. */
        const problem = refused ? weight.refused : null;
        return {
          sno: i + 1,
          stage_id: st.stage_id ?? null,
          process_id: st.process_id ?? null,
          loss_for_id: st.loss_for_id ?? null,
          description: st.description ?? null,
          loss_pct: st.loss_pct ?? null,
          ...(st.process_id && !problem
            ? {
                process_qty: stageProcessQty(byCombo),
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
 * NO DELETE HERE. The caller has already cleared `order_fabric_bom_yarns` on
 * `bom_id`, and the stages went with them by cascade — they cannot be in that
 * loop, because it deletes on `bom_id` and a stage has no such column.
 */
async function writeYarns(
  s: Awaited<ReturnType<typeof createClient>>,
  bomId: string,
  data: FabricBomInput,
  fabrics: readonly FabricGross[],
  compositions: ReadonlyMap<string, FabricComposition>,
  uomDecimals: Map<string, number | null>,
): Promise<Result> {
  const yarns = normalizeYarns(data, fabrics, compositions, uomDecimals);
  if (yarns.length === 0) return { ok: true };

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
    "order_fabric_bom_lines",
    "order_fabric_bom_dias",
    /* THE YARNS, AND THEIR ROUTES BY CASCADE (0493).
       `order_fabric_bom_yarn_processes` is absent from this list for the reason
       it cannot be in it: the loop deletes on `bom_id` and that table has no
       such column. It is a GRANDCHILD — same shape and same note as 0491's
       `order_fabric_bom_line_sizes`, which the lines' own delete clears. */
    "order_fabric_bom_yarns",
    /* THE MANUAL ENTRIES, AND THEIR COMPONENTS AND SIZES BY CASCADE (0494).
       `order_fabric_bom_manual_components` and `_manual_sizes` are absent from
       this list for the reason they cannot be in it: the loop deletes on
       `bom_id` and both are keyed on `entry_id`. They are GRANDCHILDREN — the
       same shape and the same note the yarn routes carry just above. */
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
    const { error } = await s
      .from("order_fabric_bom_yd_combinations")
      .insert(ydCombinations.map((r) => ({ ...r, bom_id: bomId })));
    if (error) return fail(error.message);
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
  const processRows = normalizeProcesses(data, fabricIds);
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
   * `items.category_id` IS the structure (0405 · 0415 · 0426) and
   * `items.base_uom_id` is the unit the requirement is measured in. Both are
   * facts of the MASTER, so they are read from it rather than trusted from the
   * form — the same call this action already makes for the GSM one block down,
   * and for the same reason: a figure the browser could set is a figure a client
   * could set, and both of these reach a purchase weight.
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
      .select("id, category_id, base_uom_id")
      .in("id", entryFabricIds);
    if (fErr) return fail(fErr.message);
    for (const r of (fRows ?? []) as {
      id: string;
      category_id: string | null;
      base_uom_id: string | null;
    }[]) {
      fabricFacts.set(r.id, { category_id: r.category_id, base_uom_id: r.base_uom_id });
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
      /* `component_ids` AND `sizes` ARE STRIPPED HERE, BY NAME. They ride on the
         normalized entry so that both can be paired with the id this insert
         reads back; PostgREST would reject the whole batch on an unknown
         column, which is the good failure. The bad one is a rename that makes
         either resolve to something real, so the strip is written out at the one
         place it has to happen rather than left to a spread. */
      .insert(
        entries.map(({ component_ids: _c, sizes: _z, ...e }) => ({ ...e, bom_id: bomId })),
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

    const componentRows = savedEntries.flatMap((e) =>
      e.component_ids.map((component_id) => ({ entry_id: e.id, component_id })),
    );
    if (componentRows.length) {
      const { error: cErr } = await s
        .from("order_fabric_bom_manual_components")
        .insert(componentRows);
      if (cErr) return fail(cErr.message);
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
    const [dp, seed] = await Promise.all([
      uomDecimalMap(s),
      getOrderFabricSeed(data.garment_order_id),
    ]);
    decimals = dp;
    requirement = requirementRows(
      savedEntries,
      fabricFacts,
      order,
      decimals,
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
    fabricGrossOf(requirement),
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
): FabricGross[] {
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
    const bucket = `${key} ${comboKey(combo)}`;
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
