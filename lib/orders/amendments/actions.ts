"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { amendmentInput, type AmendmentInput } from "./types";
import { normalizeFileRows } from "./file-rows";
import {
  seedAmendmentFromOrder,
  styleKey,
  type SeededAmendmentChildren,
} from "./order-seed";
import { componentProblems } from "./combo-rules";

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
  return data.style_components
    .map((r) => ({
      style_ref_no: clean(r.style_ref_no),
      coordinate_id: r.coordinate_id,
      component_id: r.component_id,
      fabric_category_id: r.fabric_category_id,
      comp_type: clean(r.comp_type),
      item_id: r.item_id,
    }))
    .filter((r) => r.coordinate_id || r.component_id || r.fabric_category_id)
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
function normalizeFiles(data: AmendmentInput) {
  return normalizeFileRows(data.files);
}

function normalizePrints(data: AmendmentInput) {
  return data.prints
    .map((r) => ({ print_id: r.print_id }))
    .filter((r) => r.print_id)
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

/** Does this structure row say anything at all? */
function structureFilled(r: AmendmentInput["combos"][number]["structures"][number]) {
  return (
    r.structure_id ||
    r.fabric_type ||
    r.composition_id ||
    r.gsm ||
    r.gsm_tolerance ||
    r.item_sub_type ||
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
 * Colour clause — required only where the fabric's type gives the cell a
 * palette — cannot be stated one way here and another way there.
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

function normalizeQuantities(data: AmendmentInput) {
  return data.quantities
    .map((r) => ({
      country_id: r.country_id ?? null,
      style_ref_no: clean(r.style_ref_no),
      style_no: clean(r.style_no),
      consignee_id: r.consignee_id ?? null,
      assortment_type_id: r.assortment_type_id ?? null,
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
        r.ratio_for ||
        r.master_carton_name ||
        r.inner_carton_name ||
        r.pack_description,
    )
    .map((r, i) => ({ ...r, sno: i + 1 }));
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

  const inserts: [string, Record<string, unknown>[]][] = [
    ["garment_order_amendment_styles", styleRows],
    // AFTER the styles it depends on, though the order of this list only
    // decides the order of the writes — the dependency is resolved above, by
    // handing `normalizeStyleSizes` the very rows being inserted.
    ["garment_order_amendment_style_sizes", normalizeStyleSizes(data, styleRows)],
    // What a component is a part of (0461). Same dependency and the same
    // resolution as the sizes above: handed the rows being inserted.
    ["garment_order_amendment_style_coordinates", normalizeStyleCoordinates(data, styleRows)],
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
    ["garment_order_amendment_pack_types", normalizePackTypes(data)],
    // THIS LIST DRIVES THE DELETE LOOP AS WELL AS THE INSERTS. An entry added
    // only to the insert side would leave the previous rows in place and add
    // the new ones beside them, doubling the grid on every save.
    ["garment_order_amendment_quantities", normalizeQuantities(data)],
    /* The attached documents (0416). METADATA ONLY — the delete below drops
       rows, never objects, and that asymmetry is deliberate: the file uploads
       the moment it is chosen and the row is written on Save, so a delete that
       reached into the bucket would make Cancel destroy a file the operator may
       have no other copy of. Orphaned objects accumulate instead, which
       `file-attachments.tsx` records as a known, accepted remainder. */
    ["garment_order_amendment_files", normalizeFiles(data)],
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
      structRows.push({
        combo_id: comboId,
        sno,
        structure_id: st.structure_id,
        fabric_type: clean(st.fabric_type),
        composition_id: st.composition_id,
        gsm: st.gsm,
        gsm_tolerance: st.gsm_tolerance,
        item_sub_type: clean(st.item_sub_type),
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
        // Spread, not `merchandiser_id: … ?? null`. The column defaults to
        // `auth.uid()`, and PostgREST applies a default only for an ABSENT key —
        // sending an explicit null would override it and leave the order with no
        // merchandiser whenever the operator named none.
        ...(p.data.merchandiser_id ? { merchandiser_id: p.data.merchandiser_id } : {}),
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
   */
  if (sales_order_id) {
    await s
      .from("sales_orders")
      .update({
        currency_code: p.data.currency_code,
        ship_date: p.data.delivery_date,
        merchandiser_id: p.data.merchandiser_id,
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
