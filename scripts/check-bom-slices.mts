/**
 * Vectors for `lib/orders/material-bom/slice-consumption.ts` (0442) — what one
 * slice of a Material BOM line consumes when the operator has overridden some
 * of them and not others.
 *
 * ## WHAT IS ACTUALLY AT RISK HERE
 *
 * The store is SPARSE: a missing row means "use the line's figure". So every
 * interesting case is an absence, and an absence read wrongly does not throw —
 * it quietly buys the wrong number of buttons. The three shapes that must not
 * collapse into each other:
 *
 *   no override at all   -> both figures come from the line
 *   one figure typed     -> that one wins, the OTHER still comes from the line
 *   both typed           -> neither comes from the line
 *
 * §2 is the one that would go unnoticed. `?? line` applied to the ROW rather
 * than to each FIELD looks correct, passes a one-figure test, and silently
 * reads `per_pieces` as null on a slice where only `no_of_items` was typed —
 * which refuses the slice instead of inheriting.
 *
 * Run: `npm run check:bom-slices`.
 */
import {
  consumptionFor,
  liveOverrides,
  overrideFor,
  sliceKey,
  type SliceOverride,
} from "../lib/orders/material-bom/slice-consumption.ts";

let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok    ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}\n          got  ${a}\n          want ${e}`);
  }
}

const S = "size-s";
const M = "size-m";
const L = "size-l";

const LINE = { no_of_items: 2, per_pieces: 1 };

const ov = (
  combo: string | null,
  size_id: string | null,
  no_of_items: number | null,
  per_pieces: number | null,
): SliceOverride => ({ combo, size_id, no_of_items, per_pieces });

const at = (combo: string | null, size_id: string | null) => ({ combo, size_id });

console.log("\n§1  No override — the line's figures reach every slice");

check("both come from the line", consumptionFor(LINE, [], at(null, S)), LINE);
check("a null store is the same as an empty one", consumptionFor(LINE, null, at(null, S)), LINE);
check(
  "an override for a DIFFERENT slice does not leak",
  consumptionFor(LINE, [ov(null, M, 9, 9)], at(null, S)),
  LINE,
);

console.log("\n§2  One figure typed — the OTHER still inherits");

check(
  "only no_of_items typed: per_pieces still comes from the line",
  consumptionFor(LINE, [ov(null, L, 5, null)], at(null, L)),
  { no_of_items: 5, per_pieces: 1 },
);
check(
  "only per_pieces typed: no_of_items still comes from the line",
  consumptionFor(LINE, [ov(null, L, null, 4)], at(null, L)),
  { no_of_items: 2, per_pieces: 4 },
);
// THE REGRESSION, named. `override ?? line` on the ROW returns the override
// whole, so the untyped half arrives as null — which refuses the slice.
check(
  "the untyped half is never null",
  consumptionFor(LINE, [ov(null, L, 5, null)], at(null, L)).per_pieces === null,
  false,
);

console.log("\n§3  Both typed — nothing comes from the line");

check(
  "the override wins outright",
  consumptionFor(LINE, [ov(null, L, 7, 3)], at(null, L)),
  { no_of_items: 7, per_pieces: 3 },
);
// A ZERO IS AN ANSWER, not an absence — `||` here would silently inherit.
check(
  "a zero no_of_items is honoured, not treated as blank",
  consumptionFor(LINE, [ov(null, L, 0, 2)], at(null, L)),
  { no_of_items: 0, per_pieces: 2 },
);

console.log("\n§4  The key — combo AND size, case-insensitively");

check(
  "a colour-wise override matches on the combo alone",
  consumptionFor(LINE, [ov("WHITE", null, 6, 1)], at("WHITE", null)),
  { no_of_items: 6, per_pieces: 1 },
);
check(
  "case and padding do not break the match",
  consumptionFor(LINE, [ov(" white ", null, 6, 1)], at("WHITE", null)),
  { no_of_items: 6, per_pieces: 1 },
);
check(
  "a combination override needs BOTH to agree",
  consumptionFor(LINE, [ov("WHITE", L, 8, 1)], at("WHITE", L)),
  { no_of_items: 8, per_pieces: 1 },
);
check(
  "same colour, different size, is a different slice",
  consumptionFor(LINE, [ov("WHITE", L, 8, 1)], at("WHITE", M)),
  LINE,
);
check(
  "same size, different colour, is a different slice",
  consumptionFor(LINE, [ov("WHITE", L, 8, 1)], at("NAVY", L)),
  LINE,
);
// A null axis is a VALUE ("this basis has no colour"), not a wildcard.
check(
  "an order-wise override does not answer a colour-wise slice",
  consumptionFor(LINE, [ov(null, null, 8, 1)], at("WHITE", null)),
  LINE,
);
check("the key normalises both halves", sliceKey(at(" navy ", M)), `NAVY:${M}`);

console.log("\n§5  overrideFor returns the row, or null");

check("found", overrideFor([ov("WHITE", null, 6, 1)], at("WHITE", null))?.no_of_items, 6);
check("not found is null, never undefined", overrideFor([], at("WHITE", null)), null);

console.log("\n§6  liveOverrides — the grid follows the order exactly");

const stored = [ov("WHITE", S, 1, 1), ov("WHITE", M, 2, 1), ov("WHITE", L, 3, 1)];
check(
  "an override whose size the order dropped is not kept",
  liveOverrides(stored, [at("WHITE", S), at("WHITE", M)]).map((o) => o.size_id),
  [S, M],
);
check(
  "everything still on the order survives",
  liveOverrides(stored, [at("WHITE", S), at("WHITE", M), at("WHITE", L)]).length,
  3,
);
check("nothing live keeps nothing", liveOverrides(stored, []).length, 0);
check("a null store is an empty list, never a throw", liveOverrides(null, []), []);

console.log(
  failed === 0
    ? "\nOK — every BOM slice vector holds."
    : `\n${failed} vector(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
