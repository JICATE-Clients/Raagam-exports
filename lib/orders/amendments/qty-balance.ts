/**
 * THE ORDER'S QUANTITY ARITHMETIC — one declaration, read by the screen and by
 * the server action.
 *
 * Two rules, and the client states them as one double lock (2026-08-31):
 *
 *   1. **Inside a destination.** The size/colour breakup must sum EXACTLY to
 *      that destination's PO Qty. The Details overlay's Done button refuses
 *      while it does not.
 *   2. **Across the tabs.** Total Style PO Qty must equal total Quantities
 *      PO Qty before the operator may advance a tab or save.
 *
 * ## WHY THIS FILE EXISTS
 *
 * Both rules were enforced ONLY in the browser. A dead Save button is a
 * courtesy; it cannot refuse a stale client, a double-submit, or a direct post
 * — and AGENTS.md is explicit that the server is the guard ("the screen check
 * is a courtesy; this one is the guard"). The arithmetic now lives here so the
 * two enforcers cannot answer differently: the screen's helpers delegate to
 * these functions and `actions.ts` calls them on the way in.
 *
 * ## STRUCTURAL TYPES, DELIBERATELY
 *
 * The screen holds every number as a STRING (a half-typed `12` must survive as
 * `"12"`), and the server holds them as `number` after Zod. Rather than convert
 * at one of the two call sites — which is where a rounding or a `""` → `0`
 * difference would hide — every input here is `string | number | null` and is
 * read through `num()`. One coercion, used by both.
 *
 * ## NO KEYSTROKE CAP, AND NOTHING HERE IMPOSES ONE
 *
 * These functions REPORT; they never clamp. Correcting `120` down to `12` has
 * to pass through `1`, so a rule that refuses those fights the edit and reads
 * as a broken field. The repo's standing line is **guided, never caged** — the
 * refusal belongs on Done, on Next and on Save, all of which leave a way out.
 */

/** Solid Colour / Solid Size, or anything assorted. */
export type AssortMode = "solid" | "assort";

/** A number the screen may hold as a string and the server as a number. */
type Num = string | number | null | undefined;

/**
 * `Number(x) || 0` — and the `|| 0` is load-bearing, not defensive. `Number("")`
 * is 0 but `Number(" ")` is 0 and `Number("x")` is NaN, and a NaN reaching a sum
 * turns the whole total into NaN, which compares false against everything and
 * would report a balanced order as unbalanced with no figure to show for it.
 */
function num(v: Num): number {
  return Number(v ?? 0) || 0;
}

export type BalanceSize = { qty: Num };

export type BalanceLine = {
  /** 0473: this line's cells are BOXES, so it never joins a piece total. */
  is_pack_row?: boolean | null;
  no_of_cartons?: Num;
  inners_per_carton?: Num;
  sizes?: readonly BalanceSize[] | null;
};

export type BalanceRow = {
  po_qty?: Num;
  /** 0328's tuple — 'master' | 'inner'. Anything else reads as master. */
  ratio_for?: string | null;
  assort_lines?: readonly BalanceLine[] | null;
};

/** Σ of a line's size cells. */
export function ratioTotal(line: BalanceLine): number {
  return (line.sizes ?? []).reduce((a, z) => a + num(z.qty), 0);
}

/**
 * `|| 1`, NEVER `|| 0` — a blank multiplier means "one", not "none". Zero here
 * would silently zero the line's pieces and report the destination as short by
 * exactly the amount it actually ships.
 */
export function inners(line: BalanceLine): number {
  return Number(line.inners_per_carton ?? 0) || 1;
}

/** 'inner' only when the row says so; every other value is master (0328). */
export function ratioScope(row: BalanceRow): "master" | "inner" {
  return (row.ratio_for ?? "").trim().toLowerCase() === "inner" ? "inner" : "master";
}

/**
 *   master  pieces = Cartons × Σ ratio
 *   inner   pieces = Cartons × Inners × Σ ratio
 */
export function packFactor(row: BalanceRow, line: BalanceLine): number {
  return num(line.no_of_cartons) * (ratioScope(row) === "inner" ? inners(line) : 1);
}

/** Solid reads the size cells as pieces; assorted multiplies by the pack. */
export function lineQty(row: BalanceRow, line: BalanceLine, mode: AssortMode): number {
  return mode === "solid" ? ratioTotal(line) : packFactor(row, line) * ratioTotal(line);
}

/**
 * THE PACK ROW IS DROPPED FROM EVERY AGGREGATE (0473).
 *
 * Its size cells are BOX counts. `lineQty` reads Solid as "sum the size cells",
 * which on that row is the box count — correct for the row's own Qty cell and
 * catastrophic in a sum: the destination would read as pieces PLUS boxes, the
 * balance rule would refuse an order that is exactly right, and the operator's
 * only way out would be to type a wrong number.
 */
export function pieceLines(row: BalanceRow): readonly BalanceLine[] {
  return (row.assort_lines ?? []).filter((l) => !l.is_pack_row);
}

/** What the breakup adds up to, in pieces. */
export function assortTotal(row: BalanceRow, mode: AssortMode): number {
  return pieceLines(row).reduce((a, l) => a + lineQty(row, l, mode), 0);
}

/**
 * PO Qty minus the breakup. Positive is short, negative is over, zero saves.
 *
 * NULL WHILE THE BREAKUP ADDS TO NOTHING — 0414's rule, kept rather than
 * loopholed: "a line with no ratio rows is not disagreeing with anything, it
 * simply has not been filled in." Requiring one would make every order
 * unsaveable until every destination had been broken down, including the draft
 * an operator saves halfway through entry.
 *
 * THE TEST IS THE TOTAL, NOT THE ROW COUNT. A blank line the operator has just
 * added is dropped again on save, so counting rows would refuse a save over a
 * line that never reaches the database.
 */
export function assortBalance(row: BalanceRow, mode: AssortMode): number | null {
  const computed = assortTotal(row, mode);
  return computed === 0 ? null : num(row.po_qty) - computed;
}

/** Plain grouped digits — this module must not import a formatter that pulls in
 *  locale state on the server. Matches `fmtNumber` for the integers it sees. */
function grp(v: number): string {
  return new Intl.NumberFormat("en-IN").format(v);
}

/**
 * ONE SENTENCE, EVERY DOOR. The overlay's Done, the rail badge, the dead Save
 * and now the server's refusal all read this — an operator who is shown two
 * different numbers for one disagreement stops believing either.
 *
 * It names the destination even where the surrounding UI already does, because
 * on the rail nothing else identifies which of five destinations is short.
 */
export function assortBalanceMessage(
  row: BalanceRow,
  mode: AssortMode,
  who: string,
): string | null {
  const bal = assortBalance(row, mode);
  if (bal === null || bal === 0) return null;
  const target = grp(num(row.po_qty));
  const label = who.trim() || "this destination";
  return bal > 0
    ? `${label}: the breakup is ${grp(bal)} short of the order qty (${target}). Open Details and make them match.`
    : `${label}: the breakup is ${grp(-bal)} over the order qty (${target}). Open Details and make them match.`;
}

/**
 * THE CROSS-TAB RULE.
 *
 * SILENT WHILE THE QUANTITY SIDE IS EMPTY, and that is the same abstention
 * `assortBalance` makes one level down: an order whose destinations have not
 * been entered yet is not disagreeing with its styles. Firing there would make
 * every order unsaveable from the moment its first style was typed.
 *
 * THE REVERSE IS NOT SILENT. Destinations totalling 500 against styles
 * totalling 0 IS a disagreement — pieces are being shipped that the contract
 * does not account for — so it reports, and it names BOTH figures rather than
 * assuming which side is the mistake. Which one is right is not something this
 * rule can know.
 */
export function crossTabPoQtyMessage(
  totalStylePoQty: number,
  totalQuantityPoQty: number,
): string | null {
  if (totalQuantityPoQty === 0 || totalStylePoQty === totalQuantityPoQty) return null;
  const head = `Style PO Qty ${grp(totalStylePoQty)} does not match Quantities PO Qty ${grp(totalQuantityPoQty)}`;
  return totalStylePoQty > totalQuantityPoQty
    ? `${head} — the destinations are ${grp(totalStylePoQty - totalQuantityPoQty)} short of the order.`
    : `${head} — the destinations are ${grp(totalQuantityPoQty - totalStylePoQty)} over the order.`;
}

/** Σ of the destinations' typed PO Qty. */
export function totalQuantityPoQty(rows: readonly BalanceRow[]): number {
  return rows.reduce((a, r) => a + num(r.po_qty), 0);
}
