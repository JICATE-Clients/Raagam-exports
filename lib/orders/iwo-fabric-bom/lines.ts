/**
 * IWO Fabric BOM — the fabric-line rules, ONCE (step 2: Fabric Allocation +
 * Fabric Consumption).
 *
 * Pure functions, no server imports: the screen reads them for its Save gate
 * and the action reads them again before it writes — the
 * `iwo-material-bom/rules.ts` shape too, so a Save button can never allow what
 * the server then refuses.
 *
 * ## WHAT A LINE OWES, AND WHY EACH
 *
 *   - **Fabric** — the line IS a fabric; everything downstream (the Fabric
 *     Process route, the Yarn Process blend split) is keyed to `item_id`.
 *   - **Stage** — the state the cloth is required in (GREIGE / DYED …). The
 *     IWO screen's own fabric grid already makes it mandatory; the copy must
 *     not be laxer than the screen it replaces.
 *   - **Req Wt (KGS)** — SRS §4: on an IWO the weight is TYPED, because the
 *     garment breakdown that computes it on an order is bypassed. A line with
 *     no weight plans nothing.
 *   - **Mixing Uom on a yarn-dyed cloth** — the order screen's rule, called
 *     through `missingFabricLineFields` rather than restated, so the two
 *     screens cannot disagree about what a yarn-dyed line owes.
 *
 * `No Of Colors`, Colour, Form, GSM and Finish Dia are OFFERED, never demanded
 * — the order screen's reading of the same columns.
 */

import { missingFabricLineFields } from "@/lib/orders/fabric-bom/fabric-line-rules";

/** A line as the rules read it. Numbers may be NaN — a typed non-number —
 *  which is refused by name rather than read as blank. */
export type IwoFabricLineFacts = {
  structure_id: string | null;
  item_id: string | null;
  color_name?: string | null;
  fabric_form: string | null;
  mixing_uom_id: string | null;
  no_of_colors: number | null;
  gsm: number | null;
  finish_dia?: string | null;
  stage_id: string | null;
  req_kgs: number | null;
};

export type IwoFabricLineField =
  | "item_id"
  | "stage_id"
  | "req_kgs"
  | "gsm"
  | "no_of_colors"
  | "mixing_uom_id";

export type IwoFabricLineProblem = {
  /** Position in the grid AS SENT, blank rows included — the S No the
   *  operator sees beside the row. */
  row: number;
  field: IwoFabricLineField;
  /** Which section of the screen shows the field. */
  section: "lines" | "consumption";
  message: string;
};

/**
 * THE BLANK-ROW FILTER TESTS ONLY WHAT THE OPERATOR TYPES (AGENTS.md, default
 * rows). The grid seeds one blank row and it reaches the action; every clause
 * below is a field the seed leaves empty, so an untouched row is dropped
 * rather than stored as a phantom line.
 */
export const isBlankIwoFabricLine = (l: IwoFabricLineFacts): boolean =>
  !l.structure_id &&
  !l.item_id &&
  !l.color_name?.trim() &&
  !l.fabric_form &&
  !l.mixing_uom_id &&
  l.no_of_colors == null &&
  l.gsm == null &&
  !l.finish_dia?.trim() &&
  !l.stage_id &&
  l.req_kgs == null;

export function keptIwoFabricLines<T extends IwoFabricLineFacts>(lines: readonly T[]): T[] {
  return lines.filter((l) => !isBlankIwoFabricLine(l));
}

/**
 * Everything stopping a save, in screen order. `fabricTypeOf` resolves a
 * fabric's Solid / Melange / Yarn Dyed name — the SCREEN reads it off the
 * loaded master, the ACTION off `items` again, never off the payload.
 */
export function iwoFabricLineProblems(
  lines: readonly IwoFabricLineFacts[],
  fabricTypeOf: (itemId: string) => string | null,
): IwoFabricLineProblem[] {
  const out: IwoFabricLineProblem[] = [];
  lines.forEach((l, i) => {
    if (isBlankIwoFabricLine(l)) return;
    const row = i + 1;
    const need = (
      field: IwoFabricLineField,
      section: IwoFabricLineProblem["section"],
      message: string,
    ) => out.push({ row, field, section, message: `Fabric line ${row}: ${message}` });

    if (!l.item_id) {
      need("item_id", "lines", "choose the fabric.");
      // Nothing else on the line can be judged without the cloth.
      return;
    }
    for (const p of missingFabricLineFields(l, fabricTypeOf(l.item_id))) {
      need(p.field, "lines", `${p.message}.`);
    }
    if (l.no_of_colors != null && !(Number.isInteger(l.no_of_colors) && l.no_of_colors >= 1 && l.no_of_colors <= 99)) {
      need("no_of_colors", "lines", "No Of Colors must be a whole number from 1 to 99.");
    }
    if (!l.stage_id) need("stage_id", "consumption", "choose the Stage.");
    if (l.gsm != null && !(l.gsm > 0)) need("gsm", "consumption", "GSM must be a number more than 0.");
    if (l.req_kgs == null) need("req_kgs", "consumption", "enter the Req Wt (KGS).");
    else if (!(l.req_kgs > 0)) need("req_kgs", "consumption", "Req Wt must be a number more than 0.");
  });
  return out;
}

// ---------------------------------------------------------------------------
// For = Yarn (step 4) — the Yarn Lines grid
// ---------------------------------------------------------------------------

/**
 * A yarn line on a For = Yarn BOM (screenshot 2937): the yarn, the stage it is
 * BOUGHT in (GREY / DYED), and the Planned Weight typed. Its process stages
 * are Yarn Process's, and a line with only stages typed still counts as
 * started — it is the operator's work, not a seeded blank.
 */
export type IwoYarnLineFacts = {
  item_id: string | null;
  buy_stage_id: string | null;
  planned_kgs: number | null;
  hasStages?: boolean;
};

export const isBlankIwoYarnLine = (l: IwoYarnLineFacts): boolean =>
  !l.item_id && !l.buy_stage_id && l.planned_kgs == null && !l.hasStages;

export function keptIwoYarnLines<T extends IwoYarnLineFacts>(lines: readonly T[]): T[] {
  return lines.filter((l) => !isBlankIwoYarnLine(l));
}

export type IwoYarnLineProblem = { row: number; message: string };

/**
 * What a kept yarn line owes: the yarn, its buy stage (GREY or DYED — it
 * decides what is purchased), and a weight above 0. At least one line: a
 * For = Yarn BOM with no yarn plans nothing. A yarn listed twice is refused
 * here rather than by the unique index, naming the rows.
 */
export function iwoYarnLineProblems(lines: readonly IwoYarnLineFacts[]): IwoYarnLineProblem[] {
  const out: IwoYarnLineProblem[] = [];
  const firstRowOf = new Map<string, number>();
  let kept = 0;
  lines.forEach((l, i) => {
    if (isBlankIwoYarnLine(l)) return;
    kept++;
    const row = i + 1;
    const at = `Yarn line ${row}`;
    if (!l.item_id) out.push({ row, message: `${at}: choose the yarn.` });
    else {
      const first = firstRowOf.get(l.item_id);
      if (first) out.push({ row, message: `${at}: this yarn is already on line ${first} — plan it once.` });
      else firstRowOf.set(l.item_id, row);
    }
    if (!l.buy_stage_id) out.push({ row, message: `${at}: choose the stage it is bought in.` });
    if (l.planned_kgs == null) out.push({ row, message: `${at}: enter the Planned Weight (KGS).` });
    else if (!(l.planned_kgs > 0)) out.push({ row, message: `${at}: Planned Weight must be a number more than 0.` });
  });
  if (!kept) out.push({ row: 0, message: "Add at least one yarn." });
  return out;
}
