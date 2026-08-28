import "server-only";
import { createClient } from "@/lib/supabase/server";
import { roundUpTo } from "@/lib/orders/material-bom/requirement";
import { isUnsettledMaterialType } from "@/lib/orders/material-bom-amendment/types";
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
  // sales_orders -> the garment order documents raised against it. More than one
  // is possible (the document is amendable), so every one is a candidate and the
  // newest BOM across them wins.
  const { data: goRows } = await s
    .from("garment_order_amendments")
    .select("id")
    .eq("sales_order_id", salesOrderId);

  const goIds = ((goRows ?? []) as { id: string }[]).map((r) => r.id);
  if (goIds.length === 0) return { goIds, bom: null };

  const { data: bomRows } = await s
    .from("material_bom_amendments")
    .select("id, code, amendment_no, is_draft, garment_order_id")
    .in("garment_order_id", goIds)
    .eq("is_draft", false)
    .order("amendment_no", { ascending: false })
    .limit(1);

  const bom = ((bomRows ?? []) as { id: string; code: string | null }[])[0] ?? null;
  return { goIds, bom };
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
    item_id?: string | null;
  }[],
): Promise<string | null> {
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
    const { data: lineRows } = await s
      .from("material_bom_amendment_items")
      .select("item_id, type, item:items(name)")
      .eq("amendment_id", bom.id)
      .in("item_id", [...itemIds]);

    const unsettled: string[] = [];
    for (const r of (lineRows ?? []) as unknown as {
      item_id: string | null;
      type: string | null;
      /* PostgREST types an embed as an ARRAY even where the FK makes it one row
         — the same normalisation the budget embed above needs, and the same trap
         `material-bom-amendment/service.ts` records for its customer embed. */
      item: { name: string | null } | { name: string | null }[] | null;
    }[]) {
      if (!isUnsettledMaterialType(r.type)) continue;
      const cell = Array.isArray(r.item) ? (r.item[0] ?? null) : r.item;
      const name = cell?.name?.trim() || "A material";
      if (!unsettled.includes(name)) unsettled.push(name);
    }
    if (unsettled.length === 0) continue;

    /* NAMES THREE AND COUNTS THE REST. A refusal is read in a toast; twenty
       names in one sentence is a wall the operator closes without reading, and
       fixing the first three is progress they can see. */
    const shown = unsettled.slice(0, 3).join(", ");
    const rest = unsettled.length - Math.min(3, unsettled.length);
    const subject = rest > 0 ? `${shown} and ${rest} more` : shown;
    const verb = unsettled.length === 1 && shown !== "A material" ? "is" : "are";

    /* THE BOM'S CODE IS APPENDED ONLY WHEN THERE IS ONE. `code` is nullable, and
       a sentence reading "on Material BOM ." is the shape that makes an operator
       distrust the whole message — the refusal is still true and still
       actionable without it. */
    const on = bom.code ? ` on Material BOM ${bom.code}` : "";
    /* BOTH NAMES STAY, though "To be developed" left `MATERIAL_TYPE_OPTIONS` on
       2026-08-28 and only two values are pickable now. This sentence describes
       what a row can BE, not what can be picked — and a legacy row genuinely
       carrying "To be developed" is refused by `isUnsettledMaterialType`, so a
       message naming only the pickable value would refuse a line while
       describing a state it is not in, sending the operator to look for a
       wording they cannot find on the row. Do not trim it to match the
       dropdown; see the note on `UNSETTLED_MATERIAL_TYPES`. */
    return (
      `${subject} ${verb} still marked To be advised / To be developed${on}. ` +
      `Save the final specification and size against ` +
      `${unsettled.length === 1 ? "that line" : "those lines"} and set the Type ` +
      `to Available Item before raising a purchase order.`
    );
  }
  return null;
}
