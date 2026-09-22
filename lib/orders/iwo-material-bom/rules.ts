/**
 * IWO Material BOM — the line rules and the quantity chain, ONCE (0584).
 *
 * Pure: the screen previews with these and the action stores with them, so the
 * figure the planner approves is the figure written.
 *
 * ## THE CHAIN IS THE ORDER MATERIAL BOM'S, WITH ONE LINK REPLACED
 *
 * On an order the need is EXPLODED (pieces × items per piece × wastage). On an
 * IWO it is TYPED — Planned Qty (SRS §5). Everything after that is the order
 * screen's own functions, unchanged:
 *
 *   Planned Qty (consumption unit)
 *     × (1 + loss%) per process        `requiredWithProcessLoss` — MULTIPLIES
 *       (client 2026-09-19: the order Material BOM's rule, not the fabric divide)
 *     → the purchase pack               `resolveLinePack` + `toPurchaseQty` (exact
 *       decimals, 16.67 Gross — the client's choice, recorded in lib/uom/convert)
 *     → MOQ, then Round To              `roundUpTo` — "Order needs → pack → MOQ →
 *       round → Final", the order screen's ribbon
 *
 * ## THE BLANK-ROW FILTER TESTS ONLY WHAT THE OPERATOR TYPES
 *
 * Every seeded default is `""`, `null` or `false` (AGENTS.md, "Editable
 * sub-tables open with a row"). `is_advised`, `send_out` and `is_foc` start
 * false, so only the operator's own tick makes them true — which is exactly
 * "something was entered". The units are filled when a MATERIAL is picked
 * (`uomPatchForMaterial`), never at seed, so they are not clauses.
 */

import { requiredWithProcessLoss, type ProcessLossRow } from "@/lib/orders/material-bom/process-loss";
import { resolveLinePack, type PackRow } from "@/lib/orders/material-bom/pack-resolve";
import { isRefusal, roundUpTo, type Refusal } from "@/lib/orders/material-bom/requirement";
import { toPurchaseQty } from "@/lib/uom/convert";
import { attributeHasColour, attributeHasSize, IWO_MB_ATTRIBUTE_LABELS, type IwoMbAttribute } from "./types";

/** One item line as these rules read it. Numbers may be NaN (typed text). */
/** One breakup row as the rules read it (0614). */
export type IwoMbSliceFacts = {
  item_color_id: string | null;
  size: string | null;
  planned_qty: number | null;
};

export type IwoMbLineFacts = {
  category_id: string | null;
  item_id: string | null;
  specification: string | null;
  item_color_id: string | null;
  consumption_uom_id: string | null;
  purchase_uom_id: string | null;
  uom_conversion_id: string | null;
  /** The line's own figure — read only under `attribute = item`; see `plannedQtyOf`. */
  planned_qty: number | null;
  /** 0614. Absent on a caller written before it means `item`. */
  attribute?: IwoMbAttribute;
  slices?: readonly IwoMbSliceFacts[];
  moq: number | null;
  round_to: number | null;
  is_advised: boolean;
  send_out: boolean;
  is_foc: boolean;
};

/** One process row as these rules read it. */
export type IwoMbProcessFacts = {
  item_id: string | null;
  stage: string | null;
  process_id: string | null;
  loss_pct: number | null;
  vendor_id: string | null;
};

/** A breakup row nobody typed on — dropped by the save, never counted. */
export const isBlankIwoMbSlice = (s: IwoMbSliceFacts): boolean =>
  !s.item_color_id && !s.size?.trim() && s.planned_qty == null;

/** The rows that count — `slices` minus the blanks (0614). */
export const keptIwoMbSlices = <T extends IwoMbSliceFacts>(rows: readonly T[] | undefined): T[] =>
  (rows ?? []).filter((s) => !isBlankIwoMbSlice(s));

/**
 * THE LINE'S PLANNED QTY — ITS OWN FIGURE, OR THE SUM OF ITS BREAKUP (0614).
 *
 * One reader for the four consumers that need it (the rules below, the quantity
 * chain, the save, the screen's read-only cell), so a line broken up by colour
 * can never be costed on a stale figure typed before it was. Under `item` the
 * typed figure is the answer; otherwise Σ of the kept rows — and NULL while no
 * row carries a quantity, so "enter the Planned Qty" still fires rather than a
 * 0 reading as an answer.
 */
export function plannedQtyOf(l: IwoMbLineFacts): number | null {
  const attribute = l.attribute ?? "item";
  if (attribute === "item") return l.planned_qty;
  const rows = keptIwoMbSlices(l.slices).filter((s) => s.planned_qty != null);
  if (rows.length === 0) return null;
  return Number(rows.reduce((a, s) => a + (s.planned_qty as number), 0).toFixed(4));
}

export const isBlankIwoMbLine = (l: IwoMbLineFacts): boolean =>
  !l.category_id &&
  !l.item_id &&
  !l.specification?.trim() &&
  !l.item_color_id &&
  l.planned_qty == null &&
  (l.attribute ?? "item") === "item" &&
  keptIwoMbSlices(l.slices).length === 0 &&
  l.moq == null &&
  l.round_to == null &&
  !l.is_advised &&
  !l.send_out &&
  !l.is_foc;

export const isBlankIwoMbProcess = (p: IwoMbProcessFacts): boolean =>
  !p.item_id && !p.stage && !p.process_id && p.loss_pct == null && !p.vendor_id;

export function keptIwoMbLines<T extends IwoMbLineFacts>(lines: readonly T[]): T[] {
  return lines.filter((l) => !isBlankIwoMbLine(l));
}

export function keptIwoMbProcesses<T extends IwoMbProcessFacts>(rows: readonly T[]): T[] {
  return rows.filter((p) => !isBlankIwoMbProcess(p));
}

export type IwoMbProblem = { section: "items" | "processes"; message: string };

/**
 * Everything stopping a save. Positions are the grid's own S No, counted over
 * the rows AS SENT, blank ones included — the number beside the row.
 *
 * What a kept line owes: the material, the unit its Planned Qty is in, and a
 * Planned Qty above 0 — the three the chain cannot start without. At least one
 * line: a Material BOM with no accessory plans nothing.
 */
export function iwoMbProblems(
  lines: readonly IwoMbLineFacts[],
  processes: readonly IwoMbProcessFacts[],
): IwoMbProblem[] {
  const out: IwoMbProblem[] = [];
  let kept = 0;
  lines.forEach((l, i) => {
    if (isBlankIwoMbLine(l)) return;
    kept++;
    const at = `Line ${i + 1}`;
    if (!l.item_id) out.push({ section: "items", message: `${at}: choose the material.` });
    if (!l.consumption_uom_id) out.push({ section: "items", message: `${at}: choose the Cons. Uom (the unit Planned Qty is in).` });
    const attribute = l.attribute ?? "item";
    if (attribute === "item") {
      if (l.planned_qty == null) out.push({ section: "items", message: `${at}: enter the Planned Qty.` });
      else if (!(l.planned_qty > 0)) out.push({ section: "items", message: `${at}: Planned Qty must be a number more than 0.` });
    } else {
      /* THE BREAKUP (0614): every kept row owes a quantity, and a Size where
         its attribute names one; two rows of one (colour, size) would be one
         lot typed twice. A breakup with no rows is a line with no Planned Qty,
         said in the breakup's words.

         THE COLOUR IS NEVER OWED — THE IWO EXCEPTION (client spec 2026-09-22).
         On the order Material BOM a colour-wise row must name its Item Color
         (`colour-required.ts`); an IWO books advance trims — cartons, polybags,
         raw thread, an un-dyed button — weeks before the buyer's shades are
         approved, so a colour-wise row with no colour yet is the ordinary
         case, not an unanswered one (the SRS's own "PENDING SHADE" line). The
         column is still drawn only under a colour-wise attribute; it is just
         not starred, not held and not refused. A blank colour is therefore
         also outside the duplicate test: two pending rows may be two colours
         not yet fixed, and refusing them would force a guess. */
      const label = IWO_MB_ATTRIBUTE_LABELS[attribute];
      const rows = keptIwoMbSlices(l.slices);
      if (rows.length === 0) {
        out.push({ section: "items", message: `${at}: ${label} — add at least one row under the line, with its Planned Qty.` });
      }
      const seen = new Set<string>();
      rows.forEach((s, j) => {
        const row = `${at}, ${label} row ${j + 1}`;
        if (attributeHasSize(attribute) && !s.size?.trim()) out.push({ section: "items", message: `${row}: enter the Size.` });
        if (s.planned_qty == null) out.push({ section: "items", message: `${row}: enter the Planned Qty.` });
        else if (!(s.planned_qty > 0)) out.push({ section: "items", message: `${row}: Planned Qty must be a number more than 0.` });
        const key = `${attributeHasColour(attribute) ? (s.item_color_id ?? "") : ""}|${attributeHasSize(attribute) ? (s.size ?? "").trim().toUpperCase() : ""}`;
        if ((attributeHasColour(attribute) ? s.item_color_id : true) && (attributeHasSize(attribute) ? s.size?.trim() : true)) {
          if (seen.has(key)) out.push({ section: "items", message: `${row}: this ${label.toLowerCase().replace(/ wise$/, "")} is already on another row — merge them.` });
          seen.add(key);
        }
      });
    }
    if (l.moq != null && !(l.moq >= 0)) out.push({ section: "items", message: `${at}: MOQ must be a number, 0 or more.` });
    if (l.round_to != null && !(l.round_to > 0)) out.push({ section: "items", message: `${at}: Round To must be a number more than 0.` });
  });
  if (!kept) out.push({ section: "items", message: "Add at least one accessory." });

  const onBom = new Set(keptIwoMbLines(lines).map((l) => l.item_id).filter(Boolean));
  processes.forEach((p, i) => {
    if (isBlankIwoMbProcess(p)) return;
    const at = `Process row ${i + 1}`;
    if (!p.item_id) out.push({ section: "processes", message: `${at}: choose the material it is for.` });
    else if (!onBom.has(p.item_id)) out.push({ section: "processes", message: `${at}: that material is no longer on the Items list.` });
    if (!p.process_id) out.push({ section: "processes", message: `${at}: choose the process.` });
    if (p.loss_pct != null && !(p.loss_pct >= 0 && p.loss_pct < 100))
      out.push({ section: "processes", message: `${at}: Loss % must be 0 or more and below 100.` });
  });
  return out;
}

export type UomFacts = { id: string; code: string | null; decimal_places_allowed: number | null };

export type IwoMbQuantity = {
  /** Planned × (1 + loss%), in the consumption unit. */
  required: number;
  /** `required` in the purchase pack, then MOQ, then Round To. */
  purchase: number;
  /** The purchase unit the figure is in (the consumption unit when no pack). */
  purchase_uom_id: string;
  /** The pack used, when one was — stored so a later master edit cannot move it. */
  uom_conversion_id: string | null;
};

/**
 * THE CHAIN, for one line. Refuses by name rather than guessing: no unit, no
 * weight, or a purchase unit the material has no pack conversion into.
 */
export function iwoMbQuantity<C extends PackRow>(
  line: IwoMbLineFacts,
  processLoss: readonly { loss_pct: number | null }[],
  uoms: ReadonlyMap<string, UomFacts>,
  conversions: readonly C[],
): IwoMbQuantity | Refusal {
  if (!line.item_id) return { refused: "Choose the material" };
  const cons = line.consumption_uom_id ? uoms.get(line.consumption_uom_id) : undefined;
  if (!cons) return { refused: "Choose the Cons. Uom — the unit Planned Qty is in" };
  // The line's own figure, or Σ its breakup (0614) — one reader, `plannedQtyOf`.
  const planned = plannedQtyOf(line);
  if (planned == null || !(planned > 0)) {
    return { refused: (line.attribute ?? "item") === "item" ? "Enter the Planned Qty" : "Enter the Planned Qty on each row under the line" };
  }

  const lossRows: ProcessLossRow[] = processLoss.map((p, i) => ({
    row_uid: null,
    prev_row_uid: null,
    sno: i + 1,
    loss_pct: p.loss_pct,
  }));
  const required = requiredWithProcessLoss(planned, lossRows, cons.code, cons.decimal_places_allowed);
  if (isRefusal(required)) return required;

  // No purchase unit, or the same one: the pack is 1 : 1.
  let purchase = required;
  let purchaseUomId = cons.id;
  let conversionId: string | null = null;
  if (line.purchase_uom_id && line.purchase_uom_id !== cons.id) {
    const pur = uoms.get(line.purchase_uom_id);
    const { pack, usable } = resolveLinePack(
      {
        item_id: line.item_id,
        purchase_uom_id: line.purchase_uom_id,
        consumption_uom_id: cons.id,
        uom_conversion_id: line.uom_conversion_id,
      },
      conversions,
    );
    if (!pack || !usable) {
      return {
        refused: `This material has no pack conversion from ${pur?.code ?? "the purchase unit"} to ${cons.code ?? "the Cons. Uom"} — add one on the material master, or buy in ${cons.code ?? "the Cons. Uom"}`,
      };
    }
    const q = toPurchaseQty(required, pack, pur?.decimal_places_allowed ?? 2);
    if (q == null) return { refused: "The material's pack conversion has no usable quantities" };
    purchase = q;
    purchaseUomId = line.purchase_uom_id;
    conversionId = pack.id;
  }

  if (line.moq != null && line.moq > 0) purchase = Math.max(purchase, line.moq);
  purchase = roundUpTo(purchase, line.round_to);
  return { required, purchase, purchase_uom_id: purchaseUomId, uom_conversion_id: conversionId };
}
