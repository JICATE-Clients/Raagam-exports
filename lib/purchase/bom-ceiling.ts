/**
 * "How much of this material did the Material BOM plan for this order?"
 *
 * The ceiling behind the over-quantity control (0424). The client's rule: a
 * Purchase Order should not quietly exceed the quantity the BOM calculated —
 * "the BOM acts as the Quantity Controller, preventing over-purchasing of
 * accessories".
 *
 * CLIENT-SAFE, and the fetch lives next door in `bom-ceiling-service.ts`.
 * The same split `style-processes.ts` uses: the verdict is read as the
 * operator types a quantity, so it has to run in the browser, while the
 * lookup needs the Supabase client. One rule, two homes, and the rule is the
 * half both sides share.
 *
 * ## FOUR THINGS THE LOOKUP GETS RIGHT, AND EACH IS A WAY TO BE WRONG
 *
 * **The LATEST BOM, not every BOM.** `amendment_no` is a per-order counter and
 * a second document is how a BOM is revised (0265) — nothing is carried forward
 * and nothing is diffed. So summing every amendment's requirements would add
 * revision 1 to revision 2 and produce a ceiling twice the real one, which is a
 * control that permits exactly what it exists to prevent.
 *
 * **Drafts do not count.** A draft BOM is someone's half-entered thinking; its
 * numbers are not a plan anyone has agreed to. Same call `listMaterialBomTasks`
 * makes for the work queue.
 *
 * **PURCHASE quantity, not consumption.** `required_qty` is in the consumption
 * UOM and `purchase_qty` is the same requirement converted to the UOM the
 * material is bought in (0418). A PO is written in the purchase UOM, so
 * comparing against `required_qty` would compare metres with rolls — a number
 * that looks like a comparison and is not. Falls back to `required_qty` only
 * when no conversion was declared, in which case the two are the same figure.
 *
 * **A refusal is not a zero.** A requirement row carries `required_qty` OR
 * `refusal_reason`, never both (0418's CHECK). A refused row means the BOM could
 * not answer — a combo declared but unquantified, a rejection tier with a gap —
 * and treating it as 0 would produce a ceiling of zero that flags every PO line
 * as an overage. Refused rows are skipped, and `unanswered` says how many were,
 * so the caller can decline to judge rather than judge wrongly.
 */

export type BomCeiling = {
  /** Planned purchase quantity per `items.id`. Absent = the BOM plans none. */
  byItem: Map<string, number>;
  /** The BOM this came from, for the confirmation's audit trail. */
  bomId: string | null;
  bomCode: string | null;
  /**
   * Requirement rows that could not answer. Non-zero means the ceiling is
   * INCOMPLETE — the caller should say so rather than flag an overage it cannot
   * stand behind.
   */
  unanswered: number;
};

/**
 * What a PO line is, as far as the ceiling is concerned.
 *
 * `salesOrderId` or `itemId` being null is NOT an error — it is general stock
 * purchasing, or a line describing something the item master does not hold.
 * Those are simply not checked. A control that refused what it cannot measure
 * would stop ordinary buying, which is the failure this warning shape was chosen
 * over a hard block to avoid.
 */
export type CeilingVerdict =
  | { kind: "unchecked"; why: string }
  | { kind: "within"; planned: number; ordered: number }
  | { kind: "over"; planned: number; ordered: number; variance: number };

export function judgeLine(
  ceiling: BomCeiling,
  line: { itemId: string | null; quantity: number },
): CeilingVerdict {
  if (!line.itemId) return { kind: "unchecked", why: "No material named on this line" };
  if (!ceiling.bomId) return { kind: "unchecked", why: "This order has no recorded Material BOM" };

  const planned = ceiling.byItem.get(line.itemId);
  if (planned === undefined) {
    return { kind: "unchecked", why: "The BOM plans none of this material for this order" };
  }
  if (ceiling.unanswered > 0) {
    return {
      kind: "unchecked",
      why: `The BOM could not calculate ${ceiling.unanswered} of its lines — the plan is incomplete`,
    };
  }

  const ordered = Number.isFinite(line.quantity) ? line.quantity : 0;
  return ordered > planned
    ? { kind: "over", planned, ordered, variance: ordered - planned }
    : { kind: "within", planned, ordered };
}
