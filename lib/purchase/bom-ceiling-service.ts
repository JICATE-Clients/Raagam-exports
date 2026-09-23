import "server-only";
import { createClient } from "@/lib/supabase/server";
import { roundUpTo } from "@/lib/orders/material-bom/requirement";
import { isUnsettledMaterialType } from "@/lib/orders/material-bom-amendment/types";
import { blockedMessage, judgeLine, type BomCeiling } from "./bom-ceiling";
import { reopenedBudgetForOrder } from "@/lib/orders/budget/lock";
import {
  advisedAmong,
  advisedRefusal,
  iwoCeilingRefusal,
  type IwoPurchaseCheck,
} from "@/lib/orders/iwo-material-bom/purchase-gate";

/**
 * The lookup half of the over-quantity ceiling (0424, made enforceable
 * 2026-08-21). The rule it feeds — and what each field has to get right — is
 * documented on `BomCeiling` in `./bom-ceiling`, which is client-safe because
 * the verdict is read as the operator types.
 *
 * ## THREE THINGS CHANGED WHEN THE CLIENT ASKED FOR A HARD CEILING
 *
 * 1. **The figure is the Final Quantity**, not the pre-MOQ per-slice sum. The
 *    old figure made the control fire on correct work — a line needing 567 with
 *    an MOQ of 600 is bought at 600 and was flagged "over by 33" every time.
 * 2. **It counts what is already on other POs.** Judging one form in isolation
 *    lets two POs of 60% each both pass, and the ceiling never fires at all.
 * 3. **It knows whether it may refuse** — only once an approved budget covers
 *    the order. Before that the warn-and-record path is unchanged.
 *
 * ## The MOQ and the step are read from the LINE, and applied ONCE per material
 *
 * 0437 deliberately forbids `moq` / `round_to` on the requirement table and
 * ships a migration guard that fails if either ever appears, because six colour
 * rows each rounded to the next 500 buys the rounding error six times. So the
 * slices are summed per material first and the tail is applied to that total —
 * with the LARGEST contributing MOQ and the COARSEST step, since two lines
 * naming one thread are satisfied by one purchase that clears both.
 */

const EMPTY: BomCeiling = {
  byItem: new Map(),
  committedByItem: new Map(),
  bomId: null,
  bomCode: null,
  unanswered: 0,
  enforced: false,
  budgetCode: null,
};

export type ReqRow = {
  item_id: string | null;
  item_line_id: string | null;
  /** The TRIM's colour (0436). Part of how the minimum groups — see the rollup
   *  below — not decoration. */
  item_color_id: string | null;
  required_qty: number | null;
  purchase_qty: number | null;
  refusal_reason: string | null;
};

export type LineRow = { id: string; moq: number | null; round_to: number | null };

/**
 * WHICH BOM ANSWERS FOR THIS ORDER — the lookup both gates below start from.
 *
 * Extracted when the TBA gate joined the ceiling (2026-08-28) rather than
 * copied, because the two must never disagree about WHICH document they are
 * judging against. A second copy that drifted — one taking the newest amendment
 * and the other the newest recorded one, say — would give an operator a control
 * that refuses a material the other control has already priced, with no way to
 * tell which of the two is looking at the right BOM.
 *
 * `goIds` comes back as well as the BOM because the ceiling needs it for the
 * budget lookup, and re-reading it there would be the same duplication one
 * query down.
 *
 * RECORDED ONLY (`is_draft = false`), newest amendment first. A draft is
 * somebody's half-finished thinking and neither gate should act on it — for the
 * ceiling that would cap a purchase against an unfinished plan, and for the TBA
 * gate it would refuse one against a line nobody has committed to.
 */
async function recordedBomForOrder(
  s: Awaited<ReturnType<typeof createClient>>,
  salesOrderId: string,
): Promise<{ goIds: string[]; bom: { id: string; code: string | null } | null }> {
  // The gates' long-standing behaviour on a failed read is "no BOM", and that
  // is deliberately left alone here — changing how a live PO gate fails is its
  // own decision, not a side effect of sharing the lookup.
  try {
    const found = await recordedBomsForOrders(s, [salesOrderId]);
    return found.get(salesOrderId) ?? { goIds: [], bom: null };
  } catch {
    return { goIds: [], bom: null };
  }
}

/**
 * `recordedBomForOrder` for many orders at once — the SAME rule (recorded only,
 * newest `amendment_no` across every garment-order document of the order), so
 * the trims T&A tracker can never judge a different BOM than the PO gate does.
 * The single-order form above is now a call to this one; there is no second
 * copy of the choice to drift.
 *
 * Throws on a failed read: an empty map here would read as "no order has a
 * BOM", which is a real and unremarkable answer (AGENTS.md, "A FAILED QUERY IS
 * AN ERROR, NOT AN EMPTY LIST").
 */
export async function recordedBomsForOrders(
  s: Awaited<ReturnType<typeof createClient>>,
  salesOrderIds: readonly string[],
): Promise<Map<string, { goIds: string[]; bom: { id: string; code: string | null } | null }>> {
  const out = new Map<string, { goIds: string[]; bom: { id: string; code: string | null } | null }>();
  if (salesOrderIds.length === 0) return out;

  // sales_orders -> the garment order documents raised against it. More than one
  // is possible (the document is amendable), so every one is a candidate and the
  // newest BOM across them wins.
  const { data: goRows, error: goErr } = await s
    .from("garment_order_amendments")
    .select("id, sales_order_id")
    .in("sales_order_id", [...salesOrderIds]);
  if (goErr) throw new Error(`Garment orders could not be read: ${goErr.message}`);

  const soOfGo = new Map<string, string>();
  for (const r of (goRows ?? []) as { id: string; sales_order_id: string }[]) {
    soOfGo.set(r.id, r.sales_order_id);
    const entry = out.get(r.sales_order_id) ?? { goIds: [], bom: null };
    entry.goIds.push(r.id);
    out.set(r.sales_order_id, entry);
  }
  if (soOfGo.size === 0) return out;

  const { data: bomRows, error: bomErr } = await s
    .from("material_bom_amendments")
    .select("id, code, amendment_no, garment_order_id")
    .in("garment_order_id", [...soOfGo.keys()])
    .eq("is_draft", false)
    .order("amendment_no", { ascending: false });
  if (bomErr) throw new Error(`Material BOMs could not be read: ${bomErr.message}`);

  // Rows arrive newest first, so the first one seen per order is the winner.
  for (const b of (bomRows ?? []) as { id: string; code: string | null; garment_order_id: string }[]) {
    const entry = out.get(soOfGo.get(b.garment_order_id) ?? "");
    if (entry && !entry.bom) entry.bom = { id: b.id, code: b.code };
  }
  return out;
}

export async function bomCeilingForOrder(
  salesOrderId: string,
  /**
   * What to leave OUT of the committed sum, so an edit is not judged against its
   * own existing quantity and refused for being retyped.
   *
   * TWO GRAINS, because the callers need different ones. Editing ONE line
   * excludes that line and leaves the rest of its PO counted; submitting a whole
   * PO excludes the PO, because its lines are the thing being judged.
   */
  exclude?: { poId?: string | null; lineId?: string | null },
): Promise<BomCeiling> {
  const s = await createClient();

  const { goIds, bom } = await recordedBomForOrder(s, salesOrderId);
  if (goIds.length === 0) return EMPTY;

  /*
   * IS THIS ORDER UNDER AN APPROVED BUDGET? That is the client's condition for
   * the ceiling becoming a refusal rather than a warning — the moment somebody
   * has signed the figure.
   *
   * `order_budget_orders` is the link table (0428); an order may sit in several
   * budgets but in only ONE approved one, which `approveBudget` enforces. So the
   * first approved row is the answer, not a candidate among many.
   */
  const { data: budgetRows } = await s
    .from("order_budget_orders")
    .select("budget:order_budgets!inner(id, code, status)")
    .in("garment_order_id", goIds)
    .eq("order_budgets.status", "approved")
    .limit(1);

  /* PostgREST types an `!inner` embed as an ARRAY even where the FK makes it
     one row, so this normalises rather than asserting a shape the client does
     not promise — the same trap `service.ts` records for the customer embed. */
  const budgetRaw = (budgetRows ?? []) as unknown as {
    budget: { code: string | null } | { code: string | null }[] | null;
  }[];
  const budgetCell = budgetRaw[0]?.budget ?? null;
  const budget = Array.isArray(budgetCell) ? (budgetCell[0] ?? null) : budgetCell;

  if (!bom) return { ...EMPTY, enforced: false, budgetCode: budget?.code ?? null };

  const [{ data: reqRows }, { data: lineRows }] = await Promise.all([
    s
      .from("material_bom_amendment_requirements")
      /* `item_color_id` is SELECTED, not merely present on the table. The
         created-by sweep in AGENTS.md is the same shape: a hand-written select
         that names the neighbours and not the column leaves code that reads as
         correct with nothing to resolve. Here it would silently collapse navy
         and red back into one minimum. */
      .select(
        "item_id, item_line_id, item_color_id, required_qty, purchase_qty, refusal_reason",
      )
      .eq("amendment_id", bom.id),
    s
      .from("material_bom_amendment_items")
      .select("id, moq, round_to")
      .eq("amendment_id", bom.id),
  ]);

  const { byItem, unanswered } = finalQuantityByItem(
    (reqRows ?? []) as ReqRow[],
    (lineRows ?? []) as LineRow[],
  );

  /*
   * WHAT IS ALREADY BOUGHT against this order, per material.
   *
   * `po_line_items` carries `sales_order_id` and `item_id` itself (0424), so
   * this needs no join through the PO header except to read its status.
   * CANCELLED POs do not consume the ceiling; everything else does, a draft
   * included — a saved draft is a quantity somebody is about to act on.
   */
  let poQuery = s
    .from("po_line_items")
    .select("item_id, quantity, purchase_order:purchase_orders!inner(status)")
    .eq("sales_order_id", salesOrderId)
    .neq("purchase_orders.status", "cancelled");
  if (exclude?.poId) poQuery = poQuery.neq("purchase_order_id", exclude.poId);
  if (exclude?.lineId) poQuery = poQuery.neq("id", exclude.lineId);
  const { data: poRows } = await poQuery;

  const committedByItem = new Map<string, number>();
  for (const r of (poRows ?? []) as { item_id: string | null; quantity: number | null }[]) {
    if (!r.item_id) continue;
    committedByItem.set(r.item_id, (committedByItem.get(r.item_id) ?? 0) + Number(r.quantity ?? 0));
  }

  return {
    byItem,
    committedByItem,
    bomId: bom.id,
    bomCode: bom.code,
    unanswered,
    enforced: !!budget,
    budgetCode: budget?.code ?? null,
  };
}

/**
 * THE FINAL QUANTITY PER MATERIAL — the one figure a trim is bought against.
 *
 * Extracted from `bomCeilingForOrder` (2026-09-21) when the trims T&A tracker
 * (`lib/orders/trim-ta/service.ts`) needed the same number as its "required
 * BOM qty": a GRN completing a step against one figure while the PO gate caps
 * against another would tell the store a trim is fully in that purchasing is
 * still allowed to buy more of. One rule, two readers.
 *
 * `unresolvedItems` names every material with at least one REFUSED slice. Its
 * `byItem` figure is a partial sum, which reads as correct and is not — the
 * ceiling only counts them (`unanswered`), the tracker refuses to complete them.
 */
export function finalQuantityByItem(
  reqRows: readonly ReqRow[],
  lineRows: readonly LineRow[],
): { byItem: Map<string, number>; unanswered: number; unresolvedItems: Set<string> } {
  const lines = new Map(lineRows.map((l) => [l.id, l]));
  const unresolvedItems = new Set<string>();

  /*
   * Summed per MATERIAL **AND TRIM COLOUR**, carrying the tail parameters of
   * every LINE that fed it. `Math.max` on both: the largest minimum is the one a
   * single purchase has to clear, and the coarsest step is the one that leaves
   * an orderable figure.
   *
   * ## THE COLOUR IN THE KEY IS WHAT KEEPS THIS CONTROL HONEST (2026-08-22)
   *
   * `lineQuantityByColour` clears the supplier minimum per CONE COLOUR, because
   * navy thread and red thread are two things to buy. If the ceiling kept
   * summing to the material first, the two would disagree in the one direction
   * that hurts: needing 100 navy and 100 red against an MOQ of 500, the BOM
   * tells the operator to buy 1,000 and a ceiling of `max(200, 500) = 500`
   * refuses the purchase order written for it.
   *
   * That is the failure this file was already corrected for once — a ceiling
   * built from the pre-MOQ sum "made the control fire on correct work". A
   * control that refuses the figure its own BOM asked for is not a control.
   *
   * ONE COLOUR REDUCES TO THE OLD BEHAVIOUR EXACTLY: a material bought in a
   * single colour has one group, and `max(qty, moq)` then rounds once, as
   * before. Nothing bought today changes.
   */
  /* NUL, so it cannot occur in a uuid — the same choice `SLICE_SEP` makes in
     requirement.ts, and for the same reason: a key built by concatenation must
     not be forgeable by its own parts. */
  const KEY_SEP = "\u0000";
  const raw = new Map<
    string,
    { itemId: string; qty: number; moq: number; step: number }
  >();
  let unanswered = 0;

  for (const r of reqRows) {
    if (r.refusal_reason !== null || r.required_qty === null) {
      unanswered += 1;
      if (r.item_id) unresolvedItems.add(r.item_id);
      continue;
    }
    if (!r.item_id) continue;
    // `purchase_qty` where a pack was declared, so the ceiling is in the unit a
    // PO is written in — comparing metres with cones is a number that looks like
    // a comparison and is not.
    const qty = Number(r.purchase_qty ?? r.required_qty);
    const line = r.item_line_id ? lines.get(r.item_line_id) : undefined;
    /* NULL IS A VALUE — "the line's own colour" — so it is normalised into the
       key rather than skipped. Skipping it would fold every uncoloured row of a
       material into whichever colour happened to be read first. */
    const key = `${r.item_id}${KEY_SEP}${r.item_color_id ?? ""}`;
    const prev = raw.get(key);
    raw.set(key, {
      itemId: r.item_id,
      qty: (prev?.qty ?? 0) + qty,
      moq: Math.max(prev?.moq ?? 0, Number(line?.moq ?? 0) || 0),
      step: Math.max(prev?.step ?? 0, Number(line?.round_to ?? 0) || 0),
    });
  }

  const byItem = new Map<string, number>();
  for (const v of raw.values()) {
    // MOQ FIRST, THEN THE STEP — the client's order, settled 2026-08-19 with a
    // worked example (needs 100, MOQ 550, step 500 gives 1,000 this way and 550
    // the other, and only the first is a figure a supplier can pack) and
    // restated 2026-08-21. `lineQuantity` in requirement.ts owns the same
    // sequence for the grid; if one moves, both move.
    const final = roundUpTo(Math.max(v.qty, v.moq), v.step || null);
    /* SUMMED BACK TO THE MATERIAL, because a PO line names an item and not a
       colour — the ceiling has to be expressed in the units the thing it judges
       is written in. The per-colour minimums have already been cleared above,
       which is the whole point of doing it in two steps. */
    byItem.set(v.itemId, (byItem.get(v.itemId) ?? 0) + final);
  }

  return { byItem, unanswered, unresolvedItems };
}

/**
 * THE SERVER-SIDE GATE (client 2026-08-21: "the Purchase Order module must
 * restrict users from purchasing any accessory quantity exceeding this limit").
 *
 * Returns the refusal sentence, or null to allow.
 *
 * ## Why this exists rather than a check inside `createPurchaseOrder`
 *
 * Four write paths can put a quantity on a purchase order — create, add a line,
 * edit a line, submit — and a control on one of them is a control on none. One
 * function, four callers, so they cannot drift.
 *
 * ## THIS PAYLOAD'S OWN LINES ARE SUMMED FIRST
 *
 * Judging each line separately lets one PO carry two lines of 60% and pass
 * twice. `committedByItem` covers OTHER purchase orders; this covers the form in
 * front of the operator, and both have to be counted or the ceiling is
 * arithmetic theatre.
 *
 * ## It refuses only where a budget is approved
 *
 * `judgeLine` returns `over` and not `blocked` until then, so the long-standing
 * warn-and-record path is untouched for a buyer working ahead of the budget.
 * That was a deliberate client choice and it still holds for that window.
 */
export async function refuseOverCeiling(
  /* OPTIONAL, not merely nullable: `poLineInput` leaves both keys off entirely
     for general stock buying. A missing order or material is simply not checked
     — a control that refused what it cannot measure would stop ordinary
     purchasing, which is the failure the warn shape was originally chosen to
     avoid. */
  lines: readonly {
    sales_order_id?: string | null;
    /** The work order the line buys for (0587) — judged by `refuseIwoOverCeiling`. */
    iwo_id?: string | null;
    item_id?: string | null;
    quantity: number;
  }[],
  opts?: { exclude?: { poId?: string | null; lineId?: string | null } },
): Promise<string | null> {
  // THE WORK-ORDER CEILING (0587) rides this gate for the same reason the
  // Advised check rides the TBA gate: the four write paths already call it.
  const iwoRefusal = await refuseIwoOverCeiling(lines, opts?.exclude);
  if (iwoRefusal) return iwoRefusal;

  // Group by order, because the ceiling is per order and most POs name one.
  const byOrder = new Map<string, Map<string, number>>();
  for (const l of lines) {
    if (!l.sales_order_id || !l.item_id) continue;
    const qty = Number.isFinite(l.quantity) ? Number(l.quantity) : 0;
    if (qty <= 0) continue;
    const forOrder = byOrder.get(l.sales_order_id) ?? new Map<string, number>();
    forOrder.set(l.item_id, (forOrder.get(l.item_id) ?? 0) + qty);
    byOrder.set(l.sales_order_id, forOrder);
  }
  if (byOrder.size === 0) return null;

  for (const [salesOrderId, items] of byOrder) {
    const ceiling = await bomCeilingForOrder(salesOrderId, opts?.exclude);
    // Nothing to enforce until somebody has signed the plan.
    if (!ceiling.enforced) continue;

    for (const [itemId, quantity] of items) {
      const verdict = judgeLine(ceiling, { itemId, quantity });
      if (verdict.kind === "blocked") return blockedMessage(verdict);
    }
  }
  return null;
}

/**
 * THE TBA GATE (client 2026-08-28: a material still "To be advised" or "To be
 * developed" blocks downstream PO creation until the final size specs are
 * saved).
 *
 * Returns the refusal sentence, or null to allow.
 *
 * ## It is a sibling of `refuseOverCeiling`, deliberately, and called beside it
 *
 * Same four write paths — create, add a line, edit a line, submit — because a
 * control on one of them is a control on none. Same signature shape, same
 * "optional, not merely nullable" keys, same return of a sentence rather than a
 * throw. Two functions rather than one because they answer different questions
 * and one of them may say yes while the other says no: the ceiling asks HOW MUCH
 * and this asks WHETHER THIS THING IS DECIDED YET. Folding the second into the
 * first would put a specification refusal behind a budget condition it has
 * nothing to do with — see below.
 *
 * ## IT DOES NOT WAIT FOR AN APPROVED BUDGET, AND THAT IS THE ONE PLACE THE TWO
 * ## GATES DIVERGE ON PURPOSE
 *
 * `refuseOverCeiling` refuses only once a budget is approved, because until then
 * nobody has signed the figure it would be enforcing and a buyer working ahead
 * of the budget is doing ordinary work. Nothing of that argument transfers here.
 * A material nobody has specified cannot be bought correctly at any budget
 * state — the size, the finish and the make-up are all still open, so whatever
 * arrives will be wrong and will have been paid for. Copying the budget
 * condition across for symmetry would leave the gate switched off for exactly
 * the orders that have not been planned yet, which are the ones most likely to
 * carry a TBA line.
 *
 * ## A BLANK TYPE IS NOT A REFUSAL
 *
 * `isUnsettledMaterialType` answers false for null and for an empty string, and
 * that is load-bearing rather than lenient — `type` was blank on every line
 * written before `DEFAULT_MATERIAL_TYPE` existed, so the other reading would
 * refuse a purchase against every historic BOM the day this ships. The rule
 * refuses what an operator has DECLARED unsettled. Its header in
 * `material-bom-amendment/types.ts` carries the rest of the argument, including
 * why the comparison is case-normalised.
 *
 * ## ONE UNSETTLED LINE REFUSES THE MATERIAL, EVEN IF ANOTHER LINE IS SETTLED
 *
 * A PO line names an ITEM; a BOM carries a line per colour, panel and style, so
 * one trim can sit on several. There is no `item_line_id` on `po_line_items` to
 * tell which of them the purchase is for — 0424 gave that table `sales_order_id`
 * and `item_id` and nothing finer. So a material with any unsettled line is
 * refused whole. Judging it the other way would need a link the schema does not
 * have, and guessing "probably the settled one" is how a control becomes
 * decoration.
 */
export async function refuseUnsettledMaterials(
  /* OPTIONAL, not merely nullable, exactly as `refuseOverCeiling` above: general
     stock buying leaves both keys off entirely, and a line naming no order or no
     material is simply not checked. A gate that refused what it cannot measure
     would stop ordinary purchasing. */
  lines: readonly {
    sales_order_id?: string | null;
    /** The work order the line buys for (0586) — judged by `refuseAdvisedIwoItems`. */
    iwo_id?: string | null;
    item_id?: string | null;
  }[],
): Promise<string | null> {
  // THE WORK-ORDER HALF (0586) rides this gate rather than standing beside it,
  // so the four write paths that already call it cannot miss it.
  const advised = await refuseAdvisedIwoItems(lines);
  if (advised) return advised;

  // Grouped by order, because the BOM is per order and most POs name one.
  const byOrder = new Map<string, Set<string>>();
  for (const l of lines) {
    if (!l.sales_order_id || !l.item_id) continue;
    const forOrder = byOrder.get(l.sales_order_id) ?? new Set<string>();
    forOrder.add(l.item_id);
    byOrder.set(l.sales_order_id, forOrder);
  }
  if (byOrder.size === 0) return null;

  const s = await createClient();

  /** Per order: its RE No, and advised item id -> the material's name. */
  const advisedByOrder = new Map<string, { reNo: string | null; items: Map<string, string> }>();

  for (const [salesOrderId, itemIds] of byOrder) {
    const { bom } = await recordedBomForOrder(s, salesOrderId);
    // NO RECORDED BOM IS NOT A REFUSAL. It means this purchase is not being made
    // against a material plan at all, which is the same state `bomCeilingForOrder`
    // returns EMPTY for — buying ahead of the BOM is ordinary work, and the
    // ceiling has never stopped it either.
    if (!bom) continue;

    /* `type` AND the material's NAME, both selected. The name is what makes the
       refusal actionable — "a material on this BOM is still To be advised" sends
       the operator through twenty lines looking for it — and AGENTS.md's
       created-by sweep is the standing lesson about a hand-written select that
       names a column's neighbour and not the column: the code reads as correct
       and the sentence comes out with a blank in it. */
    const { data: lineRows, error: lineErr } = await s
      .from("material_bom_amendment_items")
      .select("item_id, type, item:items(name)")
      .eq("amendment_id", bom.id)
      .in("item_id", [...itemIds]);
    // "Could not check" is not "nothing advised": refuse, and say which.
    if (lineErr) return `Could not check the Material BOM for advised items: ${lineErr.message}`;

    const items = new Map<string, string>();
    for (const r of (lineRows ?? []) as unknown as {
      item_id: string | null;
      type: string | null;
      /* PostgREST types an embed as an ARRAY even where the FK makes it one row
         — the same normalisation the budget embed above needs, and the same trap
         `material-bom-amendment/service.ts` records for its customer embed. */
      item: { name: string | null } | { name: string | null }[] | null;
    }[]) {
      if (!r.item_id || !isUnsettledMaterialType(r.type)) continue;
      const cell = Array.isArray(r.item) ? (r.item[0] ?? null) : r.item;
      if (!items.has(r.item_id)) items.set(r.item_id, cell?.name ?? "");
    }
    if (items.size === 0) continue;

    const { data: so } = await s
      .from("sales_orders")
      .select("order_number")
      .eq("id", salesOrderId)
      .maybeSingle();
    advisedByOrder.set(salesOrderId, {
      reNo: (so as { order_number: string | null } | null)?.order_number ?? null,
      items,
    });
  }

  /* THE FIRST ADVISED LINE, IN THE PAYLOAD'S OWN ORDER — the row the
     po_line_items trigger would refuse first on the same insert, so the toast
     and the database name the same material. */
  for (const l of lines) {
    if (!l.sales_order_id || !l.item_id) continue;
    const o = advisedByOrder.get(l.sales_order_id);
    const name = o?.items.get(l.item_id);
    if (o && name !== undefined) return advisedItemMessage(name, o.reNo);
  }
  return null;
}

/**
 * THE ONE SENTENCE FOR AN ADVISED MATERIAL ON A PURCHASE ORDER (Advised Items,
 * 2026-09-19) — said IDENTICALLY by this gate and by 0588's BEFORE INSERT /
 * UPDATE trigger on `po_line_items`. Change one and the other in the same
 * edit: an operator who meets two wordings for one rule reads them as two
 * rules.
 *
 * It names the material and the RE No, and it names the WAY OUT — the Advised
 * Items register, where the line is converted once the buyer confirms the
 * specification. The menu path is checked by `npm run check:nav-paths`.
 *
 * Fallbacks, mirrored by the trigger (a blank counts as missing): no material
 * name → "A material"; no RE No → "on this order".
 *
 * "To be advised" is the only unsettled type a line can hold since 0588's
 * CHECK; a legacy "To be developed" row (none live) is still refused by
 * `isUnsettledMaterialType` and reads the same sentence.
 */
export function advisedItemMessage(itemName: string | null, reNo: string | null): string {
  const item = itemName?.trim() || "A material";
  const re = reNo?.trim();
  const on = re ? `on RE ${re}` : "on this order";
  return (
    `${item} is To be advised ${on} — convert it on ` +
    `Orders ▸ Order Execution ▸ Advised Items once the buyer confirms.`
  );
}

/**
 * THE WORK-ORDER CEILING (client 2026-09-19: "refuse outright") — an
 * Accessories work order may not buy more of a material than its Material BOM's
 * purchase quantity, and (0595) a Yarn or Fabric work order no more of a yarn
 * than its IWO Fabric BOM's purchase weight. The rules and every sentence are `iwoCeilingRefusal`'s
 * (pure, shared with the PO form); this is the lookup and the grouping.
 *
 * HARD FROM THE START. The order ceiling refuses only once a budget is approved,
 * because until then nobody has signed its figure. A work order has no budget;
 * its BOM is the only approved figure it has, so there is no earlier window in
 * which buying past it is ordinary work.
 *
 * THIS PAYLOAD'S LINES ARE SUMMED FIRST, and OTHER purchase orders are counted
 * (`committed`, 0587) — the order ceiling's two halves, for its reason: judging
 * lines one at a time lets two 60% lines both pass.
 *
 * Read through `iwo_purchase_check()` and FAILS CLOSED, as the Advised check
 * does — see `refuseAdvisedIwoItems` for both reasons.
 */
async function refuseIwoOverCeiling(
  lines: readonly { iwo_id?: string | null; item_id?: string | null; quantity: number }[],
  exclude?: { poId?: string | null; lineId?: string | null },
): Promise<string | null> {
  const byIwo = new Map<string, Map<string, number>>();
  for (const l of lines) {
    if (!l.iwo_id || !l.item_id) continue;
    const q = Number.isFinite(l.quantity) ? Number(l.quantity) : 0;
    if (q <= 0) continue;
    const forIwo = byIwo.get(l.iwo_id) ?? new Map<string, number>();
    forIwo.set(l.item_id, (forIwo.get(l.item_id) ?? 0) + q);
    byIwo.set(l.iwo_id, forIwo);
  }
  if (byIwo.size === 0) return null;

  const s = await createClient();
  for (const [iwoId, wanted] of byIwo) {
    const { data, error } = await s.rpc("iwo_purchase_check", {
      p_iwo_id: iwoId,
      p_exclude_po: exclude?.poId ?? null,
      p_exclude_line: exclude?.lineId ?? null,
    });
    if (error) {
      return `Could not check the work order's BOM (${error.message}). Nothing was saved — try again.`;
    }
    if (!data) return "The work order on this purchase no longer exists. Choose another, or clear it.";
    const refusal = iwoCeilingRefusal(data as IwoPurchaseCheck, wanted);
    if (refusal) return refusal;
  }
  return null;
}

/**
 * THE ADVISED CHECKPOINT (IWO SRS §6, 0586) — the work-order twin of the TBA
 * gate above, and called from inside it.
 *
 * An accessory ticked Is Advised on a work order's Material BOM cannot be
 * bought for that work order until the merchandiser unticks it. The same four
 * write paths, the same shape of sentence (`advisedRefusal`).
 *
 * ## READ THROUGH `iwo_purchase_check()`, NEVER THE TABLES
 *
 * This runs in the BUYER's session, and the IWO tables are readable only with
 * Orders ▸ View at the work order's unit. Read directly, a buyer without that
 * permission gets no rows back — which this gate would read as "nothing
 * Advised" and allow. The function is SECURITY DEFINER and answers the same for
 * everyone.
 *
 * ## IT FAILS CLOSED
 *
 * An error, or a work order the database cannot find, refuses. The order-side
 * gates read `data ?? []` and allow on a failed query; for a checkpoint the SRS
 * calls strict, "could not look" must not be the same answer as "nothing there".
 *
 * ## DRAFT BOMs COUNT
 *
 * Unlike the order side, which reads recorded BOMs only: an IWO has ONE
 * Material BOM, and the tick is a stop sign that holds from the moment it is
 * stored. 0586's header says the rest.
 */
async function refuseAdvisedIwoItems(
  lines: readonly { iwo_id?: string | null; item_id?: string | null }[],
): Promise<string | null> {
  const byIwo = new Map<string, Set<string>>();
  for (const l of lines) {
    if (!l.iwo_id || !l.item_id) continue;
    const forIwo = byIwo.get(l.iwo_id) ?? new Set<string>();
    forIwo.add(l.item_id);
    byIwo.set(l.iwo_id, forIwo);
  }
  if (byIwo.size === 0) return null;

  const s = await createClient();
  for (const [iwoId, itemIds] of byIwo) {
    const { data, error } = await s.rpc("iwo_purchase_check", { p_iwo_id: iwoId });
    if (error) {
      return `Could not check the work order's Advised items (${error.message}). Nothing was saved — try again.`;
    }
    if (!data) return "The work order on this purchase no longer exists. Choose another, or clear it.";
    const check = data as IwoPurchaseCheck;
    const refusal = advisedRefusal(advisedAmong(check, itemIds), check.code);
    if (refusal) return refusal;
  }
  return null;
}

/**
 * THE REOPENED-BUDGET GATE (Phase 5, decision 3 — user 2026-09-18: "while
 * reopened, Purchase BLOCKS new POs for those orders").
 *
 * Returns the refusal sentence, or null to allow.
 *
 * ## Why it exists at all: the ceiling switches itself OFF on a reopen
 *
 * `bomCeilingForOrder` enforces only while an APPROVED budget covers the order.
 * Reopening a budget (Amendment Protocol, `approved → draft`) takes that away,
 * so without this gate a reopen would not pause buying — it would REMOVE the
 * cap, at exactly the moment the figures are known to be moving.
 *
 * ## A budget NEVER approved is not "reopened"
 *
 * `reopenedBudgetForOrder` answers only for a budget that carries a revision
 * and is not approved now. An order with no budget, or one still being drafted
 * for the first time, stays purchasable exactly as before — buying ahead of the
 * budget is the long-standing client choice `refuseOverCeiling` records.
 *
 * ## It refuses on any line naming the order, whatever the material
 *
 * Sibling of the three gates above and called beside them at the same four
 * write paths. Unlike them it needs no `item_id`: the question is whether this
 * ORDER may be bought for right now, not whether this material may. A line
 * naming no order (general stock buying) is not checked.
 *
 * ## A FAILED READ REFUSES
 *
 * "Could not check" is not "not reopened" — the PO would go through on an
 * unanswered question, and a PO is not undone by a later trigger.
 */
export async function refuseReopenedBudget(
  lines: readonly { sales_order_id?: string | null }[],
): Promise<string | null> {
  const orderIds = [
    ...new Set(lines.map((l) => l.sales_order_id).filter((v): v is string => !!v)),
  ];
  if (orderIds.length === 0) return null;

  const s = await createClient();

  for (const salesOrderId of orderIds) {
    /* sales_orders -> its garment order documents, the grain budgets hang off
       (`order_budget_orders.garment_order_id`). Same walk as
       `recordedBomForOrder`, which reads it without the RE No. */
    const [{ data: goRows, error: goErr }, { data: so }] = await Promise.all([
      s.from("garment_order_amendments").select("id").eq("sales_order_id", salesOrderId),
      s.from("sales_orders").select("order_number").eq("id", salesOrderId).maybeSingle(),
    ]);
    if (goErr) {
      return `Could not check whether this order's budget is reopened: ${goErr.message}`;
    }
    const reNo = (so as { order_number: string | null } | null)?.order_number ?? null;

    for (const { id } of (goRows ?? []) as { id: string }[]) {
      let reopened;
      try {
        reopened = await reopenedBudgetForOrder(id);
      } catch (e) {
        return e instanceof Error
          ? e.message
          : "Could not check whether this order's budget is reopened.";
      }
      if (!reopened) continue;

      const order = reNo ? `RE ${reNo}` : "This order";
      const budget = reopened.budgetCode ? `budget ${reopened.budgetCode}` : "its budget";
      /* THE HARD LOCK OF THE AMENDMENT SPEC (§5): while a revised budget is
         not yet re-approved, no PO. Named by the Amendment Entry when the
         merchandiser's door raised it (0616), by the revision otherwise. */
      const why = reopened.entryNo
        ? `Revision ${reopened.entryNo} (${reopened.typesLabel}) is open on it: ${reopened.reason.trim()}`
        : `${budget} was reopened for revision ${reopened.revisionNo} (${reopened.reason.trim()})`;
      /* THE SPEC'S BADGE WORD FIRST (0619) — the same "Waiting Amendment" /
         "Pending MD Approval" the order list shows, so the refusal and the
         list explain the lock in one vocabulary. */
      const badge = reopened.pendingMd ? "Pending MD Approval" : "Waiting Revision";
      return (
        `${badge}: ${order} cannot be purchased for right now — ${why}. ` +
        `Raise the purchase order once the revised budget is approved.`
      );
    }
  }
  return null;
}
