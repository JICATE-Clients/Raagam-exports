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

/** One item line as these rules read it. Numbers may be NaN (typed text). */
export type IwoMbLineFacts = {
  category_id: string | null;
  item_id: string | null;
  specification: string | null;
  item_color_id: string | null;
  consumption_uom_id: string | null;
  purchase_uom_id: string | null;
  uom_conversion_id: string | null;
  planned_qty: number | null;
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

export const isBlankIwoMbLine = (l: IwoMbLineFacts): boolean =>
  !l.category_id &&
  !l.item_id &&
  !l.specification?.trim() &&
  !l.item_color_id &&
  l.planned_qty == null &&
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
    if (l.planned_qty == null) out.push({ section: "items", message: `${at}: enter the Planned Qty.` });
    else if (!(l.planned_qty > 0)) out.push({ section: "items", message: `${at}: Planned Qty must be a number more than 0.` });
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
  if (line.planned_qty == null || !(line.planned_qty > 0)) return { refused: "Enter the Planned Qty" };

  const lossRows: ProcessLossRow[] = processLoss.map((p, i) => ({
    row_uid: null,
    prev_row_uid: null,
    sno: i + 1,
    loss_pct: p.loss_pct,
  }));
  const required = requiredWithProcessLoss(line.planned_qty, lossRows, cons.code, cons.decimal_places_allowed);
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
