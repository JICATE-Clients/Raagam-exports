/**
 * What the order is worth — Average Rate and Gross Value.
 *
 *     Gross Value = SUM over style lines of (PO Qty x that style's rate)
 *     Average Rate = Gross Value / total PO Qty
 *
 * Client spec 2026-08-12: "Gross Value = Order Quantity x Rate", and Average
 * Rate is "the calculated average price per garment". Both were free numeric
 * inputs on the Logistic tab until now, which meant the document could state a
 * value its own Style(s) and Prices tabs contradicted.
 *
 * The quantity is the STYLE LINE's `po_qty`, not the Quantities tab's
 * per-destination figure. Two reasons, and the second is the one that decides
 * it: the client named "Order Quantity", and the Quantities tab is optional —
 * a simple single-destination order leaves it empty, so reading it would value
 * a real order at zero.
 *
 * Client-safe (no `server-only`) for the same reason `approval-qty.ts` and
 * `style-processes.ts` are: the figures recalculate as the operator types, so
 * they have to run in the browser. The Order Sheet imports the SAME functions
 * from a server component, which is what stops the printed value and the
 * on-screen value from being derived twice and disagreeing.
 *
 * ## NULL IS AN ANSWER, AND 0 IS NOT
 *
 * The rule `approval-qty.ts` already records for Projection applies here with
 * more force, because this number is money:
 *
 *   - no style line carrying a quantity yet -> null ("nothing to value")
 *   - a style whose rate cannot be resolved -> null ("cannot be answered")
 *   - a genuine zero                        -> 0
 *
 * Only the third is a number. A PARTIAL sum is the dangerous one: unlike a
 * blank field, a Gross Value of 21,000 on an order actually worth 36,000 looks
 * exactly like a correct answer, so it gets believed rather than reported. That
 * is the same failure AGENTS.md names under "Cascading filters" — an empty
 * report reads as a real result. So an unresolved line poisons the whole total
 * rather than being quietly dropped from it, and `unresolved` names the styles
 * so the screen can say WHICH ones need a price.
 */

import { styleKey } from "./style-key";

/** A style line, as much of it as the value needs. */
export type ValuedStyle = {
  style_ref_no: string | null;
  po_qty: number;
};

/** A Prices-tab row, as much of it as the value needs. */
export type ValuedPrice = {
  style_ref_no: string | null;
  /** One of PRICE_TYPE_OPTIONS. Blank reads as Style-wise — see `styleRate`. */
  price_type?: string | null;
  /** The colourway this rate is for (0416). Null on Style-wise / Size-wise. */
  combo?: string | null;
  /** The size this rate is for (0416). Null on Style-wise / Color-wise. */
  size_id?: string | null;
  price: number;
};

/**
 * One (style, colourway, size) quantity, off the Quantities tab (0414).
 *
 * The WEIGHT a rate is multiplied by. Flattened out of the assort tree by the
 * caller — `no_of_cartons x that size's pieces` — because the tree shape is the
 * screen's business and this module only needs the three keys and a number.
 */
export type ValuedQty = {
  style_ref_no: string | null;
  combo: string | null;
  size_id: string | null;
  qty: number;
};

/**
 * Both figures are rounded TO THEIR COLUMN'S PRECISION, and that is the point:
 * `gross_value` is `numeric(16,2)` and `avg_rate` is `numeric(14,6)`, so Postgres
 * rounds on write whatever this hands it. Rounding here instead means the number
 * on screen, the number in the row and the number on the Order Sheet are the same
 * number — round only on display and the stored value silently differs from the
 * one the operator approved.
 *
 * It also absorbs IEEE 754 noise: `5000 * 4.2` is 21000.000000000004.
 */
const money = (n: number) => Math.round(n * 100) / 100;
const rate = (n: number) => Math.round(n * 1e6) / 1e6;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** A combo name compares like a style ref: trimmed, case-folded. */
const comboKey = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

/**
 * Which axes a mode prices along. Blank reads as Style-wise, deliberately:
 * every row saved before 0416 has a mode, but a row mid-entry may not, and the
 * alternative is refusing to value a document over an unanswered dropdown.
 */
function modeAxes(priceType: string | null | undefined): { colour: boolean; size: boolean } {
  const m = (priceType ?? "").trim().toLowerCase();
  return {
    colour: m === "color-wise" || m === "color-wise size-wise",
    size: m === "size-wise" || m === "color-wise size-wise",
  };
}

/**
 * The rate for one style, or null when the document does not say.
 *
 * ## THIS IS THE JUDGEMENT CALL — change it here and nowhere else
 *
 * IT USED TO REFUSE EVERY MULTI-ROW STYLE, and that was honest rather than
 * lazy: `AmendmentPriceDetail` carried `price_type` but no colour and no size,
 * so several rows for one style said several prices and nothing about which
 * colourway or size each belonged to. The quantities to weight them by were not
 * knowable from the row either. The note here listed the alternatives — highest,
 * lowest, unweighted mean — and said none was derivable from the data.
 *
 * 0416 MADE IT DERIVABLE. The row now names its colourway and its size, and the
 * Quantities tab (0414) stores the pieces per (style, combo, size). So a
 * Color-wise order is valued the only way that is actually correct:
 *
 *     rate = SUM(price x that combination's qty) / SUM(qty)
 *
 * WEIGHTED, NEVER AVERAGED FLAT (operator decision 2026-08-12). An unweighted
 * mean is right only when the colourways split evenly, and on a 90% white /
 * 10% printed order it reports a wrong value that looks exactly like a right
 * one — the same failure AGENTS.md names under "Cascading filters", where an
 * empty report reads as a real result. Money makes it worse, not better.
 *
 * ## Every branch that refuses, and why it is not a bug
 *
 * - **No priced row.** A price of 0 counts as unpriced, not as free: the grid
 *   opens on a blank row and a half-filled one carries 0.
 * - **Rows disagreeing about the MODE.** Changing a style from Color-wise to
 *   Style-wise keeps the old rows (operator decision: never delete typed money),
 *   so a style can legitimately hold rows of two modes for a moment. Valuing it
 *   would mean picking one set silently. Refusing names the style instead, which
 *   is what tells the operator to clear the stale rows.
 * - **Two different prices for the SAME colour and size.** Genuinely
 *   contradictory. Rows that AGREE are not: an operator who listed one
 *   combination twice at one price has stated one rate.
 * - **A priced row with no quantity behind it.** This is the subtle one. A
 *   colourway priced but absent from Quantities may be one that ships nothing,
 *   or one whose quantities have not been entered yet — and the two are
 *   indistinguishable from here. Weighting it at zero would quietly drop a real
 *   rate out of the average; that is the PARTIAL SUM this module's header
 *   forbids. So the whole style refuses until the tabs agree.
 * - **A Color-wise row naming no colour** (or Size-wise naming no size). Half
 *   answered: there is nothing to match a quantity against.
 *
 * Style-wise never consults quantities at all — one rate is one rate, and a
 * simple order must not need the Quantities tab filled to show its value.
 */
export function styleRate(
  refNo: string | null,
  prices: readonly ValuedPrice[],
  qtys: readonly ValuedQty[] = [],
): number | null {
  const key = styleKey(refNo);
  if (!key) return null;

  const rows = prices.filter(
    (p) => styleKey(p.style_ref_no) === key && num(p.price) > 0,
  );
  if (rows.length === 0) return null;

  const modes = new Set(rows.map((p) => (p.price_type ?? "").trim().toLowerCase()));
  if (modes.size !== 1) return null; // stale rows from a previous mode
  const axes = modeAxes([...modes][0]);

  if (!axes.colour && !axes.size) {
    const distinct = new Set(rows.map((p) => num(p.price)));
    return distinct.size === 1 ? [...distinct][0] : null;
  }

  // One entry per priced combination, refusing on a genuine contradiction.
  const byAxis = new Map<string, number>();
  for (const p of rows) {
    if (axes.colour && !comboKey(p.combo)) return null;
    if (axes.size && !p.size_id) return null;
    const k = `${axes.colour ? comboKey(p.combo) : ""}|${axes.size ? (p.size_id ?? "") : ""}`;
    const seen = byAxis.get(k);
    if (seen !== undefined && seen !== num(p.price)) return null;
    byAxis.set(k, num(p.price));
  }

  const mine = qtys.filter((q) => styleKey(q.style_ref_no) === key);
  let weighted = 0;
  let total = 0;
  for (const [k, price] of byAxis) {
    const [c, s] = k.split("|");
    const w = mine
      .filter((q) => (!axes.colour || comboKey(q.combo) === c) && (!axes.size || (q.size_id ?? "") === s))
      .reduce((a, q) => a + num(q.qty), 0);
    if (w <= 0) return null; // priced but unquantified — see the header
    weighted += price * w;
    total += w;
  }

  return total > 0 ? rate(weighted / total) : null;
}

export type OrderValue = {
  /** Null when unanswerable — never a partial sum. See the header. */
  grossValue: number | null;
  /** Null whenever `grossValue` is, and whenever no quantity was ordered. */
  avgRate: number | null;
  /** The style refs that carry a quantity but no single rate. Empty when all resolved. */
  unresolved: string[];
};

/**
 * The order's value, from its style lines and its Prices tab.
 *
 * ONLY LINES WITH A QUANTITY NEED A RATE. Every grid on this screen opens on a
 * blank row (`openOneRow`), and a style line the operator has not reached yet
 * has `po_qty` 0 — it contributes nothing to either total, so demanding a price
 * for it would make a fresh document permanently unresolved and the feature
 * useless on the one screen it lives on.
 */
export function orderValue(
  styles: readonly ValuedStyle[],
  prices: readonly ValuedPrice[],
  /**
   * The Quantities tab's per-(style, combo, size) pieces (0416). OPTIONAL and
   * defaulting to none, because a Style-wise order never needs it — and a caller
   * that forgets it gets a refusal on the multi-row modes, never a wrong number.
   */
  qtys: readonly ValuedQty[] = [],
): OrderValue {
  const unresolved: string[] = [];
  let gross = 0;
  let qty = 0;

  for (const s of styles) {
    const key = styleKey(s.style_ref_no);
    const lineQty = num(s.po_qty);
    if (!key || lineQty <= 0) continue;

    qty += lineQty;
    const rate = styleRate(s.style_ref_no, prices, qtys);
    if (rate == null) {
      if (!unresolved.includes(key)) unresolved.push(key);
      continue;
    }
    gross += lineQty * rate;
  }

  if (qty <= 0) return { grossValue: null, avgRate: null, unresolved: [] };
  if (unresolved.length > 0) return { grossValue: null, avgRate: null, unresolved };

  const grossValue = money(gross);
  // Six places, not two: a per-garment rate rounded to paise loses real precision
  // on a large order (36000 / 7000 = 5.142857, not 5.14).
  return { grossValue, avgRate: rate(grossValue / qty), unresolved: [] };
}

/**
 * The order's value in the books' own currency.
 *
 *     INR Value = Gross Value x Exchange Rate
 *
 * Client spec 2026-08-21: the Gross Value is captured in the BUYER's currency
 * (usually USD), the Logistic tab carries the exchange rate, and the product is
 * "the final sales value of the order" — the figure the Budget phase measures
 * its target margin against and the one the cost controls are set from.
 *
 * ## IT REFUSES WHEREVER THE GROSS VALUE REFUSES, AND ONCE MORE
 *
 * The header's rule ("null is an answer, and 0 is not") applies with more force
 * after a multiplication, because `ex_rate` is `numeric(14,4) NOT NULL DEFAULT
 * 0` (0126) — the column an operator has not filled in reads as ZERO, and zero
 * times a real Gross Value is 0.00, which is not "unknown" but "this order is
 * worth nothing". That is the exact lie 0417 was written to make
 * unrepresentable for the Gross Value itself; it must not come back in through
 * the conversion.
 *
 * So: no gross value -> null. No usable rate -> null. Never a product with a
 * missing factor treated as 1, and never 0.
 *
 * ## AN ORDER ALREADY IN INR CONVERTS AT 1
 *
 * Not a convenience — arithmetic. INR to INR is 1 by definition, so a domestic
 * order does not wait on a rate nobody should have to type, and cannot be
 * mis-valued by one typed in error. The check is on the currency the order
 * NAMES; a blank currency is not assumed to be home.
 *
 * ## Why this is not `forexToInr` from `lib/finance/calc.ts`
 *
 * It is the same multiplication and the same 2dp rounding, and it deliberately
 * is not imported. `order-value.ts` is client-safe with exactly one runtime
 * import (`./style-key`) — see the header — and pulling a finance module into
 * the garment-order bundle to save one multiply trades a real cost for a
 * cosmetic one. What must not be duplicated is the REFUSAL contract, and that
 * lives here, once.
 */
export const HOME_CURRENCY = "INR";

export function inrValue(
  grossValue: number | null,
  exRate: number | null | undefined,
  /** The order's `currency_code`. INR converts at 1; blank is not assumed. */
  currencyCode?: string | null,
): number | null {
  if (grossValue == null) return null;
  const home = (currencyCode ?? "").trim().toUpperCase() === HOME_CURRENCY;
  const r = home ? 1 : num(exRate);
  // `> 0` rather than `!= null`: 0 is the column's default and means "not
  // entered", and a negative rate is not a rate.
  if (!(r > 0)) return null;
  return money(grossValue * r);
}
