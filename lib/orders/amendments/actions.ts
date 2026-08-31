"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  amendmentInput,
  mergeTaCompletions,
  styleFileMessage,
  stylesMissingFiles,
  taRowsToWrite,
  type AmendmentInput,
  type SavedTaRow,
} from "./types";
import { normalizeFileRows } from "./file-rows";
import {
  assortBalanceMessage,
  crossTabPoQtyMessage,
  totalQuantityPoQty,
} from "./qty-balance";
import {
  seedAmendmentFromOrder,
  styleKey,
  type SeededAmendmentChildren,
} from "./order-seed";
import { componentProblems, toleranceStated } from "./combo-rules";
/* The Style master's rules, read by the SAVE as well as by the screen — the
   "ONE DECLARATION, THREE ENFORCERS" that file's header describes. A
   `lib/data-io` import reaches this action and not the screen, so a rule the
   screen alone knew would be a rule an import could walk past. */
import { componentRowStarted, impliedCoordinateId } from "@/lib/orders/styles/rules";
/* The T&A ladder (0481). THE SAME FUNCTION THE SCREEN RENDERS FROM — client-safe
   on purpose, the `bom-ceiling.ts` split this repo already uses. `target_date`
   is a stored column, so the screen and this action resolving different ladders
   would be a date no control enforces: BOTH HALVES OR NEITHER, the rule
   `purchase_qty` already follows. */
import { orderTaLadder, isRefusal } from "@/lib/orders/ta/order-ladder";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): Result {
  return { ok: false, error: msg };
}
function rev(): void {
  revalidatePath("/orders/amendments");
  revalidatePath("/orders/all");
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

// ---------- child normalizers (drop fully-empty rows + renumber sno) ----------

// ---- Phase 2 (0128) child normalizers ----

  /**
   * NO `season` AND NO `style_year` ON THE LINE, and this is a decision rather
   * than an omission (0462).
   *
   * Both were added by 0461 and dropped unused, because the screen already
   * carries two EXPLICIT client instructions against them:
   *
   *   * Season, 2026-08-11 — "They stay in the header ... they belong here and
   *     NOT ON THE STYLE ROWS, where they have never been." It is also the
   *     second facet narrowing the Style picker, a job it only has at order
   *     level.
   *   * Year, 2026-08-14, withdrawn from the order entirely — "the year is
   *     already defined on the linked Style Master, so re-typing it on the
   *     order was a second place to state one fact."
   *
   * So "the whole Style entry on the line" is FIVE fields, not seven. Read
   * 0462 before adding either back.
   */
function normalizeStyles(data: AmendmentInput) {
  return data.styles
    .map((r) => ({
      style_ref_no: clean(r.style_ref_no),
      style_id: r.style_id,
      // The Style master's header fields, merged onto the line (0461).
      approved_sample_id: r.approved_sample_id,
      article_no: clean(r.article_no),
      style_category: clean(r.style_category),
      style_category_id: r.style_category_id,
      style_description: clean(r.style_description),
      order_unit_id: r.order_unit_id,
      plan_unit_id: r.plan_unit_id,
      /**
       * ORDER UNIT AND PACKS — DECLARED EVERYWHERE AND WRITTEN NOWHERE until
       * 2026-08-29, and this is the shape AGENTS.md keeps recording: the column
       * exists (0467 · 0471), the Zod input accepts it, `order-seed.ts` reads it
       * back, the screen has a control for it — and this map, the one place that
       * puts a value in the INSERT, never listed either. Every half looked
       * correct on its own, so nothing failed; the value simply never arrived.
       *
       * MEASURED, NOT REASONED. `garment_order_amendment_styles` holds 6 style
       * rows and 0 of them carry a `unit_kind` or a `packs_ordered`. That is
       * 100% of the orders ever entered, which is what tells you this is a
       * missing write rather than an operator who has not used the field.
       *
       * It matters twice over. `unit_kind` is what caps the Coordinates grid,
       * seeds PCS coordinates and locks the Components grid's Coordinate cell —
       * all of which worked in the browser and reset on the next load, because
       * `unitTextOf`'s FALLBACK re-derived a kind from the coordinate count and
       * quietly stood in for the stored answer. And `packs_ordered` is the
       * buyer's box count on a set pack, from which `po_qty` is derived; losing
       * it leaves the derived piece count with nothing to show its working.
       */
      unit_kind: r.unit_kind,
      packs_ordered: r.packs_ordered,
      po_qty: Number(r.po_qty) || 0,
      description: clean(r.description),
    }))
    /* THE FOUR NEW FIELDS ARE IN THE KEEP TEST TOO (0461), and leaving them out
       is the quiet way this breaks: a line an operator started by answering
       Season or Approved Sample and nothing else would be judged blank and
       dropped, taking any sizes, coordinates and components filed under it with
       it (those normalizers read the styles this one returns). A row is blank
       only when it answers NOTHING. */
    .filter(
      (r) =>
        r.style_ref_no ||
        r.style_id ||
        r.approved_sample_id ||
        r.article_no ||
        r.style_category_id ||
        r.order_unit_id ||
        r.plan_unit_id ||
        /* AND THE TWO THAT JUST JOINED THE MAP (2026-08-29). The note above is
           explicit that leaving a stored field out of this test is "the quiet
           way this breaks" — a line an operator started by answering only Order
           Unit would be judged blank and dropped, taking its coordinates and
           components with it. Adding a column to the map and not to the test is
           exactly the half-wiring that lost these two in the first place. */
        r.unit_kind ||
        r.packs_ordered ||
        r.po_qty ||
        r.description,
    )
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

/**
 * Style(s) ▸ the per-style sizes (0407).
 *
 * THE ONLY NORMALIZER THAT LOOKS AT ANOTHER GRID, and it has to. A size row is
 * bound to its style by TEXT (`style_ref_no`), so nothing in the database can
 * refuse a size whose style has just been deleted — `normalizeStyles` runs in
 * this same pass and both lists are written together. Without the guard,
 * removing a style line would leave its sizes behind as rows that belong to a
 * style the order no longer names: invisible on screen, and counted by anything
 * that later sums sizes per order.
 *
 * It reads the NORMALIZED styles, not `data.styles`, so a style row that was
 * itself dropped for being blank takes its sizes with it.
 *
 * `styleKey` is `order-seed.ts`'s — trim + upper-case — because that is how
 * every other reader of this key compares it, and rows saved before the
 * CAPITALS rule are not upper-cased in the database.
 *
 * DE-DUPLICATED PER STYLE, not per amendment: two different styles on one PO
 * both offering size M is normal, and the unique index is
 * (amendment_id, style_ref_no, size_id) for that reason.
 *
 * `sno` RENUMBERS PER STYLE, so each style's list reads 1..n on its own — the
 * S No the legacy sub-grid shows is the size's position within its line, not
 * within the order.
 */
function normalizeStyleSizes(
  data: AmendmentInput,
  styles: ReturnType<typeof normalizeStyles>,
) {
  const live = new Set(styles.map((r) => styleKey(r.style_ref_no)).filter(Boolean));
  const seen = new Set<string>();
  const perStyle = new Map<string, number>();
  return data.style_sizes
    .map((r) => ({ style_ref_no: clean(r.style_ref_no), size_id: r.size_id }))
    // A row with no size is the blank the operator is still standing in.
    .filter((r) => r.size_id)
    .filter((r) => live.has(styleKey(r.style_ref_no)))
    .filter((r) => {
      const k = JSON.stringify([styleKey(r.style_ref_no), r.size_id]);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r) => {
      const k = styleKey(r.style_ref_no);
      const n = (perStyle.get(k) ?? 0) + 1;
      perStyle.set(k, n);
      return { ...r, sno: n };
    });
}

/**
 * The per-style Coordinate list (0461) — what a component is a part of.
 *
 * The same four passes as `normalizeStyleSizes`, and the simplest of the three
 * because a coordinate carries nothing but itself:
 *
 * - **Drop the blank**, which is the row the seeded grid opened with.
 * - **Drop the orphans**, judged against the very styles being inserted in this
 *   pass — not against what is in the database, which this save replaces.
 * - **De-duplicate on (style, coordinate)**, which is `uq_goa_style_coords_
 *   coordinate` column for column. Listing PIECES twice under one style says
 *   nothing the first row did not.
 * - **Renumber `sno` per style**, so each line's list reads 1..n on its own.
 *
 * NO CAP HERE. `coordinateLimit` (Piece = 1, Set = 2..4) is enforced on the
 * grid's "+ Add", where it can be explained. Refusing at save time would fail
 * the whole document with nothing on screen to say which line was over.
 */
function normalizeStyleCoordinates(
  data: AmendmentInput,
  styles: ReturnType<typeof normalizeStyles>,
) {
  const live = new Set(styles.map((r) => styleKey(r.style_ref_no)).filter(Boolean));
  const seen = new Set<string>();
  const perStyle = new Map<string, number>();
  return data.style_coordinates
    .map((r) => ({
      style_ref_no: clean(r.style_ref_no),
      coordinate_id: r.coordinate_id,
    }))
    .filter((r) => r.coordinate_id)
    .filter((r) => live.has(styleKey(r.style_ref_no)))
    .filter((r) => {
      const k = JSON.stringify([styleKey(r.style_ref_no), r.coordinate_id]);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r) => {
      const k = styleKey(r.style_ref_no);
      const n = (perStyle.get(k) ?? 0) + 1;
      perStyle.set(k, n);
      return { ...r, sno: n };
    });
}

/**
 * The retail SET pack's members (0467) — the fifth style-keyed child, and the
 * SAME FOUR PASSES as `normalizeStyleCoordinates` above, in the same order,
 * because it is the same question asked of a different child.
 *
 * THE DUPLICATE KEY CARRIES `combo`, AND THAT IS THE WHOLE POINT. The
 * coordinates normalizer de-duplicates on (style, coordinate) because a style
 * lists each garment once. A PACK legitimately holds one coordinate several
 * times over in several colours — a 3-pack of bodysuits is the client's own
 * example — so de-duplicating on the coordinate alone would silently keep the
 * first colour and drop the rest, leaving a 3-pack that explodes to one piece.
 * The unique index in 0467 carries `combo` for the same reason; the two must be
 * edited together or the form and the database disagree about what a duplicate
 * is.
 *
 * `qty_per_pack` is NOT part of the "is this row blank" test: a member naming a
 * coordinate is an answer, and a blank quantity is a half-filled row the
 * operator can see and finish. It IS defaulted to 1 by the schema, because the
 * ordinary set holds one of each.
 */
function normalizePackComponents(
  data: AmendmentInput,
  styles: ReturnType<typeof normalizeStyles>,
) {
  const live = new Set(styles.map((r) => styleKey(r.style_ref_no)).filter(Boolean));
  const seen = new Set<string>();
  const perStyle = new Map<string, number>();
  return data.pack_components
    .map((r) => ({
      style_ref_no: clean(r.style_ref_no),
      coordinate_id: r.coordinate_id,
      combo: clean(r.combo),
      qty_per_pack: r.qty_per_pack,
    }))
    .filter((r) => r.coordinate_id)
    .filter((r) => live.has(styleKey(r.style_ref_no)))
    .filter((r) => {
      const k = JSON.stringify([
        styleKey(r.style_ref_no),
        r.coordinate_id,
        (r.combo ?? "").trim().toUpperCase(),
      ]);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r) => {
      const k = styleKey(r.style_ref_no);
      const n = (perStyle.get(k) ?? 0) + 1;
      perStyle.set(k, n);
      return { ...r, sno: n };
    });
}

/**
 * The per-style Component list (0457) — the Style master's other child, merged
 * into Order Info beside the sizes.
 *
 * DELIBERATELY THE SAME FOUR PASSES as `normalizeStyleSizes` above, in the same
 * order, because it is the same question asked of a different child:
 *
 * - **Drop the half-answered.** A row naming neither a coordinate nor a
 *   component nor a structure is the blank the operator is standing in. Note
 *   the test is ANY answer, not all three: the Style master lets a component be
 *   entered before its structure is decided, and requiring the triple here
 *   would silently discard work the master accepts.
 * - **Drop the orphans**, judged against the very styles being inserted in this
 *   pass — not against what is in the database, which this save is about to
 *   replace wholesale.
 * - **De-duplicate on (style, coordinate, component, fabric category)**, which
 *   is `uq_goa_style_components_part` COLUMN FOR COLUMN. That is not a
 *   coincidence to be tidied: when the two disagreed on the BOM combination
 *   sheet, the Zod guard refused legitimate two-destination rows while the
 *   index was fine. `fabric_category_id` is in both keys so a FRONT BODY in two
 *   fabrics — a contrast yoke — survives.
 * - **Renumber `sno` per style**, so each line's list reads 1..n on its own.
 *
 * `comp_type` and `item_id` ride through unread. Neither has a cell, and both
 * are copied in by the seed from `garment_style_components`; dropping them here
 * would NULL a value the master stated on the order's first save.
 */
function normalizeStyleComponents(
  data: AmendmentInput,
  styles: ReturnType<typeof normalizeStyles>,
) {
  const live = new Set(styles.map((r) => styleKey(r.style_ref_no)).filter(Boolean));
  const seen = new Set<string>();
  const perStyle = new Map<string, number>();
  /**
   * THE COORDINATE EACH LINE FILLS IN FOR ITSELF, keyed by style (client
   * 2026-08-29). A PCS line's component rows are BORN holding its one
   * coordinate, so "does this row hold anything?" stops being the same question
   * as "did the operator enter anything?" — and this filter asks the first while
   * meaning the second.
   *
   * Without it every blank row `ChildGrid` seeds under a PCS line is saved: a
   * component with a coordinate, no component and no structure. Nothing would
   * flag it — its coordinate is perfectly valid, so `orphanComponents` is silent
   * — and it would reappear as a half-filled row on the next open, once per
   * visit, for as long as the order exists.
   *
   * BUILT FROM THE PAYLOAD, not from the database: this save replaces both grids
   * wholesale, so the coordinates that matter are the ones in `data`, and the
   * same reasoning the orphan drop states two bullets up. `impliedCoordinateId`
   * is the screen's own function, so the row this drops is exactly the row the
   * screen declined to mark `required` and declined to grow past.
   */
  const impliedByStyle = new Map<string, string | null>(
    data.styles.map((s) => [
      styleKey(clean(s.style_ref_no)),
      impliedCoordinateId(
        s.unit_kind,
        data.style_coordinates.filter(
          (c) => styleKey(clean(c.style_ref_no)) === styleKey(clean(s.style_ref_no)),
        ),
      ),
    ]),
  );
  return data.style_components
    .map((r) => ({
      style_ref_no: clean(r.style_ref_no),
      coordinate_id: r.coordinate_id,
      component_id: r.component_id,
      fabric_category_id: r.fabric_category_id,
      comp_type: clean(r.comp_type),
      item_id: r.item_id,
    }))
    /* THE SCREEN'S PREDICATE, WITH THE SCREEN'S ARGUMENT — one function, three
       readers (`componentRowStarted`). The hand-written three-field test that
       stood here answered the same way for years and stopped doing so the
       moment a row could arrive pre-filled. */
    .filter((r) =>
      componentRowStarted(r, impliedByStyle.get(styleKey(r.style_ref_no)) ?? null),
    )
    .filter((r) => live.has(styleKey(r.style_ref_no)))
    .filter((r) => {
      const k = JSON.stringify([
        styleKey(r.style_ref_no),
        r.coordinate_id,
        r.component_id,
        r.fabric_category_id,
      ]);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r) => {
      const k = styleKey(r.style_ref_no);
      const n = (perStyle.get(k) ?? 0) + 1;
      perStyle.set(k, n);
      return { ...r, sno: n };
    });
}

/**
 * The per-style Process list (0411).
 *
 * Deliberately the same four passes as `normalizeStyleSizes` above, in the same
 * order, because it is the same question asked of a different child:
 *
 * - **Drop the half-answered.** A Type with no process names nothing, and a
 *   process with no Type is the invalid pair the blank-Type rule exists to
 *   prevent (see `processesForKind`). 0411 leaves BOTH columns nullable so a row
 *   mid-typing is not a 23502; this is what stops it reaching the table.
 * - **Drop the orphans**, judged against the very styles being inserted in this
 *   pass — not against what is in the database, which this save is about to
 *   replace wholesale.
 * - **De-duplicate on (style, kind, process, component)**, matching the index as
 *   0421 widened it. Both discriminators are IN the key for the same reason: a
 *   process flagged for both garments and components is legitimately named under
 *   each Type, and the same process is legitimately done on two PANELS —
 *   printing on the front body and on the sleeve. Drop either from this key and
 *   the second, correct row is silently discarded here before the database ever
 *   sees it.
 * - **Renumber `sno` per style**, so each line's list reads 1..n on its own.
 */
function normalizeStyleProcesses(
  data: AmendmentInput,
  styles: ReturnType<typeof normalizeStyles>,
) {
  const live = new Set(styles.map((r) => styleKey(r.style_ref_no)).filter(Boolean));
  const seen = new Set<string>();
  const perStyle = new Map<string, number>();
  return data.style_processes
    .map((r) => ({
      style_ref_no: clean(r.style_ref_no),
      kind: r.kind,
      process_id: r.process_id,
      component_id: r.component_id,
      details: clean(r.details),
    }))
    .filter((r) => r.kind && r.process_id)
    .filter((r) => live.has(styleKey(r.style_ref_no)))
    .filter((r) => {
      const k = JSON.stringify([
        styleKey(r.style_ref_no),
        r.kind,
        r.process_id,
        r.component_id,
      ]);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r) => {
      const k = styleKey(r.style_ref_no);
      const n = (perStyle.get(k) ?? 0) + 1;
      perStyle.set(k, n);
      return { ...r, sno: n };
    });
}

function normalizeDyeings(data: AmendmentInput) {
  return data.dyeings
    .map((r) => ({
      section: r.section === "fabric" ? "fabric" : "yarn",
      dye_type: clean(r.dye_type),
      color_name: clean(r.color_name),
      color_id: r.color_id,
    }))
    .filter((r) => r.dye_type || r.color_name || r.color_id)
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

/**
 * The attached documents (0416). The rule lives in `./file-rows` because this
 * module is `"use server"` and nothing in it can be reached by a vector — and
 * its filter differs from every sibling here in a way that invites being
 * "corrected" into a bug. See that file.
 */
function normalizeFiles(
  data: AmendmentInput,
  styles: ReturnType<typeof normalizeStyles>,
) {
  /* THE SAME `live` SET the five per-style normalizers above build, and built
     from the SAME `styles` argument for the same reason `normalizeStyleSizes`
     is handed it: recomputing it here would be a second answer to "which styles
     is this save writing?". A document filed against no style survives it —
     see the filter's own comment in `./file-rows`. */
  const live = new Set(styles.map((r) => styleKey(r.style_ref_no)).filter(Boolean));
  return normalizeFileRows(data.files, live);
}

function normalizePrints(data: AmendmentInput) {
  return data.prints
    .map((r) => ({ print_id: r.print_id, print_name: clean(r.print_name) }))
    /**
     * A ROW COUNTS ONCE IT NAMES A PRINT, BY EITHER ROUTE (0477).
     *
     * This tested `print_id` alone, which was right while the cell was a picker
     * and an id was the only thing a row could hold. The client asked for manual
     * entry on 2026-08-29, so a row may now carry a typed name and no id — and
     * against the old test every one of those was **dropped here, silently, on
     * save**: no error, no refusal, the grid simply came back one row shorter
     * than it was left. That is the failure this whole change exists to avoid,
     * and it lived in a filter three tokens long.
     *
     * `clean()` is what makes the test honest about whitespace: a cell holding
     * spaces is a blank cell, and the grid seeds a blank row on every order.
     */
    .filter((r) => r.print_id || r.print_name)
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

function normalizeStructures(data: AmendmentInput) {
  return data.structures
    .map((r) => ({ structure_id: r.structure_id, item_sub_type: r.item_sub_type }))
    // STILL KEYED ON `structure_id` ALONE. A Type with no structure names the
    // fabric type of nothing — it is a row the operator started and abandoned,
    // and keeping it would put an orphan in the list the Combos tab seeds from.
    .filter((r) => r.structure_id)
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

/**
 * Combos — the HEADER rows only. The tree beneath them is `writeComboTree`.
 *
 * `structures` is deliberately not touched here: this function's output is fed
 * straight to `.insert()`, and a nested array would be sent as a column that
 * does not exist. Keeping the split explicit is what stops the two from
 * drifting — the tree walker below reads `data.combos` again and pairs each
 * combo to its inserted row by `sno`, which is exactly what this renumbers.
 */
function normalizeCombos(data: AmendmentInput) {
  return data.combos
    .map((r) => ({
      style_ref_no: clean(r.style_ref_no),
      style: clean(r.style),
      article_no: clean(r.article_no),
      combo: clean(r.combo),
      combo_description: clean(r.combo_description),
    }))
    .filter(
      (r) => r.style_ref_no || r.style || r.article_no || r.combo || r.combo_description,
    )
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

/**
 * Does this structure row say anything at all?
 *
 * THE TWIN OF `structSaysSomething` (amendment-screen.tsx), and the two must
 * agree. That one decides whether `seedComboFromStyle` stands down; this one
 * decides whether `writeComboTree` stores the row. A row one of them calls
 * empty and the other calls filled is a row that is written and then treated as
 * a reason never to seed again.
 *
 * WHICH IS WHY THE TOLERANCE CLAUSE IS `toleranceStated`, NOT `r.gsm_tolerance`
 * (client 2026-08-31). The screen now PREFILLS 5 into every structure it opens,
 * so a truthiness test would read every blank fabric as filled: one empty
 * structure row per combo, written on every save, for ever — and the twin above
 * would then read those rows back as real and the [Detail] overlay would
 * quietly stop seeding itself from the style. Nothing errors either way, which
 * is exactly why the test is one exported function both files call rather than
 * two `!== 5` comparisons that drift the first time the baseline moves.
 *
 * YARN COLOURS COUNT (0480). A fabric whose only content is the colours of the
 * yarns it is knitted from is a fabric the operator has described — dropping it
 * would delete an answer they typed. `?.length` rather than a truthiness test
 * because `[]` is what the column reads as when nothing is ticked, and `[]` is
 * truthy.
 */
function structureFilled(r: AmendmentInput["combos"][number]["structures"][number]) {
  return (
    r.structure_id ||
    r.fabric_type ||
    r.composition_id ||
    r.gsm ||
    toleranceStated(r.gsm_tolerance) ||
    r.item_sub_type ||
    r.yarn_colors?.length ||
    r.components.some(componentFilled)
  );
}

/** Does this component row say anything at all? */
function componentFilled(
  c: AmendmentInput["combos"][number]["structures"][number]["components"][number],
) {
  return (
    c.coordinate_id ||
    c.component_id ||
    clean(c.color_name) ||
    c.print_id ||
    c.processed_as_trim
  );
}

/**
 * THE MANDATORY CELLS ON A STRUCTURE DETAILS PART — the server's half of the
 * `required` the overlay puts on Coordinate, Component and Colour (client
 * 2026-08-21).
 *
 * The screen check is a courtesy; this one is the guard. It calls the SAME
 * `componentProblems` the cells and the Save button call, so the conditional
 * Colour clause cannot be stated one way here and another way there.
 *
 * THAT CLAUSE IS NO LONGER "REQUIRED WHERE THE FABRIC'S TYPE GIVES THE CELL A
 * PALETTE", which is what this comment said until 2026-08-31 and which now
 * UNDER-REQUIRES. Having a list and being mandatory were one question for as
 * long as there were two answers; Yarn Dyed separated them, so
 * `componentColourEntry` gives three:
 *
 *   "list"    Solid / Melange — the cell offers this order's declared colours
 *             of the matching dye type, and Colour is REQUIRED.
 *   "manual"  Yarn Dyed — the cell offers NOTHING and Colour is STILL
 *             REQUIRED. A yarn-dyed panel has no single colour; it has a
 *             description ("WHITE/BLUE STRIPE"), which is typed. The yarns it
 *             was knitted from are named on the structure's own `yarn_colors`.
 *   null      Fabric Type unanswered — not required. There is nothing to
 *             answer from yet, and holding an operator on a cell the app
 *             cannot fill is the AGENTS.md "unanswerable field" trap.
 *
 * Reverting the test to `colourSourceFor(...) !== null` compiles, runs, and
 * silently makes Colour optional on every yarn-dyed part.
 *
 * ONLY ROWS THAT SURVIVE `componentFilled`. A part saying nothing at all is
 * dropped a few lines below by `writeComboTree` rather than refused, and
 * refusing it here would make a blank row the operator opened and abandoned
 * into an unsaveable order. `componentProblems` abstains on the same test.
 *
 * NOT A COLUMN CONSTRAINT. 0408 leaves all three nullable and that stays true:
 * `not null` cannot express "required when this fabric's type calls for it",
 * and it would turn a named refusal into a raw Postgres error on a row the
 * filter above deliberately kept.
 */
function comboTreeProblem(data: AmendmentInput): string | null {
  for (const combo of data.combos) {
    for (const st of combo.structures) {
      for (const c of st.components) {
        if (!componentFilled(c)) continue;
        const missing = componentProblems(c, st.item_sub_type);
        if (missing.length) {
          const who = clean(combo.combo) ?? "a combo";
          return `${who}: a part under Structure Details is incomplete — ${missing.join(
            " · ",
          )}.`;
        }
      }
    }
  }
  return null;
}

/**
 * EVERY STYLE MUST CARRY A DOCUMENT — the fourth enforcer (client 2026-08-31:
 * Add File is "mandatory before the style profile can be saved or progressed").
 *
 * ## WHY THE SCREEN'S TWO HALVES WERE NOT ENOUGH
 *
 * The rule already existed twice — the `<Field required>` and `styleFileProblems`
 * in `validity` — and BOTH of those only decide whether the Save button is
 * enabled. `submit` is reachable without it. AGENTS.md's wording for the
 * duplicate guard is exact here: *"The screen check is a courtesy; this one is
 * the guard."* A disabled button is a suggestion; a refused save is a rule.
 *
 * ## IT SHARES THE SCREEN'S PREDICATE RATHER THAN RESTATING IT
 *
 * `stylesMissingFiles` and `styleFileMessage` are in `./types`, called by this
 * action and by the screen. Two implementations of one rule is exactly how the
 * star/hold divergence AGENTS.md describes comes about — and here it would be
 * worse than cosmetic: a server stricter than the screen means a live Save
 * button that fails, and a server looser than the screen means the rule is not
 * enforced at all.
 *
 * ## IT IS UNCONDITIONAL, AND THAT IS A MEASURED CHOICE
 *
 * Grandfathering was the obvious alternative — apply it only to styles added in
 * this save — because an unconditional rule makes every order that predates it
 * unsaveable until somebody uploads a document for each of its styles. That is a
 * data-quality rule turning into a work stoppage, and it would be the right
 * worry on a populated system.
 *
 * It is not one here, and this is MEASURED against the live database rather than
 * estimated (2026-08-31):
 *
 *     style lines (total)                     6
 *     distinct orders with style lines        6
 *     garment order amendments (total)        6
 *     amendment files (total)                 0
 *     style lines that ALREADY have a file    0
 *
 * The second figure is the one that settles it, and neither this comment's first
 * draft nor the person who asked for the count thought to ask for it:
 * `garment_order_amendment_files` is **empty**. So the blast radius is not "up
 * to six" — it is exactly six, all of them, with certainty. Not one existing
 * style line can satisfy this rule today.
 *
 * The honest phrasing is therefore "**all existing orders**", not "six orders".
 * They are the same set and the first sentence is the true one: six uploads,
 * one per order, and the affected set is fully enumerable because it is every
 * order there is.
 *
 * **THE NUMBER IS SIX *TODAY*.** If this ships weeks from now against a live
 * order book, re-run the query rather than trusting the figure above — the same
 * caveat that was correctly attached to the earlier estimate (drawn from 0471's
 * header and the 08-29 `normalizeStyles` correction, which said 4 and 6) applies
 * to this measurement too, one source later. A count is evidence with a date on
 * it, not a constant.
 *
 * Grandfathering also costs something structural: "which styles are new?" is not
 * in the payload, so the action would need to read the stored styles first — and
 * the SCREEN would need the same rule, from the same cut-off, or the two halves
 * disagree about which lines are exempt. One rule with no exemption cannot drift.
 *
 * ## IT REFUSES WITH A SENTENCE
 *
 * Same reasoning as declining `not null` on `merchandiser_id` in 0478: an order
 * that predates the rule should fail with something the operator can read and
 * act on, not a constraint violation naming a table.
 */
function styleFileProblem(data: AmendmentInput): string | null {
  /* THE NORMALIZED ROWS, NOT THE RAW PAYLOAD. `normalizeStyles` drops a line
     that answers nothing and `normalizeFileRows` drops a row whose upload
     failed, so testing the raw arrays would refuse a save over a blank line the
     operator opened and abandoned — the abstention `comboTreeProblem` makes for
     the same reason one screen along. */
  const missing = stylesMissingFiles(
    normalizeStyles(data),
    normalizeFileRows(data.files),
  );
  return missing.length ? styleFileMessage(missing[0]) : null;
}

/**
 * THE DOUBLE LOCK ON QUANTITIES, SERVER SIDE (client 2026-08-31).
 *
 * Two rules the browser has enforced since 08-18 and 08-30 and the server has
 * not enforced at all:
 *
 *   1. **Inside a destination** — the size/colour breakup must sum exactly to
 *      that destination's PO Qty. The Details overlay's Done button refuses.
 *   2. **Across the tabs** — total Style PO Qty must equal total Quantities
 *      PO Qty. Next and Save refuse.
 *
 * ## WHY IT NEEDED A SERVER HALF
 *
 * Both were UI-only. A dead Save and a refusing Done cannot stop a stale client,
 * a double-submit or a direct post, and AGENTS.md is explicit that the screen
 * check is the courtesy and this one is the guard. The client's own words for
 * what an unbalanced order does downstream are that logistics, planning and
 * procurement end up working from different numbers.
 *
 * ## THE ARITHMETIC IS NOT RESTATED HERE
 *
 * Every figure comes from `lib/orders/amendments/qty-balance.ts`, which the
 * screen's own helpers now delegate to. Restating it would be two
 * implementations of one rule — the state that let the amber cell line and the
 * dead Save disagree for an afternoon in August, and the state
 * `stylesMissingFiles` was created to end one rule over.
 *
 * ## NEITHER CHECK NEEDS A DATABASE READ, AND THAT IS BY CONSTRUCTION
 *
 * - The style side is already PIECES: `styles[].po_qty` is documented as
 *   "always pieces, on a set pack too", and the screen sends `stylePoQty(r)`,
 *   which explodes a set through `derivedPoQty` before it leaves the browser.
 *   Comparing boxes against pieces would report a mismatch on every correctly
 *   entered set order, by exactly the set size.
 * - The assortment MODE rides on the row as `is_ratio_wise_pack`. That column
 *   exists for precisely this: its own note says it "stays because a reader of
 *   the row needs it to interpret the size cells without joining back to the
 *   lookup table". So the guard reads the row rather than re-deriving the mode
 *   from `assortment_type_id`, which would need `config_lookups` and could
 *   disagree with the flag actually stored.
 *
 * ## IT ABSTAINS EXACTLY WHERE THE SCREEN ABSTAINS
 *
 * `assortBalance` returns null on a breakup that adds to nothing, and
 * `crossTabPoQtyMessage` is silent while the quantity side is empty. Both are
 * the same refusal to invent a disagreement out of an unanswered section — and
 * both matter here more than on the screen, because this path also carries the
 * draft an operator saves halfway through entry.
 *
 * THE NORMALIZED ROWS, for the reason `styleFileProblem` gives one function up:
 * a blank destination the operator opened and abandoned is dropped on save, so
 * testing the raw array would refuse a save over a row that never reaches the
 * database.
 */
function qtyBalanceProblem(data: AmendmentInput): string | null {
  const quantities = normalizeQuantities(data);

  // 1. Each destination against its own breakup.
  for (const q of quantities) {
    const mode = q.is_ratio_wise_pack ? "assort" : "solid";
    const why = assortBalanceMessage(q, mode, q.style_ref_no ?? "");
    if (why) return why;
  }

  // 2. The two tabs against each other.
  const styleTotal = normalizeStyles(data).reduce((a, s) => a + (Number(s.po_qty) || 0), 0);
  return crossTabPoQtyMessage(styleTotal, totalQuantityPoQty(quantities));
}

function normalizePriceDetails(data: AmendmentInput) {
  return data.price_details
    .map((r) => ({
      style_ref_no: clean(r.style_ref_no),
      style: clean(r.style),
      article_no: clean(r.article_no),
      price_type: clean(r.price_type),
      // 0416 — WHICH colour and WHICH size this rate is for.
      combo: clean(r.combo),
      size_id: r.size_id,
      unit: clean(r.unit),
      price: Number(r.price) || 0,
    }))
    .filter(
      (r) =>
        r.style_ref_no ||
        r.style ||
        r.article_no ||
        r.price_type ||
        // A row naming only a colour or a size is one the operator has started —
        // the mode seeded it and they have not typed the rate yet. Dropping it
        // would empty a grid that visibly has rows in it, and the same reasoning
        // already put `combo` in the Approval Qty test below.
        r.combo ||
        r.size_id ||
        r.unit ||
        r.price,
    )
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

/**
 * Approval Qty (0128, gained its colour breakdown in 0413).
 *
 * `qty` and `combo` join the "has the operator started this row" test, and that
 * is not cosmetic: a line naming a colour and its ordered pieces but no sample
 * quantity is a COMPLETE row — approval_qty of zero is a legitimate answer, so a
 * filter that only looked at `approval_qty` would silently discard exactly the
 * rows the Projection and Excess columns are computed from.
 *
 * De-duplicated on (style, combo, size) to match `uq_goa_approval_qty_combo_size`
 * (0413, widened by 0435) — this is for `lib/data-io`, which writes past the
 * screen and would otherwise hit a 23505 the operator cannot act on. The screen
 * cannot produce a duplicate at all since 0435: its rows are DERIVED from the
 * Quantities assortment tree rather than added by hand.
 */
function normalizeApprovalQtys(data: AmendmentInput) {
  const seen = new Set<string>();
  return data.approval_qtys
    .map((r) => ({
      style_ref_no: clean(r.style_ref_no),
      style: clean(r.style),
      article_no: clean(r.article_no),
      combo: clean(r.combo),
      combo_description: clean(r.combo_description),
      qty: Number(r.qty) || 0,
      size_id: r.size_id ?? null,
      approval_qty: Number(r.approval_qty) || 0,
    }))
    .filter(
      (r) =>
        r.style_ref_no || r.style || r.article_no || r.combo || r.qty || r.approval_qty,
    )
    .filter((r) => {
      /* THE SIZE IS PART OF THE KEY (0435), and leaving it out is not a near
         miss — it is the whole feature deleted. The tab now carries one row per
         style + combo + SIZE, so a key of (style, combo) alone reduces nine
         sizes of RED to one row and silently discards eight approval
         quantities. Matches `uq_goa_approval_qty_combo_size`, which is also
         NULLS NOT DISTINCT, so a null size collides with a null size exactly as
         it does here. */
      const k = JSON.stringify([
        styleKey(r.style_ref_no),
        (r.combo ?? "").toUpperCase(),
        r.size_id ?? "",
      ]);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r, i) => ({ ...r, sno: i + 1 }));
}


/**
 * Pack type(s) (0399) — the one child whose row IS its value.
 *
 * DE-DUPLICATES, which no sibling normalizer has to: every other grid keys on a
 * style and two lines about one style are two different facts, whereas naming
 * the same packing method twice says nothing the first row did not. The grid
 * already hides a method another row took, so this catches the paths that do
 * not go through the grid — `lib/data-io`, and a document saved before the
 * unique index existed.
 *
 * Case-insensitively, because "already saved" is the case that matters here:
 * the tuple's wording is Title Case, and a row imported in CAPS is the same
 * method. The FIRST spelling wins and is what is stored, so nothing is rewritten
 * behind the operator's back.
 */
function normalizePackTypes(data: AmendmentInput) {
  const seen = new Set<string>();
  return data.pack_types
    .map((r) => ({ pack_type: clean(r.pack_type) }))
    .filter((r) => r.pack_type)
    .filter((r) => {
      const k = r.pack_type!.toUpperCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

/**
 * What each pack type PACKS (0472) — the child grid legacy carries beneath
 * every Pack type(s) row and the conversion had left out.
 *
 * HANDED THE PACK TYPE ROWS BEING WRITTEN, not asked to re-derive them. Same
 * dependency and the same resolution as `normalizeStyleSizes`: a line whose
 * method was renamed or removed in this very save has no parent to hang off,
 * and `normalizePackTypes` DE-DUPLICATES case-insensitively — so "abc pk" and
 * "ABC PK" collapse to one stored method, and a line typed under the loser must
 * follow the survivor rather than be orphaned. Matching on the same uppercased
 * key is what makes the two agree; comparing the raw strings would silently
 * drop half a grid the operator can still see.
 *
 * A LINE NAMING NO STYLE IS THE BLANK ROW the operator is standing in, exactly
 * as a size with no `size_id` is. It is dropped rather than stored, which is
 * also what keeps the unique index off a second all-null row.
 *
 * `sno` RENUMBERS PER PACK TYPE, so each method's list reads 1..n on its own —
 * the S No legacy's sub-grid shows is the line's position within its method.
 */
function normalizePackTypeLines(
  data: AmendmentInput,
  packTypes: ReturnType<typeof normalizePackTypes>,
) {
  const key = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();
  const live = new Map(packTypes.map((r) => [key(r.pack_type), r.pack_type!]));
  const seen = new Set<string>();
  const perType = new Map<string, number>();
  return data.pack_type_lines
    .map((r) => ({
      pack_type: clean(r.pack_type),
      style_ref_no: clean(r.style_ref_no),
      style: clean(r.style),
      combo: clean(r.combo),
      qty: r.qty,
    }))
    .filter((r) => r.style_ref_no)
    .filter((r) => live.has(key(r.pack_type)))
    /* STORED UNDER THE SPELLING THAT SURVIVED de-duplication, so the text key
       the screen re-nests by matches a row that is actually there. */
    .map((r) => ({ ...r, pack_type: live.get(key(r.pack_type))! }))
    .filter((r) => {
      const k = JSON.stringify([key(r.pack_type), styleKey(r.style_ref_no), key(r.combo)]);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((r) => {
      const k = key(r.pack_type);
      const n = (perType.get(k) ?? 0) + 1;
      perType.set(k, n);
      return { ...r, sno: n };
    });
}

function normalizeQuantities(data: AmendmentInput) {
  return data.quantities
    .map((r) => ({
      country_id: r.country_id ?? null,
      style_ref_no: clean(r.style_ref_no),
      style_no: clean(r.style_no),
      consignee_id: r.consignee_id ?? null,
      assortment_type_id: r.assortment_type_id ?? null,
      /* WHICH PACKING METHOD THIS DESTINATION SHIPS (0473). Written whatever
         the Pack toggle says, for the reason `pack_types` itself is: hiding a
         grid is not the same as emptying it, and a destination that lost its
         method on a mis-click would have its colourway rows silently stop
         being derived from anything. */
      pack_type: clean(r.pack_type),
      // The buyer PO this destination belongs to (0427). Written whatever the
      // header's `multi_order` says: turning the switch off HIDES the column,
      // and a value the operator typed while it was on must survive that —
      // clearing here would delete data on a mis-click of a checkbox.
      po_no: clean(r.po_no),
      po_qty: Number(r.po_qty) || 0,
      delivery_date: clean(r.delivery_date),
      earlier_shipment_date: clean(r.earlier_shipment_date),
      warehouse_id: r.warehouse_id ?? null,
      discharge_port_id: r.discharge_port_id ?? null,
      // The Assort overlay's own header (0414) — one-to-one with this row.
      pack: clean(r.pack),
      is_ratio_wise_pack: r.is_ratio_wise_pack,
      ratio_for: clean(r.ratio_for),
      is_single_style_pack: r.is_single_style_pack,
      master_carton_name: clean(r.master_carton_name),
      inner_carton_name: clean(r.inner_carton_name),
      pack_description: clean(r.pack_description),
    }))
    // A row the grid seeded and nobody answered is not a quantity. Same shape as
    // every sibling normalizer: drop the empty ones, then renumber so `sno` is
    // dense whatever the operator deleted.
    .filter(
      (r) =>
        r.country_id ||
        r.style_ref_no ||
        r.style_no ||
        r.consignee_id ||
        r.assortment_type_id ||
        r.po_no ||
        r.po_qty ||
        r.delivery_date ||
        r.earlier_shipment_date ||
        r.warehouse_id ||
        r.discharge_port_id ||
        // A row whose ONLY content is its assortment is still a row. The two
        // booleans are deliberately absent from this test: they default to
        // false, so counting them would make every seeded blank row "filled".
        r.pack ||
        /* The method this destination ships (0473) — a row whose only content
           is "these go out as ABC PACK" is a row. */
        r.pack_type ||
        r.ratio_for ||
        r.master_carton_name ||
        r.inner_carton_name ||
        r.pack_description,
    )
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

/**
 * The order's Time & Action ladder (0481) — the ROWS AS TYPED.
 *
 * The dates are NOT here; `taActivityRows` below resolves them through
 * `orderTaLadder()` and merges the dashboard's columns on. This half does what
 * every sibling normalizer does and nothing else: drop the blanks, refuse a
 * repeat, renumber `sno` dense.
 *
 * A ROW IS BLANK ONLY WHEN IT ANSWERS NOTHING. An activity with no Days is NOT
 * blank — it is the ordinary state of a ladder mid-entry, and it is the row
 * `backwardSchedule` refuses BY NAME ("Knitting: enter how many days it needs").
 * Dropping it would silence that refusal and produce a shorter plan that looks
 * complete, which is the failure `assortLineFilled` records one grid over: "a
 * completeness test that enumerates the columns has to be extended with the
 * columns".
 *
 * DE-DUPLICATES ON `row_uid`, which no sibling has to. The anchor is unique per
 * amendment (`uq_goa_ta_activities_row_uid`), so a payload repeating one would
 * take a 23505 and fail the whole save — and worse, the merge below reads the
 * saved completions into a Map keyed by it, so two rows sharing an anchor would
 * both claim one completion. The FIRST wins, matching `normalizePackTypes`.
 */
function normalizeTaActivities(data: AmendmentInput) {
  const seen = new Set<string>();
  return data.ta_activities
    .map((r) => ({
      row_uid: r.row_uid,
      activity_id: r.activity_id,
      days_required: r.days_required,
    }))
    .filter((r) => r.activity_id || r.days_required != null)
    .filter((r) => {
      if (seen.has(r.row_uid)) return false;
      seen.add(r.row_uid);
      return true;
    })
    .map((r, i) => ({ ...r, sno: i + 1 }));
}

/**
 * THE T&A LADDER'S ROWS, MERGED — the one child of this document that is not
 * replaced wholesale, and the reason is worth the length.
 *
 * ## WHY THIS CANNOT BE AN ORDINARY NORMALIZER
 *
 * `writeChildren` deletes every child row and reinserts. That is lossless for a
 * price line or a pack type, because the form holds their whole truth. Two of
 * this table's columns are never on this form at all:
 *
 *     entered on the ORDER, on the T&A tab   activity_id · days_required
 *     entered on the DASHBOARD, days later   actual_date · status · notes
 *
 * So an operator reopening the order to fix a typo in Pay Terms and pressing
 * Save would DESTROY EVERY COMPLETION RECORD ON THE ORDER — silently, with no
 * error, because deleting a child grid and writing it back is the ordinary
 * thing this writer does.
 *
 * That is not hypothetical. AGENTS.md and the Material Attribute post-mortem
 * record it happening: "BOTH writers replaced child grids wholesale over an ON
 * DELETE SET NULL FK; 12/12 lines + 10 answers destroyed and unrecoverable."
 *
 * ## THE MERGE IS BY `row_uid`, AND IT READS BEFORE THE DELETE
 *
 * Reading first is not an optimisation — after the delete loop there is nothing
 * left to compare against. `writeChildren` calls this while building its
 * `inserts` table, which is before the first `.delete()`, and the same reason
 * the dispatched-challan read in `material-bom-amendment/actions.ts` sits where
 * it does.
 *
 * `row_uid` and never `id`: the reinsert re-mints `id`, and the normalizer
 * renumbers `sno`, so the anchor is the only thing that crosses a save. It is
 * the 0446/0459 pattern, applied a second time.
 *
 * ## THE PAYLOAD CANNOT CARRY A COMPLETION, BY CONSTRUCTION
 *
 * `amendmentTaActivityInput` has no `actual_date`, `status` or `notes` field.
 * That is the safety property: the three columns come from the DATABASE and
 * from nowhere else, so there is no precedence rule to get wrong and no stale
 * form that can overwrite a completion with a blank. See the schema's own note.
 *
 * ## AN EMPTY INCOMING LIST FALLS BACK TO THE SAVED LADDER
 *
 * This is the asymmetry that matters, and it is deliberate. `ta_activities`
 * defaults to `[]` in the Zod input, so ANY payload that does not know about
 * this tab — a stale client, a `curl`, a caller written before today — arrives
 * with an empty list. Under the flat delete-and-reinsert that would empty the
 * table and take every completion with it, which is precisely the disaster the
 * paragraphs above are about.
 *
 * So an empty list means "this save says nothing about the ladder", not "delete
 * the ladder": the SAVED rows are re-emitted, re-dated, and written back.
 *
 * THE PRICE IS REAL AND IS THE CHEAP HALF: an operator who deletes every row of
 * the ladder and saves will find it still there on reload. That is visible and
 * one edit from being fixed. A payload silently destroying completion records is
 * neither. The ladder is mandatory on the screen anyway, so "no activities at
 * all" is not a state the operator is trying to reach.
 *
 * ## THE DATES ARE RESOLVED HERE, THROUGH THE SCREEN'S OWN FUNCTION
 *
 * `orderTaLadder()` is client-safe and the T&A tab renders from it, so the
 * stored `target_date` is never a second opinion — BOTH HALVES OR NEITHER, the
 * rule `purchase_qty` already follows. Whichever list won above is the list that
 * is dated, so a stale payload's save still leaves the ladder dated against the
 * delivery date THIS save wrote, rather than against the one it replaced.
 *
 * HOLIDAYS ARE PASSED BY NEITHER HALF, AND THAT IS WHY THEY AGREE. Nothing in
 * this repo consults the `holidays` master yet (`holidaySet()` has no caller),
 * so both sides run Sunday-only and match by construction. **If either side ever
 * starts passing a holiday set, both must, in the same change** — a screen
 * resolving a ladder over a calendar the server does not know about is a date no
 * control enforces, which is the whole failure this note exists to prevent.
 *
 * ## A REFUSAL NO LONGER BLOCKS THE SAVE — REVERSED 2026-08-31, AND
 * ## DELIBERATELY, NOT AS A BUGFIX
 *
 * The client made the T&A tab OPTIONAL the same day it was built: *"make it
 * optional now will implement it later as required"*. So this reads:
 *
 *     if (isRefusal(plan)) → every `target_date` is NULL, and the save proceeds
 *
 * **What it used to read, and why it cannot stay that way.** The gate was
 * `if (isRefusal(plan) && !data.is_draft) return { ok: false, error: … }` —
 * a real save whose ladder refused was rejected before the delete loop, the
 * shape `comboTreeProblem` uses for rules Zod cannot state. That was correct
 * while the SCREEN was also mandatory: the operator met the refusal on a
 * disabled Save button, with a rail badge and `revealFirstProblem` steering the
 * cursor to the offending row.
 *
 * With the screen gate gone, the same server gate becomes the worst of both:
 * Save is enabled, the operator presses it, and a round trip returns a toast
 * with **no badge, no problem routing and no cursor steer**, because that
 * machinery has been removed. AGENTS.md names this exact failure under Mandatory
 * fields — *"requiring a hidden field is a record that cannot be saved with
 * nothing on screen to say why"*. Client-optional plus server-mandatory is
 * strictly worse than either end being consistent.
 *
 * **`is_draft` therefore does not appear in this function at all any more.** The
 * draft branch is not merely unused, it is meaningless: undated-on-refusal was
 * the draft behaviour and is now the only behaviour. A dead `data.is_draft` left
 * in the condition would read as a rule that still discriminates.
 *
 * **RESTORING IT IS ONE LINE, AND IT IS COMING BACK.** The client said "later as
 * required". When it does, the gate goes back exactly as quoted above — and the
 * SCREEN gate must go back in the same change, which is why `ui` kept
 * `taProblems` built and `{ key: "ta" }` declared in `sectionValidity`'s
 * `sections`. Do not restore this half alone, and do not delete it as dead code.
 *
 * **THE COST OF OPTIONAL, STATED SO NOBODY DISCOVERS IT.** A half-filled ladder
 * now SAVES, with every row undated — and an undated row matches no worklist
 * query (`target_date <= today`), so the dashboard shows nothing due for that
 * order. That reads as "nothing is due", not as "this ladder was never
 * finished": the empty-report failure the contract names, and indistinguishable
 * from a legitimate answer. The operator is not left in the dark — the screen
 * renders the same refusal sentence as advisory text, from this same
 * `orderTaLadder` — but nothing downstream chases an order whose ladder was
 * abandoned. Surfacing that belongs to the dashboard, not here.
 *
 * ## `created_by` IS NOT NAMED, SO ITS DEFAULT FIRES
 *
 * The inverse of 0475's lesson, and worth stating because the neighbouring
 * `status` needs the opposite treatment: a default applies only when the INSERT
 * omits the column, so `created_by` is left off and `auth.uid()` stamps it,
 * while `status` is named on every row (the merge carries it) and therefore has
 * to be coalesced HERE rather than relying on the column default.
 */
async function taActivityRows(
  s: Awaited<ReturnType<typeof createClient>>,
  amendmentId: string,
  data: AmendmentInput,
  quantityRows: ReturnType<typeof normalizeQuantities>,
): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false; error: string }> {
  // READ BEFORE ANY DELETE. On a create this is a new id and comes back empty,
  // which is correct and costs one round trip.
  const { data: savedRaw, error: savedErr } = await s
    .from("garment_order_amendment_ta_activities")
    .select("row_uid, sno, activity_id, days_required, actual_date, status, notes")
    .eq("amendment_id", amendmentId);
  if (savedErr) return { ok: false, error: savedErr.message };
  /* SORTED BY `sno` HERE, because `taRowsToWrite` re-emits them IN THE ORDER IT
     IS GIVEN THEM — a ladder is the operator's sequence, and a pure function
     that re-sorted it would move dates nobody edited. PostgREST makes no
     ordering promise, so leaving this out would reorder the ladder on a save
     that said nothing about it. */
  const saved = ((savedRaw ?? []) as SavedTaRow[]).slice().sort((a, b) => a.sno - b.sno);

  /* WHICH LADDER THIS SAVE IS WRITING. Pure, declared in `types.ts` and
     vectored by `npm run check:ta-merge` — a merge that is merely written is
     not a merge that is known to work. */
  const rows = taRowsToWrite(normalizeTaActivities(data), saved);
  if (!rows.length) return { ok: true, rows: [] };

  /* THE ACTIVITY'S NAME, SO A REFUSAL CAN NAME THE ROW. `backwardSchedule`
     prints "<label>: enter how many days it needs" and falls back to "A
     process" — which, on a ladder of ten identical-looking boxes, sends the
     operator hunting. One `in` query, only over the ids actually used.

     ITS ONLY CONSUMER IS DORMANT AND IT IS KEPT ANYWAY. `label` is read by
     nothing but a refusal message, and since 2026-08-31 this action discards
     that message rather than returning it (see the header). Deleting the lookup
     would make restoring the gate a TWO-piece job — one line for the guard and
     one to re-add this — and the half that would get forgotten is the one whose
     absence nobody notices: a refusal reading "A process: enter how many days it
     needs" instead of naming Knitting. `ui` engineered its own half the same way
     round, so the requirement comes back as one line on each side.

     It costs an `in` over at most ten uuids per save, and it does not touch the
     DATES: `label` appears in no arithmetic, so both halves still resolve the
     same ladder whatever this returns. */
  const activityIds = [...new Set(rows.map((r) => r.activity_id).filter((v): v is string => !!v))];
  const labels = new Map<string, string>();
  if (activityIds.length) {
    const { data: acts, error: actErr } = await s
      .from("ta_activities")
      .select("id, name")
      .in("id", activityIds);
    if (actErr) return { ok: false, error: actErr.message };
    for (const a of (acts ?? []) as { id: string; name: string | null }[]) {
      if (a.name) labels.set(a.id, a.name);
    }
  }

  const plan = orderTaLadder({
    rows: rows.map((r) => ({
      row_uid: r.row_uid,
      activity_id: r.activity_id,
      label: (r.activity_id && labels.get(r.activity_id)) || "",
      days_required: r.days_required,
    })),
    // The quantity rows THIS SAVE IS WRITING, not `data.quantities` — a blank
    // destination row is dropped by `normalizeQuantities`, and a date on a row
    // that is about to be discarded must not anchor the whole factory's plan.
    quantities: quantityRows,
    deliveryDate: data.delivery_date ?? null,
    // holidays: deliberately absent on BOTH halves. See the header.
  });

  /* A REFUSAL DATES NOTHING AND DOES NOT BLOCK THE SAVE (client 2026-08-31: the
     tab is optional "now will implement it later as required"). Draft or not —
     see the header for what this used to be, why it changed, and the one line
     that puts it back when the requirement returns. */
  const targetDates = isRefusal(plan)
    ? rows.map(() => null)
    : plan.rows.map((r) => r.target_date);

  /* CARRY THE DASHBOARD'S COLUMNS ACROSS. Pure, declared in `types.ts`, and
     vectored — see `mergeTaCompletions` there for why the rule lives outside
     this file. `created_by` is deliberately NOT named on the row, so the
     column's `default auth.uid()` fires (0475's lesson, inverted). */
  return { ok: true, rows: mergeTaCompletions(rows, saved, targetDates) };
}

/**
 * Does this assortment line say anything at all?
 *
 * EVERY TYPEABLE CELL COUNTS, and the two added on 2026-08-19 are the point:
 * this test used to read `combo || no_of_cartons || a named size`, which is
 * three of the line's five inputs. A line where the operator had typed ONLY an
 * inner count (0432) or ONLY a style ref (0433) answered "blank" and was
 * dropped on save — silently, because dropping a blank line is the ordinary
 * thing this function is for. A completeness test that enumerates the columns
 * has to be extended with the columns; there is no clever shortcut, so the
 * check is written out and this comment says why.
 *
 * `inners_per_carton` is tested against its DEFAULT rather than for truthiness:
 * the Zod input fills a blank box with 1, so `Number(...) || 0` would read
 * every untouched line as answered and keep them all alive.
 */
function assortLineFilled(l: AmendmentInput["quantities"][number]["assort_lines"][number]) {
  // A size cell counts only when it NAMES a size — an untouched grid is a row
  // of zeroes against nothing, and would otherwise keep every blank line alive.
  return (
    clean(l.style_ref_no) ||
    clean(l.combo) ||
    /* A PACKS ROW NAMES NO COLOURWAY AND MAY NAME NO STYLE (0473), so without
       this it is "filled" only by its size cells — true today and true only by
       accident. Stated so the row survives on its own terms: it is the one line
       whose whole content is a flag plus a row of boxes, and dropping it turns
       every derived colourway line beneath it into an orphan. Unlike the two
       booleans on the quantity row above, this one is NOT set on a seeded blank
       — only the pack layout creates it — so counting it cannot keep an
       untouched row alive. */
    l.is_pack_row ||
    l.no_of_cartons ||
    Number(l.inners_per_carton) > 1 ||
    l.sizes.some((z) => z.size_id)
  );
}

/** Replace every child grid wholesale for a given amendment id. */
async function writeChildren(
  s: Awaited<ReturnType<typeof createClient>>,
  amendmentId: string,
  data: AmendmentInput,
): Promise<Result> {
  /**
   * `garment_order_amendment_charges` (2026-08-10) and
   * `garment_order_amendment_style_prices` (2026-08-12) are deliberately ABSENT.
   *
   * The delete loop below iterates THIS list, so dropping an entry removes the
   * table from both halves: the stored charge rows are neither rewritten nor
   * deleted, they are simply left alone. Putting it back in the list while the
   * form no longer collects them would wipe every amendment's charges — or its
   * style prices — on its next save.
   */
  // Computed ONCE and shared: `normalizeStyleSizes` drops any size whose style
  // is not in this exact list, so recomputing it there would be two answers to
  // "which styles is this save writing?".
  const styleRows = normalizeStyles(data);
  // Shared with `writeComboTree`, which pairs each combo to its inserted row by
  // the `sno` this stamps — recomputing it there would be a second answer to
  // "which combos is this save writing?".
  const comboRows = normalizeCombos(data);
  // Shared with `normalizePackTypeLines`, which drops a line whose method did
  // not survive de-duplication and restamps the rest with the spelling that
  // did — it has to be handed the same list, not a second computation of it.
  const packTypeRows = normalizePackTypes(data);
  /* Computed once and shared with the T&A ladder below, which anchors on the
     EARLIEST `earlier_shipment_date` across these very rows — recomputing it
     there would be a second answer to "which destinations is this save
     writing?", and a destination dropped for being blank must not date the
     factory's plan. */
  const quantityRows = normalizeQuantities(data);

  /**
   * The T&A ladder (0481) — RESOLVED BEFORE THE DELETE LOOP, and that is the
   * whole point of where this line sits.
   *
   * It reads the saved completions (which the delete would otherwise destroy),
   * merges them onto the incoming rows by `row_uid`, and dates the ladder. A
   * refusal returns HERE, with nothing deleted and nothing written — the shape
   * `comboTreeProblem` uses for a rule Zod cannot state, arriving one layer
   * further in because this rule needs the database as well as the payload.
   */
  const ta = await taActivityRows(s, amendmentId, data, quantityRows);
  if (!ta.ok) return fail(ta.error);

  const inserts: [string, Record<string, unknown>[]][] = [
    ["garment_order_amendment_styles", styleRows],
    // AFTER the styles it depends on, though the order of this list only
    // decides the order of the writes — the dependency is resolved above, by
    // handing `normalizeStyleSizes` the very rows being inserted.
    ["garment_order_amendment_style_sizes", normalizeStyleSizes(data, styleRows)],
    // What a component is a part of (0461). Same dependency and the same
    // resolution as the sizes above: handed the rows being inserted.
    ["garment_order_amendment_style_coordinates", normalizeStyleCoordinates(data, styleRows)],
    // Retail SET pack members (0467). Same dependency, same resolution.
    ["garment_order_amendment_pack_components", normalizePackComponents(data, styleRows)],
    // The Style master's component list, merged into Order Info (0457). Same
    // dependency and the same resolution as the sizes above.
    ["garment_order_amendment_style_components", normalizeStyleComponents(data, styleRows)],
    // Same dependency and the same resolution as the sizes above: handed the
    // rows being inserted, not asked to re-derive them.
    ["garment_order_amendment_style_processes", normalizeStyleProcesses(data, styleRows)],
    ["garment_order_amendment_dyeings", normalizeDyeings(data)],
    ["garment_order_amendment_prints", normalizePrints(data)],
    ["garment_order_amendment_structures", normalizeStructures(data)],
    ["garment_order_amendment_combos", comboRows],
    ["garment_order_amendment_price_details", normalizePriceDetails(data)],
    ["garment_order_amendment_approval_qtys", normalizeApprovalQtys(data)],
    // Computed once and shared with the lines beneath them, so "which pack
    // types is this save writing?" has one answer rather than two.
    ["garment_order_amendment_pack_types", packTypeRows],
    // What each of those methods PACKS (0472). AFTER the methods it depends
    // on, and handed the very rows being inserted — the same dependency and
    // the same resolution as the style sizes above.
    ["garment_order_amendment_pack_type_lines", normalizePackTypeLines(data, packTypeRows)],
    /* The order's Time & Action ladder (0481). MERGED, NOT REPLACED — the rows
       were built above, before the delete loop, carrying each row's stored
       `actual_date` / `status` / `notes` across by `row_uid`. It is in this
       list all the same, so the delete-and-reinsert still happens: the rows
       being reinserted are simply not the payload's alone. Read
       `taActivityRows` before changing anything here — putting
       `normalizeTaActivities(data)` in this slot instead would compile, pass
       every check, and destroy every completion record on the order. */
    ["garment_order_amendment_ta_activities", ta.rows],
    // THIS LIST DRIVES THE DELETE LOOP AS WELL AS THE INSERTS. An entry added
    // only to the insert side would leave the previous rows in place and add
    // the new ones beside them, doubling the grid on every save.
    ["garment_order_amendment_quantities", quantityRows],
    /* The attached documents (0416). METADATA ONLY — the delete below drops
       rows, never objects, and that asymmetry is deliberate: the file uploads
       the moment it is chosen and the row is written on Save, so a delete that
       reached into the bucket would make Cancel destroy a file the operator may
       have no other copy of. Orphaned objects accumulate instead, which
       `file-attachments.tsx` records as a known, accepted remainder. */
    ["garment_order_amendment_files", normalizeFiles(data, styleRows)],
  ];

  // Delete-all-then-reinsert each child grid wholesale.
  for (const [t] of inserts) {
    const { error } = await s.from(t).delete().eq("amendment_id", amendmentId);
    if (error) return fail(error.message);
  }

  for (const [table, rows] of inserts) {
    if (!rows.length) continue;
    const { error } = await s
      .from(table)
      .insert(rows.map((r) => ({ ...r, amendment_id: amendmentId })));
    if (error) return fail(error.message);
  }

  const comboResult = await writeComboTree(s, amendmentId, data, comboRows);
  if (!comboResult.ok) return comboResult;
  return writeAssortTree(s, amendmentId, data);
}

/**
 * Quantities ▸ Assort — the two levels beneath a quantity row (0414).
 *
 * THE FLAT LOOP CANNOT DO THIS, for exactly the reason `writeComboTree` above
 * cannot: it inserts every table with `amendment_id`, and neither of these has
 * one. A line belongs to a QUANTITY ROW and a size cell to a LINE, by uuids
 * Postgres assigns during this very save.
 *
 * NO DELETE PASS. Both tables cascade (0414 asserts it by exercising it two
 * levels down), and the flat loop has already deleted every quantity row of
 * this amendment — which took the whole tree with it.
 *
 * PAIRED BY `sno`, NEVER BY INSERT ORDER. `.insert([...]).select()` returning
 * rows in the order they were sent is not a promise PostgREST makes, and a
 * mis-paired line would put one destination's carton ratio on another — a
 * document that tells a factory what to cut and ship where.
 */
async function writeAssortTree(
  s: Awaited<ReturnType<typeof createClient>>,
  amendmentId: string,
  data: AmendmentInput,
): Promise<Result> {
  const { data: savedQtys, error: qtyErr } = await s
    .from("garment_order_amendment_quantities")
    .select("id, sno")
    .eq("amendment_id", amendmentId);
  if (qtyErr) return fail(qtyErr.message);
  if (!savedQtys?.length) return { ok: true };

  const qtyIdBySno = new Map<number, string>();
  for (const q of savedQtys as { id: string; sno: number }[]) qtyIdBySno.set(q.sno, q.id);

  // Filtered the SAME way `normalizeQuantities` filters, so the two lists stay
  // parallel — walking `data.quantities` directly would drift by one the moment
  // a blank row is dropped, and every assortment after it would land on the
  // wrong destination.
  const kept = data.quantities.filter(
    (r) =>
      r.country_id || clean(r.style_ref_no) || clean(r.style_no) || r.consignee_id ||
      r.assortment_type_id || clean(r.po_no) || Number(r.po_qty) || clean(r.delivery_date) ||
      clean(r.earlier_shipment_date) || r.warehouse_id || r.discharge_port_id ||
      clean(r.pack) || clean(r.ratio_for) || clean(r.master_carton_name) ||
      clean(r.inner_carton_name) || clean(r.pack_description),
  );

  type LineIn = AmendmentInput["quantities"][number]["assort_lines"][number];
  const lineRows: Record<string, unknown>[] = [];
  const lineSrc = new Map<string, LineIn>();
  const pairKey = (parentId: string, sno: number) => `${parentId}#${sno}`;

  kept.forEach((src, i) => {
    const quantityId = qtyIdBySno.get(i + 1);
    if (!quantityId) return;
    let sno = 0;
    for (const l of src.assort_lines) {
      if (!assortLineFilled(l)) continue;
      sno += 1;
      lineSrc.set(pairKey(quantityId, sno), l);
      lineRows.push({
        quantity_id: quantityId,
        sno,
        // NULL, not "", when the line names no style (0433) — that is the row
        // saying it inherits the destination's style, and `clean` already
        // returns null for a blank so the two states cannot blur.
        style_ref_no: clean(l.style_ref_no),
        combo: clean(l.combo),
        /* THE LINE WHOSE CELLS ARE BOXES (0473). Carried verbatim: it decides
           how every size cell beneath it is READ, so a save that dropped it
           would turn a box count into a piece count on the next load — the
           whole order under-read by the pack size, silently. */
        is_pack_row: l.is_pack_row,
        no_of_cartons: Number(l.no_of_cartons) || 0,
        // `|| 1`, never `|| 0` — see the Zod input's note (0432). A multiplier
        // that falls back to zero empties the order rather than failing.
        inners_per_carton: Number(l.inners_per_carton) || 1,
      });
    }
  });
  if (!lineRows.length) return { ok: true };

  const { data: savedLines, error: lineErr } = await s
    .from("garment_order_amendment_assort_lines")
    .insert(lineRows)
    .select("id, quantity_id, sno");
  if (lineErr) return fail(lineErr.message);

  const sizeRows: Record<string, unknown>[] = [];
  for (const row of (savedLines ?? []) as { id: string; quantity_id: string; sno: number }[]) {
    const src = lineSrc.get(pairKey(row.quantity_id, row.sno));
    if (!src) continue;
    const seen = new Set<string>();
    for (const z of src.sizes) {
      // DROPPED FOR HAVING NO SIZE, never for having no quantity. An explicit 0
      // against a real size is a statement — "this carton has no XL" — and is
      // not the same as never having been asked.
      if (!z.size_id || seen.has(z.size_id)) continue;
      seen.add(z.size_id);
      sizeRows.push({ line_id: row.id, size_id: z.size_id, qty: Number(z.qty) || 0 });
    }
  }
  if (!sizeRows.length) return { ok: true };

  const { error: sizeErr } = await s
    .from("garment_order_amendment_assort_line_sizes")
    .insert(sizeRows);
  if (sizeErr) return fail(sizeErr.message);

  return { ok: true };
}

/**
 * The two levels beneath a combo — structures, then their components (0408).
 *
 * THE FLAT LOOP ABOVE CANNOT DO THIS, and it is worth being precise about why:
 * it inserts every table with `amendment_id`, and neither of these tables has
 * one. A structure belongs to a COMBO and a component belongs to a STRUCTURE,
 * by uuids that Postgres assigns during this very save — so the rows cannot be
 * built until the level above has been written and has answered with its ids.
 *
 * NO DELETE PASS IS NEEDED and adding one would be a bug. Both tables cascade
 * (`on delete cascade`, asserted in 0408 by actually exercising it), and the
 * flat loop has already deleted every combo of this amendment — which took the
 * whole tree with it. A second delete here would run against rows that no
 * longer exist and would read as though it were doing something.
 *
 * PAIRED BY `sno`, NOT BY INSERT ORDER. `.insert([...]).select()` returning
 * rows in the order they were sent is not a promise PostgREST makes, and a
 * mis-paired structure would put the body's GSM on the collar — silently, and
 * on a document nobody re-checks. `normalizeCombos` renumbers `sno` to 1..n
 * within the amendment and this walker renumbers structures within their combo,
 * so the number is unique wherever it is used as a key.
 *
 * A ROW THAT SAYS NOTHING IS DROPPED, at each level, and a structure counts as
 * saying something if any of ITS components do — otherwise a structure whose
 * only content is the parts under it would be discarded and take them with it.
 */
async function writeComboTree(
  s: Awaited<ReturnType<typeof createClient>>,
  amendmentId: string,
  data: AmendmentInput,
  comboRows: ReturnType<typeof normalizeCombos>,
): Promise<Result> {
  if (!comboRows.length) return { ok: true };

  // The combo ids this save just wrote, keyed by the `sno` normalizeCombos
  // stamped on them. Re-read rather than captured from the insert above,
  // because the flat loop deliberately knows nothing about ids — and the table
  // was emptied first, so every row here is one of ours.
  const { data: savedCombos, error: comboErr } = await s
    .from("garment_order_amendment_combos")
    .select("id, sno")
    .eq("amendment_id", amendmentId);
  if (comboErr) return fail(comboErr.message);
  const comboIdBySno = new Map<number, string>();
  for (const c of (savedCombos ?? []) as { id: string; sno: number }[]) {
    comboIdBySno.set(c.sno, c.id);
  }

  // ---- level 2: structures -------------------------------------------------
  // `structSrc` remembers which input structure produced which row, so the
  // components can be found again after the insert answers with ids.
  type StructIn = AmendmentInput["combos"][number]["structures"][number];
  const structRows: Record<string, unknown>[] = [];
  const structSrc = new Map<string, StructIn>();
  const pairKey = (parentId: string, sno: number) => `${parentId}#${sno}`;

  // `normalizeCombos` filters and renumbers, so walking `data.combos` in step
  // with it would drift the moment a blank combo is dropped. Filtering the
  // input the same way it did is what keeps the two lists parallel.
  const keptCombos = data.combos.filter(
    (r) =>
      clean(r.style_ref_no) || clean(r.style) || clean(r.article_no) ||
      clean(r.combo) || clean(r.combo_description),
  );
  keptCombos.forEach((src, i) => {
    const comboId = comboIdBySno.get(i + 1);
    if (!comboId) return;
    let sno = 0;
    for (const st of src.structures) {
      if (!structureFilled(st)) continue;
      sno += 1;
      structSrc.set(pairKey(comboId, sno), st);
      /* READ ONCE, BECAUSE TWO COLUMNS ANSWER TO IT. `item_sub_type` is what is
         stored AND what decides whether `yarn_colors` may be, so the gate below
         has to test the value this row actually writes — not the raw payload it
         came from. `nullableText` is `z.string().optional().nullable()` and does
         NOT trim, which is the whole reason `clean()` is here at all: with the
         two spellings apart, a payload of `" yarn_dyed "` would be STORED as
         yarn_dyed and have its yarn colours wiped in the same statement. */
      const subType = clean(st.item_sub_type);
      structRows.push({
        combo_id: comboId,
        sno,
        structure_id: st.structure_id,
        fabric_type: clean(st.fabric_type),
        composition_id: st.composition_id,
        gsm: st.gsm,
        gsm_tolerance: st.gsm_tolerance,
        item_sub_type: subType,
        /* NAMED, NEVER OMITTED (0480) — the same rule `fabric_type` above and
           `processed_as_trim` below are here under, and the one
           `amendmentPrintInput.print_id` states from the schema side: this
           walker DELETES AND REINSERTS the whole tree, so a column the payload
           stops carrying is not frozen at what it held, it is written back at
           its default on the next save of ANY tab. Drop this line and every
           yarn-dyed fabric in the order silently loses its yarn colours the
           first time somebody edits a price.

           AND GATED ON THE TYPE, which is the server's half of a rule the
           SCREEN already applies on the Fabric Type `<Select>` (`patchStruct`,
           on the change and deliberately not in an effect). Its comment there
           states the reason the value must not survive the type: Yarn Color
           exists only under Yarn Dyed, so on any other type its names are a
           value the operator cannot see, cannot edit and cannot remove — the
           inverse of AGENTS.md's "requiring a hidden field", a hidden field
           that keeps writing.

           THIS IS NOT REDUNDANT WITH THE SCREEN, and it is not redundant with
           the database either. 0480 deliberately carries NO cross-column CHECK,
           because `item_sub_type` is nullable and a constraint would make the
           ORDER the operator fills two cells in decide whether the save
           succeeds. So nothing under this line enforces it: a `lib/data-io`
           import, a stale tab still sending the pre-08-31 payload, or any
           writer that is not this screen reaches Postgres unchallenged. "The
           screen check is a courtesy; this one is the guard" — AGENTS.md says
           it of duplicates, and it holds here.

           IT REFUSES ONLY A TYPE THAT CONTRADICTS IT, NEVER AN UNANSWERED ONE,
           and that asymmetry is the whole correctness of this line.

           The obvious gate is `subType === "yarn_dyed" ? keep : []`. It is
           wrong, and it became wrong the moment `order-seed.ts` learned to read
           `order_fabric_yarn_colors`: a seeded structure carries the ORDER's own
           yarn colours while `order_fabrics.item_sub_type` is NULLABLE and
           frequently null — every one of the 21 rows in
           `garment_order_amendment_structures` is null today. So a fabric whose
           order sheet named its yarn colours, but never named its type, would
           have arrived with them and lost them on the first save of any tab,
           silently and unrecoverably. The one writer that can restore them is
           the seed, and the seed only runs once.

           NULL IS A REAL STATE, NOT A MISSING DEFAULT — the sentence this file
           and `types.ts` both already carry about this exact column. "Not
           answered" is not "answered solid". A value is destroyed here only
           when the operator has positively said the cloth is something else, at
           which point the screen has already cleared it on the change and this
           is agreeing with it rather than acting alone.

           The cost is stated rather than hidden: an unanswered structure may
           carry yarn colours nothing on screen displays. They are the order's
           own words, they cost nothing, and answering the Fabric Type — the
           very next thing anyone does to such a row — resolves them either way.

           `[]`, NEVER null, on the refusing branch: the column is
           `not null default '{}'` (0480). `?? []` on the keeping branch for the
           same reason — the interface allows null for a row the seed or the
           screen built and the database has never seen. */
        yarn_colors:
          subType && subType !== "yarn_dyed" ? [] : (st.yarn_colors ?? []),
      });
    }
  });
  if (!structRows.length) return { ok: true };

  const { data: savedStructs, error: structErr } = await s
    .from("garment_order_amendment_combo_structures")
    .insert(structRows)
    .select("id, combo_id, sno");
  if (structErr) return fail(structErr.message);

  // ---- level 3: components -------------------------------------------------
  const compRows: Record<string, unknown>[] = [];
  for (const row of (savedStructs ?? []) as { id: string; combo_id: string; sno: number }[]) {
    const src = structSrc.get(pairKey(row.combo_id, row.sno));
    if (!src) continue;
    let sno = 0;
    for (const c of src.components) {
      if (!componentFilled(c)) continue;
      sno += 1;
      compRows.push({
        structure_id: row.id,
        sno,
        coordinate_id: c.coordinate_id,
        component_id: c.component_id,
        color_name: clean(c.color_name),
        print_id: c.print_id,
        processed_as_trim: c.processed_as_trim,
      });
    }
  }
  if (!compRows.length) return { ok: true };

  const { error: compErr } = await s
    .from("garment_order_amendment_combo_components")
    .insert(compRows);
  if (compErr) return fail(compErr.message);

  return { ok: true };
}

/**
 * Strip child arrays so only header columns hit garment_order_amendments.
 *
 * **EVERY ARRAY ON `AmendmentInput` MUST APPEAR HERE**, and this list has now
 * fallen behind that schema twice: `style_sizes` and `style_processes` were
 * added to the input and to `writeChildren`'s insert table, and nobody came back
 * to this function — so both rode the spread into the header write and PostgREST
 * answered "Could not find the 'style_processes' column of
 * 'garment_order_amendments' in the schema cache" on the first save (client
 * 2026-08-19, creating an order).
 *
 * It fails LOUDLY, which is the one mercy: the insert is rejected outright
 * rather than silently dropping the children. But it fails at runtime on a real
 * save, and TypeScript cannot see it — a rest spread happily carries an extra
 * property, so nothing here goes red when the input grows.
 *
 * The pairing to remember: an array added to `amendmentInput` needs THREE edits,
 * not one — the Zod field, an entry in `writeChildren`'s `inserts` table (which
 * also drives the delete loop), and a line here. Checked by
 * `npm run check:amendment-header`.
 */
function headerOnly(data: AmendmentInput) {
  const {
    styles: _st,
    // Both of these are CHILD tables keyed off the styles above
    // (`garment_order_amendment_style_sizes` / `..._style_processes`), never
    // columns on the header. See the note above — they are why it exists.
    style_sizes: _ss,
    // 0461, and the fourth member of the same family.
    style_coordinates: _scoord,
    // 0467, and the fifth member of the same family.
    pack_components: _pc,
    // 0457, and the third member of the same family: the Style master's
    // component list, keyed off the styles above rather than a header column.
    style_components: _scomp,
    style_processes: _sp,
    dyeings: _dy,
    prints: _pr,
    structures: _sc,
    combos: _cb,
    price_details: _pd,
    approval_qtys: _aq,
    pack_types: _pt,
    // 0472, and the child of the pack types above rather than a header column.
    pack_type_lines: _ptl,
    // 0481 — the order's Time & Action ladder, a child table like every name
    // above it. See `taActivityRows`: its rows are merged rather than replaced.
    ta_activities: _ta,
    quantities: _qt,
    files: _files,
    // NOT A COLUMN HERE. `location_id` belongs to the `sales_orders` row this
    // document mints its SC No from; leaving it in the spread would send
    // PostgREST a column `garment_order_amendments` does not have.
    location_id: _loc,
    ...header
  } = data;
  void _loc;
  void _st;
  void _ss;
  void _scoord;
  void _scomp;
  void _sp;
  void _dy;
  void _pr;
  void _sc;
  void _cb;
  void _pd;
  void _aq;
  void _pt;
  void _ptl;
  void _ta;
  void _qt;
  return header;
}

export async function createAmendment(data: AmendmentInput): Promise<Result> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = amendmentInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  /* Requiredness that Zod cannot state: whether a part's Colour is mandatory
     depends on the PARENT structure's Fabric Type, and whether the part is
     checked at all depends on it having said something. Same shape, and the
     same reason, as `missingRequiredMaterialFields`. */
  const comboProblem = comboTreeProblem(p.data);
  if (comboProblem) return fail(comboProblem);
  /* Every style carries a document (0479 · client 2026-08-31). The screen
     deadens Save on the same predicate; this is the half `submit` cannot skip. */
  const fileProblem = styleFileProblem(p.data);
  if (fileProblem) return fail(fileProblem);
  /* The quantity double lock (client 2026-08-31). Same predicate the Details
     overlay's Done button and the dead Save read; this is the half a stale
     client or a direct post cannot skip. */
  const qtyProblem = qtyBalanceProblem(p.data);
  if (qtyProblem) return fail(qtyProblem);
  const s = await createClient();

  /**
   * MINT THE SC NO (client 2026-08-11).
   *
   * The SC No lives on `sales_orders.order_number` and is stamped by 0395's
   * `assign_order_number()` BEFORE INSERT trigger — the ONLY authority for it,
   * because the format and the April–March fiscal-year rule live in
   * `sales_order_no_format()` / `fiscal_year_segment()` and a second
   * implementation here would drift the moment either changed.
   *
   * So the order row is created first and its id becomes `sales_order_id`. A
   * document that already names one (an edit re-submitted, or a record made
   * while SCNo was still a picker) is left alone — this never re-numbers.
   *
   * NOT ATOMIC: two PostgREST calls, no transaction. If the document insert
   * below fails we delete the order we just made, so a failed save cannot leave
   * a numbered order with nothing attached. The COUNTER is not rolled back and
   * that is deliberate — 0395's rule is that gaps are cheaper than duplicates.
   * The correct end state is one plpgsql RPC doing both inserts; this is the
   * honest version until there is one.
   */
  let salesOrderId = p.data.sales_order_id;
  let mintedOrderId: string | null = null;
  if (!salesOrderId) {
    // The Unit is only mandatory on THIS branch — it is what the counter is
    // keyed by. Checked here rather than in the schema so an edit of a document
    // whose order predates per-location numbering stays saveable; see the note
    // on `location_id` in types.ts.
    if (!p.data.location_id) {
      return fail("Unit is required — the SC No is numbered under it.");
    }
    const { data: order, error: orderErr } = await s
      .from("sales_orders")
      .insert({
        // NO PARTY ON THE SHELL (0404). This row exists only so 0395's trigger
        // stamps the SC No; the party is a CUSTOMER and lives on the amendment.
        // `sales_orders.buyer_id` still references `buyers` — ~20 services embed
        // it through the order — so a customer uuid here would be rejected, and
        // inventing a buyer to satisfy the column would be worse. 0404 made it
        // nullable for exactly this insert.
        location_id: p.data.location_id,
        // Decides which fiscal year the SC No numbers into, so a back-dated
        // order files under the previous year. Sent explicitly: what the
        // operator saw in the header must be what the number is built from.
        order_date: p.data.amend_date,
        currency_code: p.data.currency_code,
        ship_date: p.data.delivery_date,
        /**
         * THE MERCHANDISER IS NO LONGER MIRRORED (0478), and this is the same
         * move 0404 made for the party a few lines down.
         *
         * `garment_order_amendments.merchandiser_id` is an `employees` row from
         * 2026-08-31 — a member of HR staff. `sales_orders.merchandiser_id`
         * still references `profiles`, because it is a LOGIN: 0006 defaults it
         * to `auth.uid()` and `sync_order_channel_members` (0458) seeds the
         * order's discussion channel with it as a `user_id`. Writing one into
         * the other is the FK rejection the repoint exists to avoid, and it
         * would have failed EVERY save from the moment 0478 applied.
         *
         * Omitting the key rather than sending null is what keeps the default
         * working: PostgREST applies a column default only for an ABSENT key, so
         * the order is owned by whoever saved it — which is exactly what the
         * channel wants and what this column has always meant. The two
         * questions now have two columns, which is the point.
         */
      })
      .select("id")
      .single();
    if (orderErr || !order) {
      return fail(orderErr?.message ?? "Could not create the order number");
    }
    salesOrderId = order.id;
    mintedOrderId = order.id;
  }

  const { data: created, error } = await s
    .from("garment_order_amendments")
    .insert({ ...headerOnly(p.data), sales_order_id: salesOrderId })
    .select("id")
    .single();
  if (error || !created) {
    if (mintedOrderId) await s.from("sales_orders").delete().eq("id", mintedOrderId);
    return fail(error?.message ?? "Failed to create garment order");
  }
  const childRes = await writeChildren(s, created.id, p.data);
  if (!childRes.ok) return childRes;
  await writeAudit({
    action: "garment_order_amendment.created",
    entityType: "garment_order_amendment",
    entityId: created.id,
  });
  rev();
  return { ok: true };
}

export async function updateAmendment(
  id: string,
  data: AmendmentInput,
): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("Forbidden");
  const p = amendmentInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  /* Requiredness that Zod cannot state: whether a part's Colour is mandatory
     depends on the PARENT structure's Fabric Type, and whether the part is
     checked at all depends on it having said something. Same shape, and the
     same reason, as `missingRequiredMaterialFields`. */
  const comboProblem = comboTreeProblem(p.data);
  if (comboProblem) return fail(comboProblem);
  /* Every style carries a document (0479 · client 2026-08-31). The screen
     deadens Save on the same predicate; this is the half `submit` cannot skip. */
  const fileProblem = styleFileProblem(p.data);
  if (fileProblem) return fail(fileProblem);
  /* The quantity double lock (client 2026-08-31). Same predicate the Details
     overlay's Done button and the dead Save read; this is the half a stale
     client or a direct post cannot skip. */
  const qtyProblem = qtyBalanceProblem(p.data);
  if (qtyProblem) return fail(qtyProblem);
  const s = await createClient();
  /**
   * NEVER BLANK THE ORDER LINK. `sales_order_id` is nullable on input because a
   * CREATE cannot supply it (the SC No does not exist yet) — but an update
   * carrying null would clear a stored FK and orphan the document from its own
   * number. Drop the key rather than send it.
   */
  const { sales_order_id, ...patch } = headerOnly(p.data);
  const { error } = await s
    .from("garment_order_amendments")
    .update(sales_order_id ? { ...patch, sales_order_id } : patch)
    .eq("id", id);
  if (error) return fail(error.message);

  /**
   * Mirror the few header fields `sales_orders` also holds, or All Orders shows
   * a ship date the document no longer agrees with. Deliberately short, and it
   * never touches `location_id`, `order_date` or `order_number` — all three feed
   * the minted SC No, and re-numbering a saved order is not a thing this screen
   * may do.
   *
   * THE PARTY IS NO LONGER MIRRORED (0404). It is a `customers` row now, and
   * `sales_orders.buyer_id` references `buyers`; writing one into the other is
   * the FK rejection this repoint exists to avoid. The shell keeps a null buyer.
   *
   * NOR IS THE MERCHANDISER (0478), for exactly the same reason one repoint
   * later: this document's merchandiser is an `employees` row from 2026-08-31,
   * and `sales_orders.merchandiser_id` references `profiles` because it is a
   * LOGIN — `sync_order_channel_members` (0458) seeds a chat member from it.
   * Sending an employees uuid here would have failed every update the moment
   * 0478 applied. The order keeps the owner it was created with, which is what
   * that column has always meant. See the create path above.
   */
  if (sales_order_id) {
    await s
      .from("sales_orders")
      .update({
        currency_code: p.data.currency_code,
        ship_date: p.data.delivery_date,
      })
      .eq("id", sales_order_id);
  }

  const childRes = await writeChildren(s, id, p.data);
  if (!childRes.ok) return childRes;
  await writeAudit({
    action: "garment_order_amendment.updated",
    entityType: "garment_order_amendment",
    entityId: id,
  });
  rev();
  return { ok: true };
}

/**
 * Read the order the operator just picked and shape it into the eight child
 * tabs, so the amendment starts as the order STANDS and they edit the deltas.
 *
 * A separate action rather than part of `getAmendmentFormData` because it is
 * per-order and on-demand — seeding every order's children into the initial
 * page payload would load the whole Orders module to fill one screen.
 *
 * Reads only: gated on `view`, and no `rev()` — there is nothing to revalidate.
 */
export type SeedResult =
  | { ok: true; seed: SeededAmendmentChildren }
  | { ok: false; error: string };

// `fail()` returns the write-side `Result`, whose success branch carries no
// payload — reusing it here would not narrow to the error case.
const seedFail = (error: string): SeedResult => ({ ok: false, error });

export async function loadOrderSeed(salesOrderId: string): Promise<SeedResult> {
  if (!(await can("orders", "view"))) return seedFail("Forbidden");
  if (!salesOrderId) return seedFail("No order selected");
  try {
    return { ok: true, seed: await seedAmendmentFromOrder(salesOrderId) };
  } catch (e) {
    // The screen leaves the tabs untouched on a failure rather than half-filling
    // them, so the message is the only signal the operator gets.
    return seedFail(e instanceof Error ? e.message : "Could not read the order");
  }
}

export async function deleteAmendment(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s
    .from("garment_order_amendments")
    .delete()
    .eq("id", id); // children cascade
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
