"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  materialBomAmendmentInput,
  DEFAULT_SUPPLY_TYPE,
  type MaterialBomAmendmentInput,
  type MbaItemInput,
  type BomCopyPayload,
} from "./types";
import { getOrderProduction } from "./service";
import {
  basisFingerprint,
  colourSplits,
  isRefusal,
  panelConsumption,
  productionSlices,
  requirementFor,
  totalProductionOf,
  type ColourSplit,
  type OrderProductionInput,
  type RequirementBasis,
} from "@/lib/orders/material-bom/requirement";
import {
  axesOfBasis,
  basisForAxes,
  type Axis,
} from "@/lib/orders/bom-explosion/exploder";
import { slicesForAxes } from "@/lib/orders/bom-explosion/compose";
import {
  combinationNames,
  consumptionFor,
  crossCombinations,
  toOverrides,
  liveOverrides,
  sliceKey,
  type SliceKey,
} from "@/lib/orders/material-bom/slice-consumption";
import { toPurchaseQty, uomPrecision } from "@/lib/uom/convert";
import { resolveLinePack } from "@/lib/orders/material-bom/pack-resolve";
/* The purchase stage every raw line starts in, and the loss rule that inflates
   a line carrying processes (0476, client 2026-08-29). Imported rather than
   spelled out: 0475 records on this same table what a hand-typed second copy of
   a stored literal costs when the cases drift. */
import {
  purchaseStageOrGreige,
  requiredWithProcessLoss,
  type ProcessLossRow,
} from "@/lib/orders/material-bom/process-loss";

type Result = { ok: true; id?: string } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}

/**
 * Four routes, because the BOM's status is shown on two screens that are not
 * this one. `/orders/amendments` and `/orders/garment-orders` are the two doors
 * onto the Garment Order list, which carries the "Material BOM" column; leaving
 * either stale means saving a BOM does not change the badge the operator is
 * looking at.
 */
function rev(): void {
  revalidatePath("/orders/material-bom");
  revalidatePath("/orders/amendments");
  revalidatePath("/orders/garment-orders");
  revalidatePath("/orders/all");
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const numOrNull = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

// ---------------------------------------------------------------------------
// Child normalizers (drop fully-empty rows + renumber sno)
// ---------------------------------------------------------------------------

function normalizeItems(data: MaterialBomAmendmentInput) {
  return data.items
    .map((c) => ({
      category_id: c.category_id ?? null,
      type: clean(c.type),
      item_id: c.item_id ?? null,
      attribute_id: c.attribute_id ?? null,
      item_color_id: c.item_color_id ?? null,
      specification: clean(c.specification),
      size: clean(c.size),
      requirement_basis: c.requirement_basis ?? null,
      /* THE GRAIN (0455), and this literal is the whole write. `component_id`
         and `round_to` each have a comment above recording what an omission
         here costs: no type error, no null written over a value — the value
         simply never leaves the browser. */
      requirement_grain: c.requirement_grain ?? null,
      style_ref_no: clean(c.style_ref_no),
      // 0423's column. It was declared on the table, offered by the grid and
      // accepted by `mbaItemInput`, and then dropped HERE — this literal names
      // every column it writes, so an omission is silent: the operator picked a
      // panel, saved, and reopened the line to find it blank. Not a null being
      // written over a value; the value never left the browser.
      component_id: c.component_id ?? null,
      supply_type: clean(c.supply_type),
      /**
       * 0476 — the PURCHASE STAGE, "Greige" and locked (client 2026-08-29).
       *
       * Named here for the reason `component_id`, `send_out`, `free_of_cost` and
       * `round_to` all record on this same literal: it is the whole write, so a
       * column left out of it dies at the server boundary with no type error and
       * no null written over a value — the value simply never leaves the browser.
       *
       * ## AND THE `??` IS THE HALF 0475 SHIPPED WITHOUT
       *
       * A COLUMN DEFAULT ONLY FIRES WHEN THE INSERT OMITS THE COLUMN. 0475 set
       * `supply_type default 'Local'` and wrote its own gap down: this literal
       * NAMES the column, `clean()` returns NULL for a blank, "so every insert
       * this app makes NAMES the column, and the default will never fire through
       * the application's own writer".
       *
       * That is the line directly above, still true and still reported. This one
       * does not repeat it: the coalesce is what makes the invariant hold through
       * the app's own save path, and 0476's default then covers the writers this
       * file is not — a `lib/data-io` import, a hand-written INSERT.
       */
      purchase_stage: purchaseStageOrGreige(c.purchase_stage),
      vendor_id: c.vendor_id ?? null,
      purchase_uom_id: c.purchase_uom_id ?? null,
      consumption_uom_id: c.consumption_uom_id ?? null,
      alternate_uom_id: c.alternate_uom_id ?? null,
      uom_conversion_id: c.uom_conversion_id ?? null,
      combination: clean(c.combination),
      /* 0466 — "Send out". Named here for the reason `round_to` below and
         `component_id` above both record: this literal is the whole write, so a
         column left out of it dies at the server boundary with no type error.

         NOT ADDED TO THE BLANK-ROW FILTER BELOW, deliberately. `false` is the
         default and a row carrying nothing but an un-ticked box is not a line
         the operator entered; a row that is only TICKED is not one either — it
         names no material, so the Processes tab could not list it and the
         requirement could not price it. Everything real about a line is already
         in that OR-chain. */
      send_out: c.send_out ?? false,
      /* 0474 — "Free of Cost Receipt". Named here for the reason `send_out`
         above and `round_to` below both record: this literal is the whole
         write, so a column left out of it dies at the server boundary with no
         type error.

         NOT ADDED TO THE BLANK-ROW FILTER BELOW, the same call `send_out`
         made and for a sharper reason. `false` is the default, and a row
         carrying nothing but a ticked FOC box names no material — so there is
         nothing to receive free of cost, and no receipt path could offer it.
         Everything real about a line is already in that OR-chain.

         NOTHING READS THIS COLUMN YET. 0474 adds the declaration; the receipt
         path that would consume it does not exist — `postGrn` skips a line with
         no purchase order and takes nothing into stock. The gap, and what
         closing it needs, is written up on `grnLineInput` in
         `lib/purchase/types.ts`. Said here because a flag with no reader looks
         like a wiring bug to the next person who greps for one. */
      is_foc: c.is_foc ?? false,
      moq: c.moq ?? null,
      // 0437. Named here for the reason the comment on `component_id`
      // above records: this literal is the whole write, so a column left
      // out of it dies at the server boundary without a type error.
      round_to: c.round_to ?? null,
      no_of_items: c.no_of_items ?? null,
      per_pieces: c.per_pieces ?? null,
      excess_pct: c.excess_pct ?? 0,
      required_by: clean(c.required_by),
      /* CARRIED THROUGH THE FILTER, NOT PAIRED BY INDEX LATER (0442).
         This function DROPS empty rows, so `normalizeItems(data)[i]` is not
         `data.items[i]` — pairing the overrides by position afterwards would put
         one material's size consumption on another's, silently, exactly the
         mis-pair the `sno` map below exists to prevent one level up. Riding
         along on the row is the only pairing that cannot drift; the parent
         insert strips it again. */
      slices: c.slices ?? [],
      /* THE PANELS RIDE ALONG TOO (0436), and for the identical reason the
         overrides above do: this function DROPS empty rows, so
         `normalizeItems(data)[i]` is not `data.items[i]` and pairing the panels
         by position afterwards would put one material's construction on
         another's. Stripped again at the parent insert, the same way. */
      components: c.components ?? [],
    }))
    .filter(
      (c) =>
        c.category_id ||
        c.item_id ||
        c.attribute_id ||
        c.item_color_id ||
        c.specification ||
        c.size ||
        c.requirement_basis ||
        c.requirement_grain != null ||
        /* ## `c.type ||` AND `c.supply_type ||` BOTH STOOD HERE AND WERE BOTH
           ## REMOVED ON 2026-08-28. THE RULE THAT REPLACES THEM:
           ##
           ##   NO FIELD `blankItem` GIVES A TRUTHY DEFAULT MAY APPEAR IN THIS
           ##   OR-CHAIN.
           ##
           ## Today that set is exactly {type, supply_type}. Check it before
           ## adding a clause, and check this chain before adding a default.

           This is one bug with two instances, and it was found one instance at a
           time — removing only `supply_type` left `type` doing the identical
           thing on the line above, so the fix read as complete while the
           behaviour was unchanged. An OR-chain needs only one surviving clause.

           WHY A DEFAULT DESTROYS A CLAUSE. This filter asks "did somebody enter
           this line?", and each clause answers by testing a field for content.
           A field `blankItem` stamps is never blank, so its clause is not a test
           at all — it is the constant `true`, wearing the shape of evidence.
           `type` gained its default on 2026-08-21 and `supply_type` the same
           day; from that day the chain could not return false.

           WHAT IT COST. `superRefine` returns no issues for a row with no
           `item_id` PRECISELY BECAUSE it delegates the drop to this filter (see
           its comment: "an entirely blank row is how a grid opens and is dropped
           by `normalizeItems`"). So an untouched "+ Add material" row passed
           validation by design, passed this filter on two values nobody typed,
           and was INSERTED as a phantom line naming no material. Two halves each
           correct alone — a validator that delegates emptiness, and a filter
           whose emptiness test was invalidated by a default added in another
           file.

           THE NUMERICS ARE SAFE ONLY BY ACCIDENT OF A CONVERTER ELSEWHERE, which
           is worth knowing before trusting them. `blankItem` sets `moq`,
           `no_of_items`, `per_pieces`, `round_to` and `excess_pct` to `""`, and
           `numN` is `z.coerce.number()`, which turns `""` into **0, not null**.
           The three `!= null` clauses below would therefore all be permanently
           true — except that the screen maps `""` to null with `numOrNull`
           before building the payload. A future payload path that sends the raw
           strings lights up three more clauses at once.

           This is the same argument the `send_out` and `is_foc` comments above
           make — a row carrying nothing but a stamped flag is not a line the
           operator entered — and it is why neither of them was ever added here. */
        c.vendor_id ||
        c.purchase_uom_id ||
        c.consumption_uom_id ||
        c.alternate_uom_id ||
        c.uom_conversion_id ||
        c.combination ||
        c.moq != null ||
        c.no_of_items != null ||
        c.per_pieces != null,
    )
    /**
     * SUPPLY TYPE IS DEFAULTED HERE, ON THE SERVER — and the POSITION of this
     * line, after the filter rather than inside the map above, is the whole of
     * what makes it safe.
     *
     * ## Why the server defaults it at all
     *
     * The client had the Supply Type control removed from this screen on
     * 2026-08-28. `blankItem` is now the only writer of the column anywhere in
     * the app, it runs on exactly one event — adding a new line — and there is
     * no control left that can change the value afterwards. So a row that
     * reaches the server without one can never be repaired from any screen.
     *
     * It also settles a divergence that is a bug on its own terms: `blankItem`
     * opens a new line on "Local", and `clean()` above turns a blank into NULL —
     * so the form showed Local while the save wrote NULL.
     *
     * 0475 sets the same default on the COLUMN, and that is not this line's
     * duplicate. **A column default applies only when an INSERT omits the
     * column**; this literal names it on every insert, so the database default
     * can never fire through this writer. 0475 repairs rows that already exist
     * and covers writers that omit the column (`lib/data-io`, a hand-written
     * INSERT); this covers the app. Both are needed and neither is redundant.
     *
     * ## WHY IT IS AFTER THE FILTER AND STAYS THERE
     *
     * When this line was written the filter still tested `c.supply_type ||` as
     * evidence that an operator had entered something. Defaulting in the map
     * above would have made that clause true for every row including an
     * untouched blank one, turning a latent phantom-row bug into a guaranteed
     * one. **That clause has since been removed** (see the filter above), so
     * that particular constraint no longer binds.
     *
     * IT STAYS HERE ANYWAY, and the reason is now the general one rather than
     * the specific one: a value this line stamps must not be able to satisfy a
     * test of whether the operator entered anything. Keeping the default after
     * the filter means no FUTURE clause reading `supply_type` can be silently
     * satisfied by it — the position is insensitive to what the filter happens
     * to contain, which is a property worth having rather than an accident of
     * what was there in August.
     *
     * That is the same rule the filter states from the other side ("no field
     * `blankItem` gives a truthy default may appear in the OR-chain"): one
     * invariant, guarded at both ends, because it has now been broken twice.
     */
    .map((c, i) => ({
      ...c,
      supply_type: c.supply_type ?? DEFAULT_SUPPLY_TYPE,
      sno: i + 1,
    }));
}

function normalizeProcesses(data: MaterialBomAmendmentInput) {
  return data.processes
    .filter(
      (p) =>
        p.item_id ||
        p.process_id ||
        p.vendor_id ||
        p.qty_out != null ||
        /* LEGACY'S FIVE COUNT AS CONTENT (0465). Every clause above names part of
           the lifecycle, so a row an operator filled in from the legacy side —
           a Stage and a Loss %, no vendor and no quantity yet — was dropped here
           and the typed work vanished on save. The same omission was found in
           the slice store's own emptiness test for the same reason: a filter
           written when one family of fields existed does not know about the
           next. */
        !!(p.stage ?? "").trim() ||
        !!(p.for_scope ?? "").trim() ||
        !!(p.description ?? "").trim() ||
        p.loss_pct != null ||
        !!(p.notes ?? "").trim(),
    )
    .map((p, i) => ({
      item_id: p.item_id ?? null,
      process_id: p.process_id ?? null,
      vendor_id: p.vendor_id ?? null,
      qty_out: p.qty_out ?? null,
      qty_in: p.qty_in ?? null,
      status: p.status ?? "planned",
      /* NAMED HERE, for the reason the `row_uid` comment below states: this
         literal IS the whole write, so a column missing from it is lost at the
         server boundary with no type error to catch it (0465). */
      stage: p.stage ?? null,
      for_scope: p.for_scope ?? null,
      description: p.description ?? null,
      loss_pct: p.loss_pct ?? null,
      notes: p.notes ?? null,
      /* 0446. Named in this literal for the reason `component_id` above records:
         this is the whole write, so a column left out of it dies at the server
         boundary with no type error — and this one carries the link to a challan
         that has already left the building. `?? undefined` lets the DB default
         mint one for a payload that predates the column. */
      row_uid: p.row_uid ?? undefined,
      sno: i + 1,
    }));
}

// ---------------------------------------------------------------------------
// The requirement, computed on the SERVER
// ---------------------------------------------------------------------------

type ConversionRow = {
  id: string;
  /* WHOSE PACK IT IS. Selected since 2026-08-27 because `resolveLinePack`
     matches a line's units against ITS OWN material's conversions — without it
     the server could only look a pack up by the id a line names, which is the
     lookup that stopped answering when the Purchase Pack cell was removed. */
  item_id: string;
  alt_qty: number | null;
  alt_uom_id: string | null;
  base_qty: number | null;
  base_uom_id: string | null;
};

/** A material's pack sizes and the UOM precisions, for the purchase quantity. */
type PackContext = {
  /* BOTH SHAPES OF ONE READ. The map answers "the pack this line names" and the
     list answers "the packs this material has" — `resolveLinePack` needs the
     second and the first is what every existing reader holds. One query. */
  conversions: Map<string, ConversionRow>;
  conversionList: ConversionRow[];
  uomDecimals: Map<string, number | null>;
  /* THE UNIT'S CODE, for `roundRequirement` — a Gross ceils to a whole unit and
     a Metre keeps its decimals (0476). Decimals alone cannot answer that: every
     uom in this database declares 2, including GROSS and PCS, so a rule keyed on
     precision would round nothing at all. Same read as `uomDecimals`, one more
     column. */
  uomCodes: Map<string, string | null>;
};

async function packContext(s: Awaited<ReturnType<typeof createClient>>): Promise<PackContext> {
  const [conv, uoms] = await Promise.all([
    s
      .from("material_uom_conversions")
      .select("id, item_id, alt_qty, alt_uom_id, base_qty, base_uom_id"),
    s.from("uoms").select("id, code, decimal_places_allowed"),
  ]);
  const conversionList = (conv.data ?? []) as ConversionRow[];
  const uomRows = (uoms.data ?? []) as {
    id: string;
    code: string | null;
    decimal_places_allowed: number | null;
  }[];
  return {
    conversions: new Map(conversionList.map((c) => [c.id, c])),
    conversionList,
    uomDecimals: new Map(uomRows.map((u) => [u.id, u.decimal_places_allowed])),
    uomCodes: new Map(uomRows.map((u) => [u.id, u.code])),
  };
}

type ItemRowWithId = ReturnType<typeof normalizeItems>[number] & { id: string };

/**
 * Explode every saved BOM line into its requirement rows.
 *
 * COMPUTED HERE, FROM THE ORDER READ BACK OUT OF THE DATABASE — never from the
 * form. Same argument 0413 makes for reading rejection tiers server-side: a
 * stale tab must not be able to store a quantity no order ever produced. The
 * screen runs the identical functions so what the operator approved and what is
 * stored cannot differ, but the stored copy is the one computed from the truth.
 *
 * A REFUSAL IS A ROW, not a gap. `required_qty` NULL plus `refusal_reason` means
 * anyone reading the document later — a buyer, an auditor, the next
 * merchandiser — sees which question was unanswered. Dropping refused lines
 * would leave a BOM that looks complete and buys short.
 */
/**
 * The per-row flags a line's overrides carry (0449), keyed by slice.
 *
 * ONE READER, TWO USES: `sizeWiseOf` feeds `productionSlices` so a ticked row
 * splits itself, and `chosenOf` decides whether its requirement row is emitted
 * at all. Built once per line rather than searched per slice — the search is
 * `sliceKey`, and doing it inside a loop over slices is quadratic on a
 * combination explosion.
 */
function sliceFlags(
  slices: readonly {
    combo?: string | null;
    size_id?: string | null;
    country_id?: string | null;
    combination?: string | null;
    style_ref_no?: string | null;
    chosen?: boolean;
    size_wise?: boolean;
    item_color_id?: string | null;
  }[] = [],
) {
  const by = new Map<string, (typeof slices)[number]>();
  for (const sl of slices) {
    by.set(
      sliceKey({
        combo: sl.combo ?? null,
        size_id: sl.size_id ?? null,
        country_id: sl.country_id ?? null,
        // PART OF THE KEY SINCE 0463. Omitting it here would not fail to
        // compile — `SliceKey` makes it optional so a pre-0463 caller still
        // reads — it would silently key every combination row as if it had no
        // name, so TOP's ticks would answer for BOTTOM's.
        combination: sl.combination ?? null,
        // And the same for the style (0464): without it every style-basis row
        // keys alike, so one row's Choose / Size-wise ticks answer for all of
        // them.
        style_ref_no: sl.style_ref_no ?? null,
      }),
      sl,
    );
  }
  return {
    /* DEFAULTS TRUE. A slice with no stored row has never been unticked, and the
       default has to be the state that buys. */
    chosen: (s: SliceKey) => by.get(sliceKey(s))?.chosen ?? true,
    sizeWise: (s: SliceKey) => by.get(sliceKey(s))?.size_wise ?? false,
    colour: (s: SliceKey) => by.get(sliceKey(s))?.item_color_id ?? null,
  };
}

/**
 * THE SLICES THIS LINE ACTUALLY HAS, for `liveOverrides` to adjudicate against.
 *
 * ## IT IS THE UNION OF THE PRIMARY AND EXPANDED SETS, AND ONE CALL IS A BUG
 *
 * `liveOverrides` is a DELETE on the way out, so whatever is left out of the set
 * handed to it is not filtered, it is destroyed. This call site left out the
 * SIZE CHILDREN of a ticked row: it asked `productionSlices(basis, order)` with
 * no `sizeWise` predicate, so a ticked row's children were never in the live set,
 * every size-level override matched nothing, and none of them was written.
 * Measured before this fix: 1 size figure typed in, 0 kept. The operator ticks
 * Size-wise, types XS/S/M, saves, and the figures are gone.
 *
 * PASSING THE TICK ALONE IS THE FIX THAT LOOKS RIGHT AND IS NOT. It does not
 * widen the set, it MOVES it — `productionSlices` REPLACES a ticked primary with
 * its children (`out.push(...kids)`, never both), so the parent's own figures are
 * dropped instead. That trades one casualty for the other, and the parent's
 * figures are the ones the client requires to survive: "THE ROW KEEPS ITS OWN
 * FIGURES EVEN WHEN TICKED" (screenshot 2465). Both sets, therefore — which is
 * exactly what the grid draws (`sliceGrid`, two calls, deliberately).
 *
 * Duplicates are free: `liveOverrides` keys the set through `sliceKey`, so an
 * unticked row appearing in both collapses to one entry.
 *
 * ## NULL MEANS UNKNOWN, AND UNKNOWN KEEPS EVERYTHING
 *
 * Every refusal path returns null rather than an empty array, and the caller
 * reads null as "do not filter". That is this file's existing argument at the
 * call site — *"the live set is UNKNOWN, not empty ... keeping them is the
 * recoverable direction"* — and it has to hold for the EXPANDED call too. A
 * union that treated a refused expansion as an empty contribution would silently
 * delete every size figure while reading exactly like this fix.
 *
 * ## THAT REFUSAL PATH HAS NO VECTOR, AND THIS IS WHY
 *
 * Stated rather than left to be assumed tested, because a guard nobody exercises
 * reads exactly like a guard nobody needs. The two refusal branches below are
 * implemented and commented; NOTHING ASSERTS THEM.
 *
 * The obstacle is structural, not laziness. A vector would have to call
 * `liveSlicesFor`, and this file carries `"use server"` — every export from such
 * a file must be an async server action, so a synchronous helper cannot be
 * exported for a script to import. That was CHECKED rather than assumed: every
 * `"use server"` file under lib/ exports async functions and nothing else, with
 * zero counter-examples. Exporting a sync helper from one to satisfy a test
 * would be the test dictating the architecture.
 *
 * Two ways to cover it later, both deliberately NOT taken during a release
 * freeze because each MOVES CODE rather than adding an assertion:
 *
 *   - move `liveSlicesFor` into `slice-consumption.ts`, where its siblings and
 *     their vectors already live — cleanest, and the one to prefer;
 *   - or a new plain module under `lib/orders/material-bom/` that both this file
 *     and a vector import.
 *
 * Until then the claim "a refused expanded set keeps every override" rests on
 * reading, not on running. The vector to write first is the one that would have
 * caught the bug: a refused expansion must keep 3 of 3, never 2 of 3.
 */
function liveSlicesFor(
  basis: RequirementBasis | null,
  order: OrderProductionInput | null,
  slices: MbaItemInput["slices"],
): SliceKey[] | null {
  if (!order || !basis) return null;
  const primary = productionSlices(basis, order);
  if (isRefusal(primary)) return null;
  const flags = sliceFlags(slices);
  const expanded = productionSlices(basis, order, undefined, (sl) => flags.sizeWise(sl));
  if (isRefusal(expanded)) return null;
  return [...primary, ...expanded];
}

function requirementRows(
  items: ItemRowWithId[],
  order: OrderProductionInput,
  packs: PackContext,
  processes: ReturnType<typeof normalizeProcesses>,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let sno = 0;

  /*
   * THE PROCESS ROWS, GROUPED BY MATERIAL — the loss chain each line carries.
   *
   * ## WHY THE SERVER HAS TO DO THIS AT ALL
   *
   * `required_qty` is what `bomCeilingForOrder` caps a purchase order against.
   * The screen shows the operator a Required Qty inflated by process loss
   * (0476); if this function stored the figure BEFORE loss, an operator reading
   * "31 Gross" and raising a PO for 31 would be refused by a ceiling of 30 —
   * with nothing on either screen to say why the two disagree. That is this
   * module's oldest failure shape and its own header names it: *"a screen that
   * resolved a pack the server did not would show a purchase figure that no
   * control ever enforced."* Same store, same reading, same answer.
   *
   * ## GROUPED BY `item_id`, WHICH IS THE PROCESS ROW'S OWN LINK
   *
   * A process names a MATERIAL, not a BOM line — `material_bom_amendment_
   * processes.item_id` — so two lines buying the same trim share its chain.
   * That is the grain the screen groups on and it is the grain here; picking a
   * different one would be the screen/server split all over again.
   *
   * A process with no material reaches nothing. It cannot be attributed, and
   * spreading its loss across every line would inflate materials nobody sends
   * anywhere.
   *
   * ## `prev_row_uid` IS NULL BECAUSE NOTHING WRITES IT
   *
   * The column exists and `compoundLossFactor` walks it, so a chain declared
   * later compounds in order and a FAN-OUT refuses rather than guessing a
   * branch. Today every row is a head, which the rule reads as one sequence —
   * `check-process-loss.mts` asserts exactly that ("a flat list is not
   * fan-out"), because reading several heads AS fan-out would refuse 100% of
   * real lines.
   */
  const lossByItem = new Map<string, ProcessLossRow[]>();
  for (const p of processes) {
    if (!p.item_id) continue;
    const chain = lossByItem.get(p.item_id) ?? [];
    chain.push({
      row_uid: p.row_uid ?? null,
      prev_row_uid: null,
      sno: chain.length + 1,
      loss_pct: p.loss_pct ?? null,
    });
    lossByItem.set(p.item_id, chain);
  }

  for (const line of items) {
    // A line with no material is scaffolding, not a requirement.
    if (!line.item_id) continue;

    /*
     * THE GRAIN IS THE SOURCE OF TRUTH (0455), the basis its fallback.
     *
     * A payload older than the column carries only `requirement_basis`, and
     * `axesOfBasis` is the one mapping between them — the same one 0455's
     * backfill used, so a row loaded from the database and a row arriving from
     * an old client resolve identically.
     */
    const basis = line.requirement_basis as RequirementBasis | null;
    const grain: Axis[] | null =
      (line.requirement_grain as Axis[] | null) ?? (basis ? axesOfBasis(basis) : null);
    /* THE LEGACY NAME FOR THIS GRAIN, or null where it has none. Eight of the
       nine producible grains have one; `{style_ref, colour, size, country}` is
       the client's #16 and does not, which is why 0456 made the column
       nullable rather than widening its CHECK. */
    const asBasis = grain ? basisForAxes(grain) : null;

    const common = {
      item_line_id: line.id,
      item_id: line.item_id,
      style_ref_no: line.style_ref_no,
      excess_pct: line.excess_pct ?? 0,
      consumption_uom_id: line.consumption_uom_id,
      uom_conversion_id: line.uom_conversion_id,
      purchase_uom_id: line.purchase_uom_id,
      // THE PROVENANCE, on every row of the line including the refusals: a
      // stored row must be re-derivable from its own columns (0418).
      requirement_grain: grain,
    };

    if (!grain) {
      out.push({
        ...common,
        sno: ++sno,
        /* NULL, not "order". `basis` became nullable in 0456, and claiming the
           whole-order grain on a line that has answered NOTHING is a lie in a
           provenance column — the row already says why in `refusal_reason`. */
        basis: null,
        combo: null,
        size_id: null,
        slice_label: "Whole order",
        basis_qty: 0,
        // The LINE's own figures. A refused row has no slice, so there is no
        // override to resolve against — and both columns are NOT NULL.
        no_of_items: line.no_of_items ?? 0,
        per_pieces: line.per_pieces ?? 0,
        required_qty: null,
        refusal_reason: "Choose how this material splits",
        purchase_qty: null,
      });
      continue;
    }

    const flags = sliceFlags(line.slices);
    /*
     * TWO PATHS, AND THE SPLIT IS ABOUT THE PER-ROW TICK RATHER THAN ABOUT AGE.
     *
     * A grain with a legacy name goes down `productionSlices` WITH the tick
     * predicate, because the 0449 tick is per ROW and can be MIXED — some rows
     * split into sizes and others not, which `check-bom-requirement.mts` asserts
     * ("a mixed tick splits only the row that asked"). An axis set is
     * all-or-nothing by construction and cannot express that, so routing every
     * line through the composer would silently drop a shipped feature.
     *
     * A grain with NO legacy name has never had per-row ticks — it was not
     * expressible before the set model — so there is nothing to lose, and
     * `slicesForAxes` composes it.
     */
    const slices = asBasis
      ? productionSlices(asBasis, order, undefined, (sl) => flags.sizeWise(sl))
      : slicesForAxes(grain, order);
    if (isRefusal(slices)) {
      // One row carrying the refusal, so the document states WHY rather than
      // simply having fewer rows than the operator expects.
      out.push({
        ...common,
        sno: ++sno,
        basis: asBasis,
        combo: null,
        size_id: null,
        slice_label: "—",
        basis_qty: 0,
        no_of_items: line.no_of_items ?? 0,
        per_pieces: line.per_pieces ?? 0,
        required_qty: null,
        refusal_reason: slices.refused,
        purchase_qty: null,
      });
      continue;
    }

    /*
     * THE COMBINATION SHEET'S SPLITS (0436), derived ONCE per line.
     *
     * The panels do not vary by slice — a front body is a front body on every
     * size — so re-deriving them inside the loop would be the same answer N
     * times and one more place for two derivations to drift apart.
     *
     * AN EMPTY ARRAY IS NOT A REFUSAL and `colourSplits` says so in as many
     * words: a line with no panels is the ORDINARY line and its own ratio
     * applies. That is 0436's opt-in half, and it is what keeps every line
     * written before it producing byte-identical rows.
     */
    const splits = colourSplits(line.item_color_id ?? null, line.components ?? []);
    if (isRefusal(splits)) {
      /* A BAD PANEL POISONS THE LINE rather than skipping a row. The panels SUM
         into one rate, so dropping a bad one yields a smaller rate that looks
         entirely reasonable — the partial-explosion failure `requirement.ts`
         opens its header with. `colourSplits` names the offending panel in its
         sentence, which is why the label is carried rather than re-worded. */
      out.push({
        ...common,
        sno: ++sno,
        basis: asBasis,
        combo: null,
        size_id: null,
        slice_label: "—",
        basis_qty: 0,
        no_of_items: line.no_of_items ?? 0,
        per_pieces: line.per_pieces ?? 0,
        required_qty: null,
        refusal_reason: splits.refused,
        purchase_qty: null,
      });
      continue;
    }

    /*
     * THE SAME RESOLUTION THE SCREEN MAKES — one function, two readers.
     *
     * This was a straight `packs.conversions.get(line.uom_conversion_id)`, and
     * the pack must still convert INTO the unit the line is consumed in (a cone
     * that holds metres against a line counted in pieces yields a number and a
     * category error). What changed on 2026-08-27 is that a line naming NO pack
     * now resolves one from its material and its two Uoms instead of giving up.
     *
     * IT HAS TO HAPPEN HERE AS WELL AS ON THE SCREEN. `purchase_qty` is STORED
     * from this line, and `bomCeilingForOrder` caps a purchase order against the
     * stored value — so a screen that resolved a pack the server did not would
     * show a purchase figure that no control ever enforced.
     */
    const { pack: conv, usable: packUsable } = resolveLinePack(
      {
        item_id: line.item_id ?? null,
        purchase_uom_id: line.purchase_uom_id ?? null,
        consumption_uom_id: line.consumption_uom_id ?? null,
        uom_conversion_id: line.uom_conversion_id ?? null,
      },
      packs.conversionList,
    );

    /* NORMALISED BY `toOverrides`, NOT BY A LITERAL HERE. That literal named
       four of the six fields and dropped `country_id` and `excess_pct` — both
       optional on `SliceOverride`, so `tsc` never said a word, and an override
       on a country-wise line silently stopped resolving. The rule now has one
       home and one set of vectors; see `toOverrides`. */
    const overrides = toOverrides(line.slices);

    /*
     * CROSSED BY THE LINE'S COMBINATION NAMES — the half that was missing.
     *
     * `sliceKey` has carried `combination` since 0463, so an override typed
     * against a garment part is identified partly BY that part. These rows came
     * straight from `productionSlices` and carried no combination at all, so
     * every one of them keyed as `""` and **no combination override ever
     * matched on the way to storage**.
     *
     * That is the shape of defect this module fears most, because the screen was
     * RIGHT: it crosses its own rows (`crossCombinations`, mba-master-screen),
     * so it resolved the overrides and displayed the operator's figure, while
     * the requirement written here carried another. Measured on a two-part,
     * two-colour line at 2/1 with TOP=3 and BOTTOM=1 typed on both colourways —
     * screen 2,000, honest 2,000, STORED 1,000 — and a purchase order is checked
     * against the stored one.
     *
     * ONE FUNCTION, TWO CALLERS. `crossCombinations` now lives beside `sliceKey`
     * in `slice-consumption.ts` and the screen calls the same one, so the two
     * agree by construction rather than by both being maintained. A line with no
     * names is returned unmultiplied with `combination: null`, which is the value
     * every pre-0463 row already coalesces to — so nothing already stored moves.
     */
    const slicesByCombination = crossCombinations(slices, combinationNames(line.slices));

    for (const slice of slicesByCombination) {
      /*
       * AN UNTICKED "CHOOSE" ROW IS OMITTED, NOT REFUSED (0449).
       *
       * The tempting alternative — store the row with a `refusal_reason` saying
       * it was excluded — would BREAK THE PURCHASE CEILING. `bomCeilingForOrder`
       * counts any refused row as `unanswered`, and `judgeLine` returns
       * `unchecked` the moment that is non-zero, so ONE excluded destination
       * would switch the whole control off. `required_qty = 0` is no better:
       * this engine's standing rule is that 0 reads as "none needed".
       *
       * The partial-explosion warning in `requirement.ts`'s header still stands
       * and is answered by VISIBILITY: an exclusion is deliberate and recorded on
       * the line, where an explosion gap is accidental. The screen states the
       * count so the smaller total is never silent.
       *
       * A ticked PARENT's size children inherit the parent's decision, because
       * the child slice carries the parent's combo/country and only adds a size —
       * so `chosen` is asked of the child's own key first and falls back to true.
       */
      if (!flags.chosen(slice)) continue;
      /*
       * THE SLICE'S OWN CONSUMPTION, WHERE THE OPERATOR TYPED ONE (0442).
       *
       * This read `line.no_of_items` / `line.per_pieces` raw, while the screen
       * composed the same figures through `consumptionFor` — so a line with a
       * typed override displayed one number and STORED another, and the stored
       * one is what a purchase order is checked against. `consumptionFor` was
       * written for this and had no caller outside the screen.
       *
       * PER FIELD, not per row: an operator who types only `no_of_items` against
       * XXL means "more buttons, same per-piece". That is the composition's own
       * rule and the reason it is a function rather than a `??`.
       */
      /* THREE LEVELS, RESOLVED PER FIELD — the size box, the row it sits under,
         then the line. `consumptionFor` returns the shape it takes, so composing
         it twice IS the chain. The screen resolves identically; two rules would
         be two answers, which is the defect fixed earlier today. */
      const parent = slice.size_id
        ? consumptionFor(line, overrides, {
            combo: slice.combo,
            size_id: null,
            country_id: slice.country_id ?? null,
          })
        : line;
      const use = consumptionFor(parent, overrides, slice);

      /*
       * ONE ROW PER (SLICE x TRIM COLOUR) — the grain 0454 widened
       * `uq_mba_req_slice` to hold.
       *
       * A line with no panels has ONE nameless split here and produces exactly
       * the row it always produced. A line whose Combination sheet names navy on
       * the body and red on the sleeves produces two, because those are two
       * things to buy. The panels themselves never reach a row: `colourSplits`
       * has already collapsed them onto colour, which is 0423's assertion and
       * 0436's header both, still standing.
       */
      const rowSplits: (ColourSplit | null)[] = splits.length ? splits : [null];

      for (const split of rowSplits) {
        /* THE PANEL RATE WHERE THERE ARE PANELS. How it composes with a slice
           override typed on the same line is a TRADE rule, not an arithmetic
           one, and it lives in `panelConsumption` rather than inline here — two
           opt-ins landed on this line independently and neither document says
           which wins. */
        const ratio = split
          ? panelConsumption(use, line, split)
          : { no_of_items: use.no_of_items, per_pieces: use.per_pieces };

        const calculated = requirementFor(
          {
            no_of_items: ratio.no_of_items,
            per_pieces: ratio.per_pieces,
            /* THE RESOLVED BUFFER (0450), not the line's — it is per attribute
               value now, and `consumptionFor` composes it per field beside the
               ratio. Falling back to `line.excess_pct` happens inside there.
               NOT per panel: a wastage buffer is a property of how the material
               is CUT, and 0436 gave the sheet a ratio and a colour, not a third
               figure. */
            excess_pct: use.excess_pct ?? 0,
            decimals: line.consumption_uom_id
              ? (packs.uomDecimals.get(line.consumption_uom_id) ?? null)
              : null,
          },
          slice,
        );

        /*
         * PROCESS LOSS ON TOP OF THE CALCULATED FIGURE (0476) — the same
         * composition the screen makes, from the same function.
         *
         * `Required Qty = Calculated Qty x (1 + loss%/100)`, compounding per
         * stage, then rounded by what the unit IS: a Gross ceils to a whole
         * unit, a Metre ceils to its declared decimals.
         *
         * WASTAGE AND LOSS ARE DIFFERENT BUFFERS AND BOTH APPLY. `calculated`
         * already carries the line's Excess % — cutting waste, ours — while
         * this is loss at a DYER or PRINTER on goods that have left the
         * building. Neither restates the other, which is why they multiply
         * rather than one replacing the other.
         *
         * A REFUSAL FROM EITHER SIDE REACHES `refusal_reason`. `requiredWith
         * ProcessLoss` passes a base refusal straight through, so the sentence
         * an operator reads is the first thing that actually went wrong — a
         * missing ratio stays "Enter how many are used per piece" rather than
         * being restated as a loss problem.
         */
        const value = requiredWithProcessLoss(
          calculated,
          lossByItem.get(line.item_id) ?? [],
          line.consumption_uom_id ? (packs.uomCodes.get(line.consumption_uom_id) ?? null) : null,
          line.consumption_uom_id
            ? (packs.uomDecimals.get(line.consumption_uom_id) ?? null)
            : null,
        );

        const refused = isRefusal(value);
        const qty = refused ? null : value;

        out.push({
          ...common,
          sno: ++sno,
          basis: asBasis,
          // The slice's own style wins: a line marked "every style" still
          // produces per-style rows when the order splits by colour.
          style_ref_no: slice.style_ref_no ?? line.style_ref_no,
          combo: slice.combo,
          size_id: slice.size_id,
          // 0444. NULL on every basis but country-wise, and NULL is a value
          // there — "every destination". In `uq_mba_req_slice`, so omitting it
          // here would let two destinations collide on an otherwise identical
          // key.
          country_id: slice.country_id ?? null,
          /*
           * THE TRIM COLOUR, and it is in `uq_mba_req_slice` since 0454.
           *
           * WHERE PANELS EXIST THEY ARE AUTHORITATIVE, and the slice's own
           * colour tick (0449) does not reach past them. The two answer
           * different questions — a panel says "the sleeve is stitched in red",
           * a slice says "the USA rows ship in black" — and letting the slice
           * silently re-colour a panel would make the Combination sheet lie
           * about what is being bought, which is the one thing it exists to
           * state. `colourSplits` has already resolved a blank panel to the
           * line's own colour, so `split.item_color_id` is never a half-answer.
           *
           * With no panels this is exactly what it was: the slice's tick, then
           * the line's, which is what every row meant before 0449.
           */
          item_color_id: split
            ? split.item_color_id
            : (flags.colour(slice) ?? line.item_color_id ?? null),
          slice_label: slice.label,
          basis_qty: slice.qty,
          // THE RESOLVED FIGURES, not the line's. 0418 stores the inputs beside
          // the answer as its provenance, so a row computed from an override —
          // or from a panel rate — has to record the figure it used, otherwise
          // the stored row cannot be re-derived from its own columns.
          no_of_items: ratio.no_of_items ?? 0,
          per_pieces: ratio.per_pieces ?? 0,
          required_qty: qty,
          refusal_reason: refused ? value.refused : null,
          purchase_qty:
            qty != null && packUsable && conv
              ? toPurchaseQty(
                  qty,
                  conv,
                  uomPrecision(
                    conv.alt_uom_id ? (packs.uomDecimals.get(conv.alt_uom_id) ?? null) : null,
                  ),
                )
              : null,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Replace every child grid wholesale for a given amendment id.
 *
 * `lib/orders/amendments/actions.ts` carries the standing warning that a table
 * added to the insert side but not the delete side doubles the grid on every
 * save. All three are deleted here, and the requirement rows are then rebuilt
 * from the items rather than from the form.
 *
 * ORDER MATTERS BOTH WAYS. Requirements are deleted FIRST because they hold an
 * FK to `material_bom_amendment_items` — deleting the items first cascades them
 * away mid-write — and inserted LAST because that FK needs the new line ids.
 */
async function writeChildren(
  s: Awaited<ReturnType<typeof createClient>>,
  amendmentId: string,
  data: MaterialBomAmendmentInput,
  order: OrderProductionInput | null,
): Promise<Result> {
  /*
   * A ROW THAT HAS ALREADY SENT MATERIAL OUT CANNOT BE DELETED BY A SAVE (0446).
   *
   * This function deletes and reinserts every process row, which is fine while a
   * row is only a plan. Once a Delivery Challan has been raised against one, the
   * row is the counterpart of a document that has physically left the building
   * under Rule 55 — and a stale form, or a removed row, would quietly orphan it.
   *
   * So the dispatched set is read FIRST and two rules applied:
   *   - a dispatched row missing from the payload REFUSES the save, naming its
   *     challan, rather than being silently dropped;
   *   - a dispatched row's quantities are taken from the CHALLAN, not the form.
   *     The challan is the legal document; the grid is a view of it.
   *
   * Reading before the delete is deliberate: after it there is nothing left to
   * compare against.
   */
  const { data: dispatched } = await s
    .from("dc_line_items")
    .select("mba_process_row_uid, sent_qty, returned_qty, delivery_challan:delivery_challans(code)")
    .eq("mba_amendment_id", amendmentId)
    .not("mba_process_row_uid", "is", null);

  const sentRows = new Map<
    string,
    { sent: number; returned: number; code: string | null }
  >();
  for (const r of (dispatched ?? []) as unknown as {
    mba_process_row_uid: string;
    sent_qty: number | null;
    returned_qty: number | null;
    delivery_challan: { code: string | null } | { code: string | null }[] | null;
  }[]) {
    const dc = Array.isArray(r.delivery_challan) ? r.delivery_challan[0] : r.delivery_challan;
    sentRows.set(r.mba_process_row_uid, {
      sent: Number(r.sent_qty ?? 0),
      returned: Number(r.returned_qty ?? 0),
      code: dc?.code ?? null,
    });
  }

  if (sentRows.size > 0) {
    const keeping = new Set(
      (data.processes ?? []).map((p) => p.row_uid).filter((v): v is string => !!v),
    );
    for (const [uid, dc] of sentRows) {
      if (!keeping.has(uid)) {
        return fail(
          `A material already sent out under challan ${dc.code ?? "(unnumbered)"} cannot be removed from this BOM. Cancel the challan first.`,
        );
      }
    }
  }

  for (const t of [
    "material_bom_amendment_requirements",
    "material_bom_amendment_items",
    "material_bom_amendment_processes",
  ]) {
    const { error } = await s.from(t).delete().eq("amendment_id", amendmentId);
    if (error) return fail(error.message);
  }

  const items = normalizeItems(data);
  let savedItems: ItemRowWithId[] = [];
  if (items.length) {
    const { data: inserted, error } = await s
      .from("material_bom_amendment_items")
      // `slices` and `components` ride on the row to survive the filter (see
      // `normalizeItems`) and are stripped here: both are CHILD tables, not
      // columns, and PostgREST refuses an unknown key.
      .insert(
        items.map(({ slices: _slices, components: _components, ...r }) => ({
          ...r,
          amendment_id: amendmentId,
        })),
      )
      .select("id, sno");
    if (error) return fail(error.message);
    // Match ids back by `sno`, which `normalizeItems` has just made unique and
    // dense. `.select()` does not promise insertion order.
    const bySno = new Map(
      ((inserted ?? []) as { id: string; sno: number }[]).map((r) => [r.sno, r.id]),
    );
    savedItems = items.map((r) => ({ ...r, id: bySno.get(r.sno) as string }));
    if (savedItems.some((r) => !r.id)) return fail("Could not read back the saved BOM lines");
  }

  const processes = normalizeProcesses(data).map((p) => {
    // THE CHALLAN WINS. A form that says 600 against a challan that says 1,000
    // is a form describing a dispatch that did not happen that way.
    const dc = p.row_uid ? sentRows.get(p.row_uid) : undefined;
    return dc ? { ...p, qty_out: dc.sent, qty_in: dc.returned } : p;
  });
  if (processes.length) {
    const { error } = await s
      .from("material_bom_amendment_processes")
      .insert(processes.map((r) => ({ ...r, amendment_id: amendmentId })));
    if (error) return fail(error.message);
  }

  /*
   * THE COMBINATION SHEET'S PANELS (0436), written at last.
   *
   * Keyed through `savedItems` for the reason the overrides below are:
   * `item_line_id` is a uuid Postgres assigns during the line insert above, and
   * matching by insertion order would pair one material's construction with
   * another's — `.select()` makes no ordering promise.
   *
   * NO DELETE PASS, and that is not an omission. `writeChildren` has already
   * deleted every `material_bom_amendment_items` row for this amendment and the
   * child carries `on delete cascade`, so the old panels went with their
   * parents. The standing warning on this file is about the opposite mistake — a
   * table on the insert side and not the delete side doubles on every save.
   *
   * A ROW WITH NO PANEL IS NOT A ROW. `component_id` is NOT NULL in the column
   * and 0436 asserts it: a panel row naming no panel IS the line's own ratio,
   * which already has a home on the line itself. The figures are NOT filtered
   * beside it — `mbaItemComponentInput` requires both, so a half-typed panel
   * fails validation with a sentence rather than being silently dropped here.
   *
   * THIS LITERAL IS THE WHOLE WRITE. The comments on `component_id` and
   * `round_to` in `normalizeItems` record what that costs when a column is left
   * out of one: no type error, no null written over a value — the value simply
   * never leaves the browser.
   */
  if (savedItems.length) {
    const componentRows = savedItems.flatMap((line) =>
      (line.components ?? [])
        .filter((c) => !!c.component_id)
        .map((c, j) => ({
          item_line_id: line.id,
          sno: j + 1,
          component_id: c.component_id,
          // NULL is "the line's own Item Color", never "no colour" — the same
          // inherit-vs-zero contract the overrides carry.
          item_color_id: c.item_color_id ?? null,
          no_of_items: c.no_of_items,
          per_pieces: c.per_pieces,
        })),
    );
    if (componentRows.length) {
      const { error } = await s
        .from("material_bom_amendment_item_components")
        .insert(componentRows);
      if (error) return fail(error.message);
    }
  }

  /*
   * THE PER-SLICE OVERRIDES (0442).
   *
   * Written AFTER the lines and keyed through the same `bySno` map, because
   * `item_line_id` is a uuid Postgres assigns during this very insert — the
   * mechanism `requirementRows` already uses below. Matched by `sno`, never by
   * insertion order: `.select()` makes no ordering promise, and a mis-pair puts
   * one material's size consumption on another's.
   *
   * NO DELETE PASS. `writeChildren` has already deleted every
   * `material_bom_amendment_items` row for this amendment and the child carries
   * `on delete cascade`, so the old overrides went with their parents. The
   * standing warning on this file is about the opposite mistake — a table on the
   * insert side and not the delete side doubles on every save.
   *
   * A ROW WITH NOTHING TYPED IS NOT STORED. Both figures null IS "inherit", and
   * an absent row already says that; writing it would fill the table with rows
   * that mean nothing and make the unique index work for a living.
   *
   * READ OFF THE PARSED INPUT, not off `normalizeItems`' output — that literal
   * names only the PARENT's columns and strips everything else, which is correct
   * for the line insert and is why the children are gathered here instead.
   */
  if (savedItems.length) {
    const sliceRows = savedItems.flatMap((line) => {
      /*
       * ORPHANS ARE DROPPED ON THE WAY OUT (client 2026-08-21: the grid follows
       * the order exactly). A size removed from Quantities takes its override
       * with it rather than lingering to be reconciled later. `liveOverrides`
       * was written for this and, like `consumptionFor` above, had no caller.
       *
       * REFUSE TO FILTER WHEN THE ORDER CANNOT BE READ. `order` is null when the
       * amendment names no garment order, and `productionSlices` refuses for a
       * dozen reasons that have nothing to do with the operator's typing. In
       * either case the live set is UNKNOWN, not empty — filtering against it
       * would delete every override the operator has entered because a
       * DIFFERENT tab is incomplete. Keeping them is the recoverable direction.
       */
      const basis = line.requirement_basis as RequirementBasis | null;
      /* THE UNION OF THE PRIMARY AND EXPANDED ROWS — see `liveSlicesFor`. This
         was a single tickless call, and every size-level override the operator
         typed was dropped at save because of it. */
      const live = liveSlicesFor(basis, order, line.slices);
      /* "NOTHING TO SAY" IS NO LONGER "BOTH FIGURES NULL" (0449). A row now also
         carries the Choose and Size-wise ticks and three descriptive fields, and
         `chosen` defaults TRUE — so an unticked row is emphatically not empty and
         dropping it here would silently re-include the destination. */
      const typed = (line.slices ?? [])
        .filter(
          (sl) =>
            sl.no_of_items != null ||
            sl.per_pieces != null ||
            sl.excess_pct != null ||
            sl.moq != null ||
            sl.round_to != null ||
            sl.chosen === false ||
            sl.size_wise === true ||
            sl.item_color_id != null ||
            !!sl.specification ||
            !!sl.size_spec ||
            /* A COMBINATION ROW IS NOT EMPTY WHEN IT IS ONLY A NAME (0463).
               This filter is what keeps the slice table a SPARSE store of things
               the operator actually typed, and every other clause tests a figure
               or a flag — so a freshly typed TOP, which has nothing but a name
               until the listing is filled in, was dropped here and the name
               never reached the database. The popup would have appeared to work
               and forgotten everything on save. */
            !!(sl.combination ?? "").trim(),
        )
        .map((sl) => ({
          combo: sl.combo ?? null,
          size_id: sl.size_id ?? null,
          country_id: sl.country_id ?? null,
          combination: sl.combination ?? null,
          style_ref_no: sl.style_ref_no ?? null,
          chosen: sl.chosen ?? true,
          size_wise: sl.size_wise ?? false,
          item_color_id: sl.item_color_id ?? null,
          specification: sl.specification ?? null,
          size_spec: sl.size_spec ?? null,
          excess_pct: sl.excess_pct ?? null,
          moq: sl.moq ?? null,
          round_to: sl.round_to ?? null,
          no_of_items: sl.no_of_items ?? null,
          per_pieces: sl.per_pieces ?? null,
        }));
      /* `liveSlicesFor` has already resolved every refusal to null, and null is
         "unknown" rather than "empty" — so this reads as keep-everything, which
         is the recoverable direction the block comment above argues for. */
      const kept = live ? liveOverrides(typed, live) : typed;
      /*
       * EVERY COLUMN THE ROW HAS, and this literal is the whole write.
       *
       * It named FOUR of eleven until 2026-08-23 — `chosen`, `size_wise`,
       * `item_color_id`, `specification`, `size_spec`, `excess_pct` and
       * `country_id` were all gathered by the filter above, USED to decide the
       * row was worth keeping, and then dropped one line later. So everything
       * 0449 and 0450 added round-tripped as a blank: an operator unticked a
       * destination, saved, reopened the line and found it ticked again.
       *
       * Worse than a value lost, because the FILTER reads them. A row kept
       * solely because `chosen === false` was written with nothing on it but a
       * combo and a size — an empty override row that then occupied its slot in
       * `uq_mba_slice_line_combo_size`.
       *
       * `moq` and `round_to` are absent DELIBERATELY: 0452 dropped both columns
       * (a minimum belongs to the material, not to one destination of it), and
       * naming a dropped column here would fail the whole insert. They survive
       * in `mbaItemSliceInput` and in `MbaItemSlice` as the withdrawal pattern
       * this file records for `alternate_uom_id` — carried so a stored value is
       * not destroyed, never written.
       *
       * The comments on `component_id` and `round_to` in `normalizeItems` say
       * what this shape costs when it is wrong: no type error, no null written
       * over a value, the value simply never leaves the browser.
       */
      return kept.map((sl, j) => ({
        item_line_id: line.id,
        sno: j + 1,
        combo: sl.combo ?? null,
        size_id: sl.size_id ?? null,
        country_id: sl.country_id ?? null,
        // Legacy's Combination (0463): the garment part typed in the popup. Part
        // of `uq_mba_slice_line_combo_size`, so omitting it here would not merely
        // lose the name — every combination row on a line would collide on the
        // key and the insert would fail outright.
        combination: sl.combination ?? null,
        // Which style (0464). Part of `uq_mba_slice_line_combo_size`, so omitting
        // it would collapse every style's row onto one key and fail the insert.
        style_ref_no: sl.style_ref_no ?? null,
        // Legacy's two ticks (0449). `chosen` DEFAULTS TRUE, so writing it is
        // what makes an unticked row survive a save at all.
        chosen: sl.chosen ?? true,
        size_wise: sl.size_wise ?? false,
        item_color_id: sl.item_color_id ?? null,
        specification: sl.specification ?? null,
        size_spec: sl.size_spec ?? null,
        // NULL means "inherit the line's" for all three — never 0, never 1.
        excess_pct: sl.excess_pct ?? null,
        no_of_items: sl.no_of_items ?? null,
        per_pieces: sl.per_pieces ?? null,
      }));
    });
    if (sliceRows.length) {
      const { error } = await s
        .from("material_bom_amendment_item_slices")
        .insert(sliceRows);
      if (error) return fail(error.message);
    }
  }

  if (order && savedItems.length) {
    const packs = await packContext(s);
    /* THE ROWS THAT WERE ACTUALLY INSERTED, not `data.processes` and not a
       second `normalizeProcesses(data)` — a row the filter dropped as empty is
       a row with no loss to contribute, and a requirement computed from a
       process the database has not got is the screen/server split this function
       exists to close, arriving from the process side. */
    const rows = requirementRows(savedItems, order, packs, processes);
    if (rows.length) {
      const { error } = await s
        .from("material_bom_amendment_requirements")
        .insert(rows.map((r) => ({ ...r, amendment_id: amendmentId })));
      if (error) return fail(error.message);
    }
  }

  return { ok: true };
}

/** Strip child arrays so only header columns hit material_bom_amendments. */
function headerOnly(data: MaterialBomAmendmentInput, order: OrderProductionInput | null) {
  const total = order ? totalProductionOf(order) : null;
  return {
    garment_order_id: data.garment_order_id ?? null,
    customer_id: data.customer_id ?? null,
    amend_date: data.amend_date,
    is_draft: data.is_draft,
    remarks: clean(data.remarks),
    // Stamped in the same write as the rows they describe. A hash written at a
    // different moment from the requirement it fingerprints is a staleness check
    // that can be wrong in both directions.
    computed_at: order ? new Date().toISOString() : null,
    computed_for_qty: total != null && !isRefusal(total) ? total : null,
    computed_basis_hash: order ? basisFingerprint(order) : null,
  };
}

/** Next per-order amendment number (A. No). */
async function nextAmendmentNo(
  s: Awaited<ReturnType<typeof createClient>>,
  garmentOrderId: string | null,
): Promise<number> {
  if (!garmentOrderId) return 1;
  const { data } = await s
    .from("material_bom_amendments")
    .select("amendment_no")
    .eq("garment_order_id", garmentOrderId)
    .order("amendment_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  return ((data?.amendment_no as number | undefined) ?? 0) + 1;
}

export async function createMaterialBomAmendment(
  data: MaterialBomAmendmentInput,
): Promise<Result> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = materialBomAmendmentInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");

  const s = await createClient();
  const order = p.data.garment_order_id
    ? await getOrderProduction(p.data.garment_order_id)
    : null;

  const amendment_no = await nextAmendmentNo(s, p.data.garment_order_id ?? null);
  const { data: created, error } = await s
    .from("material_bom_amendments")
    .insert({ ...headerOnly(p.data, order), amendment_no })
    .select("id")
    .single();
  if (error || !created) return fail(error?.message ?? "Failed to create the material BOM");

  const childRes = await writeChildren(s, created.id, p.data, order);
  if (!childRes.ok) return childRes;

  await writeAudit({
    action: "material_bom_amendment.created",
    entityType: "material_bom_amendment",
    entityId: created.id,
  });
  rev();
  return { ok: true, id: created.id };
}

export async function updateMaterialBomAmendment(
  id: string,
  data: MaterialBomAmendmentInput,
): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("Forbidden");
  const p = materialBomAmendmentInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");

  const s = await createClient();
  const order = p.data.garment_order_id
    ? await getOrderProduction(p.data.garment_order_id)
    : null;

  const { error } = await s
    .from("material_bom_amendments")
    .update(headerOnly(p.data, order))
    .eq("id", id);
  if (error) return fail(error.message);

  const childRes = await writeChildren(s, id, p.data, order);
  if (!childRes.ok) return childRes;

  await writeAudit({
    action: "material_bom_amendment.updated",
    entityType: "material_bom_amendment",
    entityId: id,
  });
  rev();
  return { ok: true, id };
}

export async function deleteMaterialBomAmendment(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("material_bom_amendments").delete().eq("id", id); // children cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reading one order's production, for the editor
// ---------------------------------------------------------------------------

export type OrderProductionResult =
  | { ok: true; order: OrderProductionInput }
  | { ok: false; error: string };

/**
 * The picked order's Approval Qty, Combos and Assort rows, so the Requirement
 * tab can recalculate as the operator types.
 *
 * One round trip per ORDER, not per keystroke: the line changes while the
 * operator works, the order's quantities do not. Shipping every order's
 * production input with the form data was the alternative and grows with the
 * order book.
 */
export async function loadOrderProduction(
  garmentOrderId: string,
): Promise<OrderProductionResult> {
  if (!(await can("orders", "view"))) return { ok: false, error: "Forbidden" };
  if (!garmentOrderId) return { ok: false, error: "No order selected" };
  try {
    const order = await getOrderProduction(garmentOrderId);
    if (!order) return { ok: false, error: "That order no longer exists" };
    return { ok: true, order };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read the order" };
  }
}

// ---------------------------------------------------------------------------
// Copy from another order
// ---------------------------------------------------------------------------

export type CopyResult = { ok: true; payload: BomCopyPayload } | { ok: false; error: string };

/**
 * The item and process lines of another order's BOM, shaped for this form.
 *
 * TWO THINGS IT DELIBERATELY DOES NOT CARRY.
 *
 * **Quantities.** Not the requirement rows, not `computed_for_qty` — nothing
 * derived. They recompute against THIS order's production target on save, which
 * is the entire reason copying is safe: what is copied is the RECIPE (which
 * materials, how many per garment, how they split), and the recipe is genuinely
 * order-independent.
 *
 * **A vendor from a different customer.** `customer_nominated_vendors` is a
 * CUSTOMER's list of who may supply them, so carrying a nomination across
 * customers names a vendor this customer never approved — precisely what
 * `nominatedVendorOptions()` exists to prevent, arriving by a side door that
 * never opens a picker. The sheet is told, rather than leaving it to be noticed
 * on the first purchase order.
 *
 * `required_by` and `style_ref_no` are dropped for the same reason quantities
 * are: they are a date and a style in the SOURCE order's world.
 */
export async function copyMaterialBomFrom(
  sourceBomId: string,
  targetCustomerId: string | null,
): Promise<CopyResult> {
  if (!(await can("orders", "view"))) return { ok: false, error: "Forbidden" };
  if (!sourceBomId) return { ok: false, error: "No source chosen" };

  const s = await createClient();
  const { data, error } = await s
    .from("material_bom_amendments")
    .select(
      "id, customer_id, garment_order:garment_order_amendments(customer_id), " +
        "items:material_bom_amendment_items(*), " +
        "processes:material_bom_amendment_processes(*)",
    )
    .eq("id", sourceBomId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "That material BOM no longer exists" };

  const row = data as unknown as {
    customer_id: string | null;
    garment_order: { customer_id: string | null } | null;
    items: Record<string, unknown>[] | null;
    processes: Record<string, unknown>[] | null;
  };

  const sourceCustomer = row.garment_order?.customer_id ?? row.customer_id ?? null;
  const sameCustomer = !!targetCustomerId && sourceCustomer === targetCustomerId;

  const sorted = [...(row.items ?? [])].sort(
    (a, b) => ((a.sno as number) ?? 0) - ((b.sno as number) ?? 0),
  );

  const items: Omit<MbaItemInput, "sno">[] = sorted.map((c) => ({
    category_id: (c.category_id as string) ?? null,
    type: (c.type as string) ?? null,
    item_id: (c.item_id as string) ?? null,
    attribute_id: (c.attribute_id as string) ?? null,
    // The trim's identity IS the recipe — a copied Main Label line is the same
    // woven 50mm black label. Only order-specific values are dropped.
    item_color_id: (c.item_color_id as string) ?? null,
    specification: (c.specification as string) ?? null,
    size: (c.size as string) ?? null,
    requirement_basis: (c.requirement_basis as RequirementBasis) ?? null,
    /* THE GRAIN TRAVELS WITH THE RECIPE (0455), like the basis beside it: how a
       trim splits is a property of the material. Derived from the basis where a
       source row predates the column, never defaulted to `[]` — that would copy
       a line in as "one bulk row for the order". */
    requirement_grain:
      (c.requirement_grain as Axis[] | null) ??
      (c.requirement_basis ? axesOfBasis(c.requirement_basis as RequirementBasis) : null),
    style_ref_no: null,
    // The PANEL goes with the style ref, and for the same reason (0423): a
    // component belongs to a style, the source order's styles are not this
    // order's, and the screen narrows the cell to the style the line names.
    // Carrying it would offer a sleeve this garment may not have.
    component_id: null,
    /* DEFAULTED, NOT CARRIED AS NULL. This function hands its payload to the
       FORM, not to the database, so a source row written before the column had
       a default would open the copied line on blank — while `blankItem` opens a
       brand-new line on "Local". Two ways to add a line, two different starting
       values, and no control on the screen to reconcile them.
       `normalizeItems` would fix it on save either way; this is what makes the
       line honest in front of the operator in the meantime. */
    supply_type: (c.supply_type as string) ?? DEFAULT_SUPPLY_TYPE,
    vendor_id: sameCustomer ? ((c.vendor_id as string) ?? null) : null,
    purchase_uom_id: (c.purchase_uom_id as string) ?? null,
    consumption_uom_id: (c.consumption_uom_id as string) ?? null,
    alternate_uom_id: (c.alternate_uom_id as string) ?? null,
    uom_conversion_id: (c.uom_conversion_id as string) ?? null,
    combination: (c.combination as string) ?? null,
    // THE PANELS CANNOT TRAVEL, for the same reason `component_id` and
    // `style_ref_no` below do not: a component belongs to a STYLE, and a source
    // order's styles are not this one's (0436). Copying them would point every
    // panel row at a style the target order has never heard of.
    // THE OVERRIDES CANNOT TRAVEL either, and for the same reason the panels
    // cannot: a slice names a COLOUR and a SIZE of this order, and a source
    // order's are not this one's (0442).
    slices: [],
    components: [],
    /* TRAVELS WITH THE RECIPE (0466), like `round_to` below and unlike the
       panels above. Whether a trim goes out to be dyed is a property of the
       MATERIAL and the way it is made up — a button that needs dyeing needs it
       whichever order buys it — not of the source order's styles or colours.
       The process ROWS come across too (see `processes` below), so a copy that
       dropped this would arrive with the plan intact and the line un-ticked,
       reading as though nobody had decided to send it. */
    send_out: (c.send_out as boolean) ?? false,
    /* TRAVELS WITH THE RECIPE (0474), like `send_out` above and `round_to`
       below. Who supplies a trim free of charge is a property of the MATERIAL
       and the trading relationship — a customer who nominates and pays for
       their own main labels does so on every order they place — not of the
       source order's styles, colours or quantities, which is what the panels
       and slices above cannot carry across.

       A copy that dropped it would arrive needing a purchase order for a trim
       nobody buys, which is the exact state 0474 exists to end; the operator
       would meet it as "this line will not receive" long after the copy. */
    is_foc: (c.is_foc as boolean) ?? false,
    moq: numOrNull(c.moq),
    // TRAVELS WITH THE RECIPE (0437). A rounding step is a property of how this
    // material is BOUGHT — a gross of buttons is a gross whichever order needs
    // them — so it belongs with `moq` and the ratio rather than with the
    // quantities, which recompute. This literal is the second place a new column
    // goes missing without a type error; the first is `normalizeItems`.
    round_to: numOrNull(c.round_to),
    no_of_items: numOrNull(c.no_of_items),
    per_pieces: numOrNull(c.per_pieces),
    excess_pct: numOrNull(c.excess_pct) ?? 0,
    required_by: null,
  }));

  const processes = [...(row.processes ?? [])]
    .sort((a, b) => ((a.sno as number) ?? 0) - ((b.sno as number) ?? 0))
    .map((p) => ({
      item_id: (p.item_id as string) ?? null,
      process_id: (p.process_id as string) ?? null,
      vendor_id: sameCustomer ? ((p.vendor_id as string) ?? null) : null,
      // Quantities sent and received belong to the source order's actual
      // movements. A copy is a plan, so it starts at 'planned' with nothing out.
      qty_out: null,
      qty_in: null,
      status: "planned" as const,
      /* LEGACY'S FIVE COME ACROSS (0465), unlike the quantities above, and the
         difference is what a copy IS. Stage, For, Descriptions, Loss % and Notes
         describe the processing PLAN — how this trim gets dyed — which is
         precisely the thing being copied. Quantities and status describe the
         source order's actual movements, which are not. */
      stage: (p.stage as string) ?? null,
      for_scope: (p.for_scope as string) ?? null,
      description: (p.description as string) ?? null,
      loss_pct: (p.loss_pct as number) ?? null,
      notes: (p.notes as string) ?? null,
      /* A FRESH ANCHOR, NEVER THE SOURCE'S (0446). Carrying it across would
         point this new order's row at a Delivery Challan raised for a DIFFERENT
         order — and the partial unique index would then refuse the copy's own
         challan, because that anchor is already spoken for. A copy is a plan; it
         has sent nothing anywhere. */
      row_uid: crypto.randomUUID(),
    }));

  const vendorsDropped =
    !sameCustomer &&
    ((row.items ?? []).some((c) => !!c.vendor_id) ||
      (row.processes ?? []).some((p) => !!p.vendor_id));

  return { ok: true, payload: { items, processes, vendorsDropped } };
}
