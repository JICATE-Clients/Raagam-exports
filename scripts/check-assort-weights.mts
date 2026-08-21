/**
 * Vectors for `assortSizeWeights` / `assortMode` in `lib/orders/assort-weights.ts`
 * — what a size cell on the Quantities ▸ Assort tree is worth in pieces.
 *
 * ## WHY THIS FILE EXISTS
 *
 * The rule had no vectors and three hand-copied implementations, and two of them
 * were wrong for two years' worth of orders in the same way: they multiplied
 * every size by `no_of_cartons`, which on a SOLID/SOLID pack is zero.
 *
 * The failure mode is the reason this is vectored rather than eyeballed. A wrong
 * total announces itself; a wrong ZERO does not. The Material BOM refused with
 * "Size break-up has no quantities for WHITE" — pointing at the order, which was
 * correct — and the budget valued the order at nothing, which reads exactly like
 * an order nobody has entered yet. Neither said "I could not read this."
 *
 * So §1 and §2 below are not really testing arithmetic. They are testing that
 * the two MODES are told apart at all, which is the thing the copies never did.
 *
 * Run: `npm run check:assort-weights`.
 */
import {
  assortMode,
  assortSizeWeights,
  type AssortQuantity,
} from "../lib/orders/assort-weights.ts";

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

const SZ_S = "size-s";
const SZ_M = "size-m";

const line = (combo: string, cartons: number | null, inners: number | null, sizes: number[]) => ({
  combo,
  no_of_cartons: cartons,
  inners_per_carton: inners,
  sizes: [
    { size_id: SZ_S, qty: sizes[0] ?? null },
    { size_id: SZ_M, qty: sizes[1] ?? null },
  ],
});

const dest = (
  type: { code: string | null; name: string | null } | null,
  lines: ReturnType<typeof line>[],
  ref = "TSH-001",
): AssortQuantity => ({
  style_ref_no: ref,
  assortment_type: type,
  assort_lines: lines,
});

const SOLID = { code: "solid_solid", name: "Solid Colour / Solid Size" };
const ASSORT = { code: "solid_assort", name: "Solid Colour / Assort Size" };

const total = (q: AssortQuantity[]) =>
  assortSizeWeights(q).reduce((a, w) => a + w.qty, 0);

console.log("\n§1  SOLID/SOLID — the cell IS the pieces, and there is no carton count");

// The live order this was found on: cartons 0, sizes summing to the approval qty.
const solidOrder = [dest(SOLID, [line("WHITE", 0, 1, [1500, 1000])])];

check("the cells are counted at face value", total(solidOrder), 2500);
// THE REGRESSION, stated as itself: the old expression was `cartons x qty`, and
// cartons is 0 on every solid pack, so it returned this.
check("NOT zero — which is what `no_of_cartons x qty` returned", total(solidOrder) === 0, false);
check(
  "a null carton count is just as harmless",
  total([dest(SOLID, [line("WHITE", null, null, [200, 300])])]),
  500,
);

console.log("\n§2  SOLID/ASSORT — the cell is a RATIO, and inners are part of it");

const assortOrder = [dest(ASSORT, [line("WHITE", 10, 12, [2, 3])])];
check("cartons x inners x ratio", total(assortOrder), 10 * 12 * 5);
// The second bug the copies carried, and the one that hides: every live order
// has inners = 1, so dropping it changes nothing until one does not.
check(
  "NOT cartons x ratio — that silently under-buys by the inner count",
  total(assortOrder) === 10 * 5,
  false,
);
check(
  "with inners of 1 the two readings agree, which is why this hid",
  total([dest(ASSORT, [line("WHITE", 10, 1, [2, 3])])]),
  50,
);
check(
  "an assort pack with no cartons entered yet is genuinely zero",
  total([dest(ASSORT, [line("WHITE", 0, 12, [2, 3])])]),
  0,
);

console.log("\n§3  The mode is READ, never inferred");

check("solid_solid is solid", assortMode(dest(SOLID, [])), "solid");
check("solid_assort is assort", assortMode(dest(ASSORT, [])), "assort");
// Rows that predate 0400 carry no code, so the NAME is the fallback.
check(
  "no code falls back to the name",
  assortMode(dest({ code: null, name: "Solid Colour / Assort Size" }, [])),
  "assort",
);
check(
  "and a name that is not assort reads solid",
  assortMode(dest({ code: null, name: "Solid Colour / Solid Size" }, [])),
  "solid",
);
check("an unset type reads solid — face value, never x0", assortMode(dest(null, [])), "solid");
// THE VECTOR THAT KILLS THE TEMPTING SHORTCUT. Inferring "solid" from a zero
// carton count would switch arithmetic under a half-filled assort row.
check(
  "a zero carton count does NOT make an assort pack solid",
  assortMode(dest(ASSORT, [line("WHITE", 0, 0, [2, 3])])),
  "assort",
);

console.log("\n§4  The style is the DESTINATION's, and rows stay per cell");

check(
  "every cell keeps its own row — a caller that wants a total sums them",
  assortSizeWeights(solidOrder).length,
  2,
);
check(
  "the style comes off the destination, not the line",
  assortSizeWeights(solidOrder).map((w) => w.style_ref_no),
  ["TSH-001", "TSH-001"],
);
check(
  "and the combo off the line",
  assortSizeWeights(solidOrder).map((w) => w.combo),
  ["WHITE", "WHITE"],
);
check("nothing to read is an empty list, never a throw", assortSizeWeights(null), []);

console.log("\n§5  Two destinations of different modes in one order");

// The case a single global reading gets wrong: one order, both arithmetics.
const mixed = [
  dest(SOLID, [line("WHITE", 0, 1, [100, 200])]),
  dest(ASSORT, [line("NAVY", 5, 2, [1, 1])], "TSH-002"),
];
check("each destination uses its own mode", total(mixed), 300 + 5 * 2 * 2);

console.log(
  failed === 0
    ? "\nOK — every assort-weight vector holds."
    : `\n${failed} vector(s) FAILED.`,
);
process.exit(failed === 0 ? 0 : 1);
