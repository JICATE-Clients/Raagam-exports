import "server-only";
import { createClient } from "@/lib/supabase/server";
import { roundUpTo } from "@/lib/orders/material-bom/requirement";
import { blockedMessage, judgeLine, type BomCeiling } from "./bom-ceiling";

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

type ReqRow = {
  item_id: string | null;
  item_line_id: string | null;
  /** The TRIM's colour (0436). Part of how the minimum groups — see the rollup
   *  below — not decoration. */
  item_color_id: string | null;
  required_qty: number | null;
  purchase_qty: number | null;
  refusal_reason: string | null;
};

type LineRow = { id: string; moq: number | null; round_to: number | null };

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

  // sales_orders -> the garment order documents raised against it. More than one
  // is possible (the document is amendable), so every one is a candidate and the
  // newest BOM across them wins below.
  const { data: goRows } = await s
    .from("garment_order_amendments")
    .select("id")
    .eq("sales_order_id", salesOrderId);

  const goIds = ((goRows ?? []) as { id: string }[]).map((r) => r.id);
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

  const { data: bomRows } = await s
    .from("material_bom_amendments")
    .select("id, code, amendment_no, is_draft, garment_order_id")
    .in("garment_order_id", goIds)
    .eq("is_draft", false)
    .order("amendment_no", { ascending: false })
    .limit(1);

  const bom = ((bomRows ?? []) as { id: string; code: string | null }[])[0];
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

  const lines = new Map(
    ((lineRows ?? []) as LineRow[]).map((l) => [l.id, l]),
  );

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

  for (const r of (reqRows ?? []) as ReqRow[]) {
    if (r.refusal_reason !== null || r.required_qty === null) {
      unanswered += 1;
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
    item_id?: string | null;
    quantity: number;
  }[],
  opts?: { exclude?: { poId?: string | null; lineId?: string | null } },
): Promise<string | null> {
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
