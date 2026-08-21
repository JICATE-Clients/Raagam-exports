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
  /**
   * THE FINAL QUANTITY per `items.id` — the figure the BOM's own grid shows in
   * its last column, with the MOQ and the Round To step already applied. Absent
   * = the BOM plans none of this material.
   *
   * IT USED TO BE THE PRE-MOQ SUM, and that made the control fire on correct
   * work: a line needing 567 with an MOQ of 600 is BOUGHT at 600, so every such
   * PO was flagged "over by 33" and the buyer learned to dismiss the warning.
   *
   * ROLLED UP PER ITEM ACROSS LINES, THEN LIFTED ONCE. A thread used on the body
   * and on the collar is two BOM lines, each with its own MOQ; applying each
   * line's minimum separately buys 500 twice where one purchase of 500 covers
   * both. That is 0437's "six colour rows each rounded buys the rounding error
   * six times", one level up. So the slices are summed per MATERIAL first, and
   * the largest contributing MOQ and coarsest step are applied to that one total.
   *
   * A CONSEQUENCE WORTH KNOWING: the per-line Final Quantity on the BOM grid and
   * this per-material ceiling legitimately differ when two lines name one
   * material. The grid answers "what does this line need"; this answers "what may
   * be bought".
   */
  byItem: Map<string, number>;
  /**
   * What is ALREADY on other purchase orders for this (sales order, material),
   * so a ceiling cannot be defeated by splitting the buy in two. Without it two
   * POs at 60% each both pass and the control never fires once.
   *
   * Cancelled POs are excluded; every other status counts, because a draft is a
   * number somebody is about to act on.
   */
  committedByItem: Map<string, number>;
  /**
   * Whether the ceiling REFUSES or merely warns.
   *
   * True once an `order_budgets` row covering this order is `approved` — the
   * client's condition, and the point at which somebody has signed the figure.
   * Before that the long-standing warn-and-record path stands unchanged
   * (`po-actions.ts` records why that shape was chosen).
   */
  enforced: boolean;
  /** The approved budget doing the enforcing, so the refusal can name it. */
  budgetCode: string | null;
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
  | { kind: "within"; planned: number; ordered: number; committed: number }
  /** Over the plan, and the budget is not approved yet — warn and record. */
  | { kind: "over"; planned: number; ordered: number; committed: number; variance: number }
  /**
   * Over the plan with an approved budget behind it. REFUSED, not recorded: an
   * over-quantity confirmation is written AFTER the PO exists, so it structurally
   * cannot authorise one. Revising means revising the budget.
   */
  | {
      kind: "blocked";
      planned: number;
      ordered: number;
      committed: number;
      variance: number;
      budgetCode: string | null;
    };

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

  const thisLine = Number.isFinite(line.quantity) ? line.quantity : 0;
  const committed = ceiling.committedByItem.get(line.itemId) ?? 0;
  // THE WHOLE COMMITMENT, not this form's line. See `committedByItem`.
  const ordered = thisLine + committed;

  if (ordered <= planned) return { kind: "within", planned, ordered, committed };

  const variance = ordered - planned;
  return ceiling.enforced
    ? { kind: "blocked", planned, ordered, committed, variance, budgetCode: ceiling.budgetCode }
    : { kind: "over", planned, ordered, committed, variance };
}

/**
 * The refusal an operator reads, in one place so the form and the server action
 * cannot word it differently.
 *
 * NAMES THE THREE FIGURES rather than only the overage, because "300 over" does
 * not tell a buyer what to type instead. `requirement.ts` states the same rule
 * about its own refusals: a sentence, never a code.
 */
export function blockedMessage(
  v: Extract<CeilingVerdict, { kind: "blocked" }>,
  itemName?: string | null,
): string {
  const who = itemName ? `${itemName}: ` : "";
  const already =
    v.committed > 0
      ? ` and ${fmt(v.committed)} are already on other purchase orders`
      : "";
  const room = Math.max(0, v.planned - v.committed);
  return (
    `${who}the approved Material BOM allows ${fmt(v.planned)}${already}` +
    `${v.budgetCode ? ` (budget ${v.budgetCode})` : ""}. ` +
    `This line can be at most ${fmt(room)}.`
  );
}

const fmt = (n: number) => n.toLocaleString("en-IN");
