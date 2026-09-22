/**
 * Copy From — carry an earlier budget's RATES onto this budget's lines.
 *
 * The blueprint's "Copy From" button: a merchandiser costing a repeat style
 * wants last season's negotiated yarn and trim rates, not a blank Rate column.
 * The lines themselves already exist here — `pullCostLines()` made them from
 * THIS group's BOMs — so what travels is the price, never the line.
 *
 * ## QUANTITIES ARE NEVER COPIED
 *
 * A quantity is a requirement the BOMs computed for THESE orders. Copying the
 * earlier budget's quantity would be a second answer to a question the Fabric
 * and Material BOMs already answered (see `PULLED_SOURCES` in `totals.ts`), and
 * it would be the wrong one the moment the two groups differ in size — which is
 * always. Only the fields of `CopyLine` below move.
 *
 * ## THE RATE TRAVELS AS ONE FACT — AND FOC / IMPORT DO NOT TRAVEL AT ALL
 *
 * `rate` is stated in `currency_code` at `ex_rate` (0572) under `rate_type`
 * (0573/0575). Copying a USD 0.80 without its currency turns it into Rs 0.80,
 * and copying a FLAT 5,000 without `flat` turns it into 5,000 PER PIECE — both
 * lines that `budgetTotals` would add up without a murmur. So those four fields
 * move together or not at all.
 *
 * `is_foc` and `is_import` are NOT copied. On a pulled line they are THIS
 * order's Material BOM facts (0474 / supply type), and last season's buyer
 * supplying a trim free says nothing about this one. A source line that is FOC
 * carries no price information, so it is never a candidate either.
 *
 * ## THE RULE (decided 2026-09-18)
 *
 * 1. **Same line = same SOURCE + same IDENTITY.** Identity is whichever of
 *    `item_id`, `process_id`, `cost_head_id`, `combo`, `style_ref_no`,
 *    `component_id` the line carries — so two processes on one yarn, two
 *    colourways of one dyeing step, or CMT for two styles are never confused.
 *    `source` is always part of it: one yarn bought (`yarn`) and dyed
 *    (`yarn_process`) is two prices. A line with NONE of those (a typed line
 *    holding only a description) is never matched: free text is not an
 *    identity. Free-text fields compare trimmed and in capitals (their stored
 *    form, AGENTS.md "CAPITALS").
 * 2. **`specification` NARROWS, it does not gate.** If the target has one and
 *    some candidates share it, only those count; otherwise every candidate for
 *    the identity does. A spelling drift ("YKK" / "YKK ZIP") therefore still
 *    finds last season's rate instead of silently finding nothing. When the
 *    target has no specification and the candidates agree on one, it is copied
 *    along with the rate — it says what that rate was for.
 * 3. **Blanks only — a rate already on the target is never overwritten.** A
 *    rate typed today is newer than last season's, and fill-blanks makes the
 *    button safe to press twice. An FOC target is already answered, so skipped.
 *    `matched` counts lines actually filled, so the toast cannot over-claim.
 * 4. **Two different earlier rates for one line ⇒ copy NEITHER, and count it.**
 *    Picking the first depends on row order; picking the highest hides that
 *    last season had two prices. `ambiguous` carries the count so the screen
 *    can say how many were left for the operator — `totals.ts`'s instinct:
 *    a refusal is a sentence, never a guess.
 *
 * Quantities stay out of `CopyLine`, so a qty-weighted average was never an
 * option, and averaging two currencies would be meaningless anyway.
 *
 * Pure and client-safe, like `totals.ts`: the preview ("12 of 30 lines will
 * get a rate") runs in the browser before anything is saved.
 */

export type CopyLine = {
  source: string;
  item_id: string | null;
  description: string | null;
  specification: string | null;
  currency_code: string | null;
  ex_rate: number | null;
  rate: number | null;
  is_foc: boolean;
  is_import: boolean;
  /* Identity beyond the item (0573 / 0575). Optional so a caller that predates
     them still compiles — but a caller that OMITS them collapses every process
     on one yarn into one key, so the budget screen passes all of them. */
  process_id?: string | null;
  cost_head_id?: string | null;
  combo?: string | null;
  style_ref_no?: string | null;
  component_id?: string | null;
  /* Travels WITH the rate — see "THE RATE TRAVELS AS ONE FACT". */
  rate_type?: string | null;
};

/** Trimmed, capitalised, blank ⇒ "" — the stored form of every free-text key. */
const norm = (v: string | null | undefined) => (v ?? "").trim().toUpperCase();

/** Blank and "INR" are one currency (0572: NULL currency = INR). */
const currencyOf = (v: string | null | undefined) => norm(v) || "INR";

/** The identity a line is matched on, or null when it has none worth trusting. */
function identityOf(l: CopyLine): string | null {
  const parts = [l.item_id, l.process_id, l.cost_head_id, l.combo, l.style_ref_no, l.component_id];
  if (!l.item_id && !l.process_id && !l.cost_head_id) return null;
  return [norm(l.source).toLowerCase(), ...parts.map((p) => norm(p))].join("|");
}

/** The rate as ONE fact: rate + currency + ex_rate + rate_type. */
type RateFact = { rate: number; currency_code: string | null; ex_rate: number | null; rate_type: string };

function factOf(l: CopyLine): RateFact {
  const inr = currencyOf(l.currency_code) === "INR";
  return {
    rate: l.rate as number,
    // INR in its one stored spelling: both null (chk_obl_currency_pair).
    currency_code: inr ? null : currencyOf(l.currency_code),
    ex_rate: inr ? null : l.ex_rate,
    rate_type: norm(l.rate_type).toLowerCase() || "per_unit",
  };
}

const sameFact = (a: RateFact, b: RateFact) =>
  a.rate === b.rate && a.currency_code === b.currency_code && a.ex_rate === b.ex_rate && a.rate_type === b.rate_type;

/**
 * Copy rates from an earlier budget's lines onto this budget's lines — blanks
 * only, never quantities. `matched` = lines actually filled; `ambiguous` = lines
 * left blank because the earlier budget held two different rates for them.
 */
export function copyRatesFrom<T extends CopyLine>(
  target: readonly T[],
  source: readonly CopyLine[],
): { lines: T[]; matched: number; ambiguous: number } {
  // Candidates by identity: priced, not FOC.
  const byIdentity = new Map<string, CopyLine[]>();
  for (const s of source) {
    if (s.is_foc || s.rate == null || !Number.isFinite(s.rate)) continue;
    const id = identityOf(s);
    if (!id) continue;
    const list = byIdentity.get(id);
    if (list) list.push(s);
    else byIdentity.set(id, [s]);
  }

  let matched = 0;
  let ambiguous = 0;

  const lines = target.map((t) => {
    if (t.rate != null || t.is_foc) return t;
    const id = identityOf(t);
    const all = id ? byIdentity.get(id) : undefined;
    if (!all || all.length === 0) return t;

    const spec = norm(t.specification);
    const sameSpec = spec ? all.filter((c) => norm(c.specification) === spec) : [];
    const pool = sameSpec.length > 0 ? sameSpec : all;

    const fact = factOf(pool[0]);
    if (!pool.every((c) => sameFact(factOf(c), fact))) {
      ambiguous++;
      return t;
    }

    matched++;
    const specs = new Set(pool.map((c) => norm(c.specification)));
    const carrySpec = !spec && specs.size === 1 ? [...specs][0] || null : t.specification;
    return { ...t, ...fact, specification: carrySpec };
  });

  return { lines, matched, ambiguous };
}

// ---------------------------------------------------------------------------
// Last rate — one line's most recent price, offered under its blank box
// ---------------------------------------------------------------------------

/** An earlier budget's priced lines, newest first — see `lastRateFor`. */
export type RateHistoryBudget = {
  code: string | null;
  status: string;
  lines: readonly CopyLine[];
};

/** What the hint under a blank Rate offers: the fact, and where it is from. */
export type LastRate = RateFact & { budget: string };

/**
 * THE MOST RECENT RATE THIS LINE HAD ON AN EARLIER BUDGET — or nothing.
 *
 * "Copy From" (above) fills a whole budget from ONE budget the operator
 * chose. This is the same identity and the same ambiguity rule applied one
 * line at a time, for the hint under a blank Rate ("last ₹ 412 · BG-3",
 * 2026-09-22): a merchandiser pricing 16'S GREY MELANGE knows it was ₹412
 * last month, and the screen should say so rather than send them looking.
 *
 * Three things the rule keeps from `copyRatesFrom`, deliberately:
 *
 * - THE NEWEST BUDGET THAT PRICED THE LINE ANSWERS, AND ANSWERS ALONE. The
 *   budgets arrive newest first, approved ones before the rest (the loader's
 *   order); the first one holding the identity is the answer, and a budget
 *   further back is never consulted — last season's rate is not "the last
 *   rate" once a newer one exists.
 * - TWO DIFFERENT RATES IN THAT BUDGET IS NO ANSWER. Same as `ambiguous`:
 *   picking either would be a number nobody chose for this line. The hint
 *   simply does not appear.
 * - THE RATE IS ONE FACT with its currency, exchange rate and rate type —
 *   applying it writes all four, as Copy From does. FOC / Import never
 *   travel; a target that is FOC is not offered anything.
 *
 * NEVER APPLIED ON ITS OWN. This returns a suggestion; the screen writes it
 * only on a click or a keystroke, so an untouched line stays honestly blank
 * (AGENTS.md, Near misses: "never edits the text on its own").
 */
export function lastRateFor(target: CopyLine, history: readonly RateHistoryBudget[]): LastRate | null {
  if (target.is_foc) return null;
  const id = identityOf(target);
  if (!id) return null;
  const spec = norm(target.specification);
  for (const b of history) {
    const all = b.lines.filter(
      (l) => !l.is_foc && l.rate != null && Number.isFinite(l.rate) && identityOf(l) === id,
    );
    if (all.length === 0) continue;
    const sameSpec = spec ? all.filter((c) => norm(c.specification) === spec) : [];
    const pool = sameSpec.length > 0 ? sameSpec : all;
    const fact = factOf(pool[0]);
    if (!pool.every((c) => sameFact(factOf(c), fact))) return null;
    return { ...fact, budget: b.code ?? "" };
  }
  return null;
}
