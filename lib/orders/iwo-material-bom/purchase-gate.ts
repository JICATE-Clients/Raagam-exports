/**
 * What a purchase order may buy for an Accessories work order — the two rules,
 * ONCE (0586, 0587).
 *
 * 1. THE ADVISED CHECKPOINT (IWO SRS §6). An accessory ticked Is Advised on the
 *    IWO Material BOM has artwork or a shade the buyer has not confirmed, so
 *    whatever arrives would be wrong and paid for. Until the merchandiser
 *    unticks it, no purchase order line may buy it for that work order.
 *
 * 2. THE CEILING (client 2026-09-19: "refuse outright"). A work order may not
 *    buy more of a material than its Material BOM's purchase quantity. On a
 *    garment order the ceiling bites only once a budget is approved; a work
 *    order has no budget, so its BOM is the ONLY approved figure — which is
 *    why, unlike the order side, a material the BOM does not plan is refused
 *    (0 approved) rather than left unchecked, and so is a work order with no
 *    saved Material BOM.
 *
 * Pure and client-safe: the purchase gates refuse with these sentences, the PO
 * form previews with them, and `scripts/check-iwo-material-bom.mts` asserts
 * them. The facts come from `iwo_purchase_check()`, which is SECURITY DEFINER
 * so a buyer without Orders ▸ View still sees the BOM — read through RLS they
 * would see none, and a gate that sees nothing allows.
 */

/** `iwo_purchase_check(iwo)`'s answer, as the database returns it. */
export type IwoPurchaseCheck = {
  code: string | null;
  iwo_for: string;
  status: string;
  /** The work order's Material BOM, or null when it has none. */
  bom: { is_draft: boolean } | null;
  /** Its Advised materials in S No order, each once per BOM line. */
  advised: { item_id: string; name: string | null }[];
  /**
   * Every BOM line naming a material (0587): its purchase quantity — NULL where
   * the BOM refused to calculate one — and the unit that figure is in.
   */
  lines: { item_id: string; name: string | null; purchase_qty: number | null; uom: string | null }[];
  /** What OTHER, uncancelled purchase orders already hold per material (0587). */
  committed: { item_id: string; qty: number }[];
};

/**
 * The Advised materials among `itemIds`, by name, each once, in BOM order.
 * A line naming no material is not judged — there is nothing to match.
 */
export function advisedAmong(
  check: IwoPurchaseCheck,
  itemIds: Iterable<string | null | undefined>,
): string[] {
  const wanted = new Set<string>();
  for (const id of itemIds) if (id) wanted.add(id);
  const out: string[] = [];
  for (const a of check.advised) {
    if (!wanted.has(a.item_id)) continue;
    const name = a.name?.trim() || "A material";
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** "the work order U2/IWO/2627/0005", or "this work order" when unnumbered. */
const theIwo = (code: string | null) => (code ? `work order ${code}` : "this work order");

/**
 * The refusal, or null to allow. NAMES THREE AND COUNTS THE REST, as the order
 * side's "To be advised" gate does: a refusal is read in a toast, and twenty
 * names in one sentence is a wall nobody reads.
 */
export function advisedRefusal(names: readonly string[], iwoCode: string | null): string | null {
  if (names.length === 0) return null;
  const shown = names.slice(0, 3).join(", ");
  const rest = names.length - Math.min(3, names.length);
  const subject = rest > 0 ? `${shown} and ${rest} more` : shown;
  const verb = names.length === 1 && shown !== "A material" ? "is" : "are";
  return (
    `${subject} ${verb} still Advised on ${theIwo(iwoCode)} — the buyer has not confirmed ` +
    `${names.length === 1 ? "it" : "them"}. Untick Is Advised on IWO Material BOM once ` +
    `confirmed, then raise the purchase order.`
  );
}

/**
 * The line under the PO form's I.WO No field — what the purchase will be held
 * to, said BEFORE Save so a refusal is never the first news. It must agree with
 * `iwoCeilingRefusal`: a work order with no saved Material BOM is not "nothing
 * to check against" any more (0587) — nothing on it can be bought.
 */
export function iwoPurchaseHint(check: IwoPurchaseCheck): string {
  if (check.iwo_for !== "accessories") {
    return "Only an Accessories work order is limited by a Material BOM — nothing to check against";
  }
  if (!check.bom) return "This work order has no Material BOM yet — nothing on it can be bought";
  if (check.bom.is_draft) {
    return "Its Material BOM is still a draft — nothing on it can be bought until it is saved";
  }
  const names = [...new Set(check.advised.map((a) => a.name?.trim() || "A material"))];
  const limit = "Limited to IWO Material BOM's purchase quantities";
  if (names.length === 0) return `${limit} — nothing on it is Advised`;
  const shown = names.slice(0, 3).join(", ");
  const rest = names.length - Math.min(3, names.length);
  return `${limit} — still Advised, cannot be bought: ${shown}${rest > 0 ? ` and ${rest} more` : ""}`;
}

// ---------------------------------------------------------------------------
// The ceiling (0587)
// ---------------------------------------------------------------------------

/**
 * Six decimals, never `fmtNumber`: that one stops at three and rounds to
 * NEAREST, so a 16.6667 BOX allowance would print as 16.667 — a limit shown
 * smaller than it is, on the number the buyer is told to type.
 */
const qty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 6 });

/** A purchase quantity is exact to the unit's decimals; compare with slack for
 *  float sums, never with it for the operator's own figure. */
const EPS = 1e-9;

/**
 * The first refusal among `wanted` (material → quantity on THIS payload, its
 * own lines already summed), or null to allow. Only an Accessories work order is
 * capped here: a Yarn or Fabric work order's plan lives on the IWO Fabric BOM.
 *
 * In order, each a refusal the operator can act on:
 *   - no Material BOM, or one still a draft — nothing is approved yet;
 *   - a material the BOM does not plan — 0 approved;
 *   - a material whose BOM line could not work out a purchase quantity;
 *   - a material planned in two different purchase units — the two figures
 *     cannot be added, and guessing which one the PO is in is how a ceiling lies;
 *   - this payload plus what other POs hold, above the BOM's total.
 */
export function iwoCeilingRefusal(
  check: IwoPurchaseCheck,
  wanted: ReadonlyMap<string, number>,
): string | null {
  if (check.iwo_for !== "accessories") return null;
  const buying = [...wanted].filter(([, q]) => Number.isFinite(q) && q > 0);
  if (buying.length === 0) return null;

  const on = theIwo(check.code);
  if (!check.bom) {
    return `${cap(on)} has no Material BOM yet, so nothing on it is approved to buy. Plan it on IWO Material BOM first.`;
  }
  if (check.bom.is_draft) {
    return `${cap(on)}'s Material BOM is still a draft, so nothing on it is approved to buy yet. Save it (not as a draft) first.`;
  }

  const committed = new Map(check.committed.map((c) => [c.item_id, Number(c.qty) || 0]));
  for (const [itemId, thisPo] of buying) {
    const planned = check.lines.filter((l) => l.item_id === itemId);
    const name = planned[0]?.name?.trim() || "This material";
    if (planned.length === 0) {
      return `This material is not on ${on}'s Material BOM, so none of it is approved to buy. Add it there first.`;
    }
    if (planned.some((l) => l.purchase_qty == null)) {
      return `The Material BOM for ${on} could not work out a purchase quantity for ${name}. Fix that line on IWO Material BOM first.`;
    }
    const units = [...new Set(planned.map((l) => l.uom ?? ""))];
    if (units.length > 1) {
      return `${name} is planned in two purchase units (${units.join(", ")}) on ${on}. Plan it in one unit before buying.`;
    }
    const allowed = planned.reduce((sum, l) => sum + Number(l.purchase_qty), 0);
    const held = committed.get(itemId) ?? 0;
    const ordered = thisPo + held;
    if (ordered <= allowed + EPS) continue;

    // THIS PO's figure is the one quoted; what other POs hold is said beside it,
    // never folded in — "quantity (140)" on a PO that asks for 100 reads as a typo.
    const unit = units[0] ? ` ${units[0]}` : "";
    const plus = held > 0 ? ` plus ${qty(held)}${unit} already on other purchase orders` : "";
    const room = held > 0 ? ` This one can take at most ${qty(Math.max(0, allowed - held))}${unit}.` : "";
    return (
      `Purchase order quantity (${qty(thisPo)}${unit})${plus} exceeds the approved IWO Material ` +
      `BOM allocation (${qty(allowed)}${unit}) for ${name} on ${on}.${room} ` +
      `Over-ordering on work orders is blocked.`
    );
  }
  return null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
