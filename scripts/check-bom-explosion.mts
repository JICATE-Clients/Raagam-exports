/**
 * Vectors for the Material BOM explosion grain (`lib/orders/bom-explosion/exploder.ts`).
 *
 * Run: `npm run check:bom-explosion` (tsx, not `--experimental-strip-types`: the
 * module imports through the `@/` alias, which Node's ESM resolver refuses and
 * tsx reads out of tsconfig — the same reason `check-bom-requirement.mts` says).
 *
 * ## THE TWO THINGS THIS FILE EXISTS TO PROVE
 *
 *  1. **The client's 28 permutations collapse.** A grouping key is a SET, so the
 *     order tokens are typed in carries no information. If the collapse is not
 *     asserted it is an opinion, and the five duplicate rows are free to drift
 *     apart the first time somebody edits one of them.
 *  2. **THE BRIDGE IS FAITHFUL.** Every stored `requirement_basis` maps to an
 *     axis set, and that mapping is only safe if the set describes exactly the
 *     grain the basis already emits. So §4 runs the REAL `productionSlices` over
 *     a real fixture and checks that the axis set partitions its output one row
 *     per key — no coarser (rows would merge) and no finer (rows would split).
 *     A comment claiming that would prove nothing; this runs it.
 *
 * Every vector here was made to FAIL first.
 */

import {
  AXES,
  axesAvailable,
  axesOfBasis,
  basisForAxes,
  canonicalAxes,
  groupKeyFor,
  isRefusal,
  labelFor,
  parseAxes,
  rowCountFor,
  serializeAxes,
  type Axis,
} from "@/lib/orders/bom-explosion/exploder";
import {
  CLIENT_GRAIN_MATRIX,
  COMBINATION_LOCKED_HINT,
  COMBINATION_UNLOCKED_HINT,
  EXTRA_SERVED,
  namesCombination,
  blockedRows,
  servedRows,
} from "@/lib/orders/bom-explosion/client-matrix";
import {
  productionSlices,
  isRefusal as isEngineRefusal,
  REQUIREMENT_BASES,
  type ApprovalRow,
  type AssortSizeRow,
  type ComboRow,
  type OrderProductionInput,
  type RequirementBasis,
} from "@/lib/orders/material-bom/requirement";
import {
  orderAxesOf,
  producibleGrains,
  slicesForAxes,
} from "@/lib/orders/bom-explosion/compose";

let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(
      `FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`ok    ${label}`);
  }
}

/** Asserts a value is NOT something — for the wrong answers a plausible
 *  implementation would give. Same helper `check-bom-requirement.mts` carries. */
function refute(label: string, actual: unknown, notExpected: unknown) {
  const same = JSON.stringify(actual) === JSON.stringify(notExpected);
  if (same) {
    failed++;
    console.error(`FAIL  ${label}\n      must not equal ${JSON.stringify(notExpected)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

function refusalOf(v: unknown): string | null {
  return isRefusal(v) ? v.refused : null;
}

// ---------------------------------------------------------------------------
// 1. Canonical form — the collapse is structural
// ---------------------------------------------------------------------------

console.log("§1  canonical form");

check("axes sort into AXES order, not the order typed", canonicalAxes(["size", "colour"]), [
  "colour",
  "size",
]);
check("...and the reverse gives the identical list", canonicalAxes(["colour", "size"]), [
  "colour",
  "size",
]);
check(
  "#4 and #10 are ONE grain, which is the whole dedup argument",
  serializeAxes(["style_ref", "colour", "size"]),
  serializeAxes(["style_ref", "size", "colour"]),
);
check("a repeated axis is not a finer grain", canonicalAxes(["colour", "colour"]), ["colour"]);
check(
  "the stored form is lowercase and +-joined",
  serializeAxes(["colour", "style_ref"]),
  "style_ref+colour",
);
/* THE WHOLE-ORDER GRAIN IS THE ABSENCE OF AXES, not a seventh axis called
   "order". A token of its own would have to be special-cased by every reader. */
check("no axes serializes to empty, never to 'order'", serializeAxes([]), "");
refute("...emphatically not 'order'", serializeAxes([]), "order");

console.log("\n§2  parsing — refuses, never throws");

check("a stored grain round-trips", parseAxes("style_ref+colour"), ["style_ref", "colour"]);
check("parsing canonicalises too", parseAxes("size+colour"), ["colour", "size"]);
check("empty is the whole order, not a refusal", parseAxes(""), []);
check("null is the whole order too", parseAxes(null), []);
check("case and padding are tolerated on the way in", parseAxes(" STYLE_REF + COLOUR "), [
  "style_ref",
  "colour",
]);
check(
  "an unknown token REFUSES with a sentence",
  refusalOf(parseAxes("style_ref+banana")),
  '"banana" is not a split this order can be exploded by',
);
/* THE SPEC'S PARSER THREW HERE. A throw inside this pipeline takes the screen
   down; a refusal prints in one cell and names what to fix. */
refute("...it does not fall back to the whole order", parseAxes("banana"), []);
check(
  "a display label is NOT a stored grain, and says so rather than half-matching",
  refusalOf(parseAxes("Style Ref No / Order Color")),
  '"style ref no / order color" is not a split this order can be exploded by',
);

console.log("\n§3  labels are DERIVED — one direction only");

check(
  "the client's #19 reads back exactly",
  labelFor(["style_ref", "colour", "size"]),
  "Style Ref No / Order Color / Order Size",
);
check(
  "#24 is the same label, because it is the same grain",
  labelFor(["style_ref", "size", "colour"]),
  "Style Ref No / Order Color / Order Size",
);
check("#12", labelFor(["style_ref"]), "Style Ref No");
check("#28", labelFor(["country"]), "Country");
check("#26", labelFor(["trim_colour", "colour"]), "Order Color / Combination");
check("#16", labelFor(["style_ref", "country", "colour", "size"]),
  "Style Ref No / Order Color / Order Size / Country");
/* NAMED, never blank — a blank cell and "the whole order" must not look alike. */
check("#1 is named", labelFor([]), "Whole order");

console.log("\n§4  the client's 28 permutations, as sets");

/**
 * The matrix, transcribed. `null` marks a token this schema cannot resolve, so
 * the row is counted as unavailable rather than silently dropped — the whole
 * point of enumerating it here is that the gaps are visible.
 */
type Perm = { n: number; axes: Axis[] | null };
const PERMUTATIONS: Perm[] = [
  { n: 1, axes: [] },
  { n: 2, axes: ["style_ref"] },
  { n: 3, axes: ["style_ref", "colour"] },
  { n: 4, axes: ["style_ref", "colour", "size"] },
  { n: 5, axes: ["style_ref", "size"] },
  { n: 6, axes: ["style_ref", "trim_colour"] },
  { n: 7, axes: ["style_ref", "trim_colour", "colour"] },
  { n: 8, axes: ["style_ref", "trim_colour", "size"] },
  { n: 9, axes: ["style_ref", "colour", "trim_colour"] },
  { n: 10, axes: ["style_ref", "size", "colour"] },
  { n: 11, axes: null }, // Style / Pack Ref No / Combination
  { n: 12, axes: ["style_ref"] },
  { n: 13, axes: ["style_ref", "trim_colour"] },
  { n: 14, axes: ["style_ref", "trim_colour", "colour"] },
  { n: 15, axes: null }, // Style Ref No / Combination / Pack Ref No
  { n: 16, axes: ["style_ref", "country", "colour", "size"] },
  { n: 17, axes: ["style_ref", "colour"] },
  { n: 18, axes: ["style_ref", "colour", "trim_colour"] },
  { n: 19, axes: ["style_ref", "colour", "size"] },
  { n: 20, axes: ["style_ref", "colour", "size", "trim_colour"] },
  { n: 21, axes: ["style_ref", "colour", "size"] }, // + Order No, constant in one BOM
  { n: 22, axes: ["style_ref", "size"] },
  { n: 23, axes: ["style_ref", "size", "trim_colour"] },
  { n: 24, axes: ["style_ref", "size", "colour"] },
  { n: 25, axes: null }, // Style Ref No / Pack Ref No
  { n: 26, axes: ["trim_colour", "colour"] },
  { n: 27, axes: null }, // Combination / Pack Ref No
  { n: 28, axes: ["country"] },
];

check("the matrix is transcribed in full", PERMUTATIONS.length, 28);

const resolvable = PERMUTATIONS.filter((p) => p.axes !== null);
check("four permutations have no Pack Ref No to resolve", 28 - resolvable.length, 4);

const distinct = new Set(resolvable.map((p) => serializeAxes(p.axes as Axis[])));
/* 24 resolvable rows over TWELVE distinct grains — counted by this assertion,
   not by hand. The first hand count said eleven and was wrong, which is the
   argument for the assertion existing: the duplicates the client's own table
   flags (#10, #24), the ones it does not (#9=#7, #18=#14, #21=#19), and every
   `Style` row collapsing onto its `Style Ref No` twin (this schema carries one
   style axis, `garment_order_amendment_styles.style_ref_no`) are more than a
   reader can hold in their head. */
check("24 resolvable permutations are 12 distinct grains", distinct.size, 12);
refute("...they are emphatically not 24 different things", distinct.size, 24);

const keyOf = (n: number) => serializeAxes(PERMUTATIONS.find((p) => p.n === n)!.axes as Axis[]);
check("#9 is #7", keyOf(9), keyOf(7));
check("#10 is #4", keyOf(10), keyOf(4));
check("#18 is #14", keyOf(18), keyOf(14));
check("#24 is #19", keyOf(24), keyOf(19));
check("#21 is #19 once the constant Order No is dropped", keyOf(21), keyOf(19));
check("#2 is #12 — one style axis on this schema", keyOf(2), keyOf(12));
/* AND THE ONES THAT ARE GENUINELY DIFFERENT STAY DIFFERENT. A dedup that
   collapses too far is the same defect pointing the other way. */
refute("#19 is not #22 — dropping the colour is a different grain", keyOf(19), keyOf(22));
refute("#16 is not #19 — the destination divides", keyOf(16), keyOf(19));
refute("#26 is not #3 — the trim colour is its own axis", keyOf(26), keyOf(3));

console.log("\n§5  an unavailable axis REFUSES rather than bucketing");

check("an available grain says so", axesAvailable(["style_ref", "colour"]), true);
check(
  "Pack Ref No refuses and names what is missing",
  refusalOf(axesAvailable(["style_ref", "pack"])),
  "Pack Ref No is not on the order yet — no packing reference to split by",
);
/* THE DANGEROUS ALTERNATIVE. Treating the missing axis as one bucket produces
   the SAME rows as the grain without it — a silently coarser split that reads
   as a correct answer, which is the blank-supply-type failure. */
refute("...it does not silently behave as if the axis were absent", axesAvailable(["pack"]), true);

console.log("\n§6  grouping keys — NULL is a value, and it is not 'any'");

const slice = (over: Record<string, string | null> = {}) => ({
  style_ref_no: null,
  combo: null,
  size_id: null,
  item_color_id: null,
  country_id: null,
  ...over,
});

check(
  "a name is compared upper-cased and trimmed, as the engine compares it",
  groupKeyFor(["colour"], slice({ combo: " white " })),
  groupKeyFor(["colour"], slice({ combo: "WHITE" })),
);
check(
  "an id is compared verbatim",
  groupKeyFor(["size"], slice({ size_id: "SZ-1" })),
  "size:SZ-1",
);
/* THE SPEC SUBSTITUTED 'any' FOR A MISSING VALUE, and 'any' is a legal colour
   name — so a garment genuinely coloured ANY would key identically to one with
   no colour at all. NULL is encoded as an empty field and compared. */
refute(
  "a null colour does not key the same as a colour named ANY",
  groupKeyFor(["colour"], slice({ combo: null })),
  groupKeyFor(["colour"], slice({ combo: "ANY" })),
);
refute(
  "...nor the same as one named NONE",
  groupKeyFor(["colour"], slice({ combo: null })),
  groupKeyFor(["colour"], slice({ combo: "NONE" })),
);
/* AXES NOT IN THE GRAIN ARE NOT READ. `productionSlices` keeps `style_ref_no`
   on a size-wise row only where the order has ONE style, as provenance — so a
   key that read whatever was non-null would group a one-style order by style
   and a two-style order not, which is a grain that changes with the data. */
check(
  "a field outside the grain does not divide",
  groupKeyFor(["size"], slice({ size_id: "SZ-1", style_ref_no: "TSH-001" })),
  groupKeyFor(["size"], slice({ size_id: "SZ-1", style_ref_no: "TSH-002" })),
);
check("an empty grain gives one key for everything", groupKeyFor([], slice({ combo: "WHITE" })), "");
check(
  "...so every slice lands in one row",
  rowCountFor([], [slice({ combo: "WHITE" }), slice({ combo: "NAVY" })]),
  1,
);
check(
  "and a colour grain gives one row per colour",
  rowCountFor(["colour"], [slice({ combo: "WHITE" }), slice({ combo: "NAVY" }), slice({ combo: "WHITE" })]),
  2,
);

// ---------------------------------------------------------------------------
// 7. THE BRIDGE — the axis set must describe what the basis already emits
// ---------------------------------------------------------------------------

console.log("\n§7  the bridge from the six stored bases");

const S1 = "TSH-001";
const S2 = "TSH-002";
const SZ_S = "11111111-1111-1111-1111-111111111111";
const SZ_M = "22222222-2222-2222-2222-222222222222";
const CT_US = "aaaaaaaa-0000-0000-0000-000000000001";
const CT_CH = "aaaaaaaa-0000-0000-0000-000000000002";

const approval = (qty: number, combo: string, ref: string): ApprovalRow => ({
  style_ref_no: ref,
  combo,
  qty,
  approval_qty: 0,
});
const comboRow = (combo: string, ref: string): ComboRow => ({ style_ref_no: ref, combo });
const assort = (
  size: string,
  qty: number,
  combo: string,
  ref: string,
  country: string | null = null,
): AssortSizeRow => ({ style_ref_no: ref, combo, size_id: size, qty, country_id: country });

/**
 * TWO STYLES AND TWO COLOURS, on purpose.
 *
 * A one-style fixture cannot tell `{size}` from `{style_ref, size}` — the
 * opportunistic `style_ref_no` is populated in both and every key agrees. That
 * is exactly the confusion §6's "a field outside the grain does not divide"
 * vector is about, so the fixture has to be able to catch it.
 */
const ORDER: OrderProductionInput = {
  excessPct: 0,
  rejectionRuleChosen: false,
  tiers: null,
  approvals: [
    approval(300, "WHITE", S1),
    approval(200, "NAVY", S1),
    approval(240, "WHITE", S2),
  ],
  combos: [comboRow("WHITE", S1), comboRow("NAVY", S1), comboRow("WHITE", S2)],
  assortSizes: [
    assort(SZ_S, 100, "WHITE", S1, CT_US),
    assort(SZ_M, 200, "WHITE", S1, CT_CH),
    assort(SZ_S, 80, "NAVY", S1, CT_US),
    assort(SZ_M, 120, "NAVY", S1, CT_CH),
    assort(SZ_S, 90, "WHITE", S2, CT_US),
    assort(SZ_M, 150, "WHITE", S2, CT_CH),
  ],
  sizeNames: { [SZ_S]: "S", [SZ_M]: "M" },
  countryNames: { [CT_US]: "USA", [CT_CH]: "CHINA" },
};

for (const basis of REQUIREMENT_BASES) {
  const slices = productionSlices(basis as RequirementBasis, ORDER);
  if (isEngineRefusal(slices)) {
    failed++;
    console.error(`FAIL  fixture cannot produce '${basis}': ${slices.refused}`);
    continue;
  }
  const axes = axesOfBasis(basis as RequirementBasis);

  /* ONE KEY PER SLICE, EXACTLY. Fewer keys than slices means the axis set is
     COARSER than the basis — two rows the engine emits separately would merge,
     and a requirement would be understated. More is impossible (a key is a
     function of the slice), so this single equality is the whole proof. */
  check(
    `'${basis}' -> {${axes.join(", ") || "no axes"}} partitions its own slices 1:1`,
    rowCountFor(axes, slices),
    slices.length,
  );
}

/* AND THE SETS ARE DISTINCT FROM EACH OTHER, or the bridge would map two bases
   onto one grain and a stored row would change meaning. `size` and `country`
   are the pair most at risk: both collapse the colour axis and both carry an
   opportunistic style. */
const bridged = REQUIREMENT_BASES.map((b) => serializeAxes(axesOfBasis(b as RequirementBasis)));
check("the six bases map to six distinct grains", new Set(bridged).size, REQUIREMENT_BASES.length);

/* THE ONE THAT LOOKS LIKE A DETAIL. `colour` keys on (style, combo) and not on
   combo alone — WHITE exists under both styles in this fixture with different
   targets, and collapsing them would let one style's white absorb the other's. */
check("'colour' is {style_ref, colour}, never {colour}", serializeAxes(axesOfBasis("colour")), "style_ref+colour");
const colourSlices = productionSlices("colour", ORDER);
check(
  "...which the fixture proves: two styles' WHITE stay apart",
  isEngineRefusal(colourSlices) ? -1 : rowCountFor(["colour"], colourSlices),
  2,
);
refute(
  "...so a {colour}-only grain would have merged them and understated the requirement",
  isEngineRefusal(colourSlices) ? -1 : rowCountFor(["colour"], colourSlices),
  isEngineRefusal(colourSlices) ? -1 : colourSlices.length,
);

/*
 * WHAT §7'S 1:1 TEST CANNOT PROVE, said out loud.
 *
 * A partition count only catches an axis set that is too COARSE — rows the
 * engine emits separately merging into one, which understates a requirement.
 * Too FINE is unreachable: a key is a function of the slice, so there can never
 * be more keys than slices. That asymmetry is the right way round (coarse is the
 * direction that loses money), but it means `size -> {size}` and
 * `size -> {style_ref, size}` BOTH pass §7, because the `size` basis never
 * divides by style and its opportunistic `style_ref_no` is null the moment an
 * order has two.
 *
 * So the choice is evidenced directly instead: on a TWO-STYLE order the size
 * rows carry no style at all. That is `primarySlices`' own rule — "the STYLE is
 * kept only where the order has one... a row keyed to a style the operator did
 * not ask to split by would imply a division that was never requested" — and it
 * is why `{size}` is the honest description and `{style_ref, size}` would be a
 * grain this basis has never had.
 */
const sizeSlices = productionSlices("size", ORDER);
check(
  "on a two-style order, size rows carry NO style — so style is not one of its axes",
  isEngineRefusal(sizeSlices) ? null : sizeSlices.map((s) => s.style_ref_no),
  [null, null],
);
check(
  "...and there are two of them, one per size, colours collapsed",
  isEngineRefusal(sizeSlices) ? -1 : sizeSlices.length,
  2,
);

/* EVERY AXIS IS REACHABLE FROM SOME BASIS, except the two that are not stored
   yet. If this ever drops, an axis exists that nothing can produce. */
const reachable = new Set(REQUIREMENT_BASES.flatMap((b) => axesOfBasis(b as RequirementBasis)));
check(
  "the axes no stored basis reaches are exactly trim_colour and pack",
  AXES.filter((a) => !reachable.has(a)),
  ["trim_colour", "pack"],
);

// ---------------------------------------------------------------------------
// 8. The composer — a grain PRODUCES the rows it names
// ---------------------------------------------------------------------------

console.log("\n§8  the composer");

/** Total across a produced grain. Every grain must total the same order. */
function totalOf(v: ReturnType<typeof slicesForAxes>): number | null {
  if (isRefusal(v) || isEngineRefusal(v as never)) return null;
  return (v as { qty: number }[]).reduce((a, s) => a + s.qty, 0);
}

const ORDER_TOTAL = 740; // 300 + 200 + 240, the fixture's approvals

/*
 * THE PLAN TABLE IS CHECKED, NOT TRUSTED.
 *
 * `PLANS` claims that a given grain is reachable by a given (basis, tick) pair.
 * That claim was measured against the real engine before it was written down,
 * and this re-measures it: the rows a plan produces must be partitioned 1:1 by
 * the grain it advertises. A table asserting its own correctness in a comment
 * would be worth nothing — this is the same argument §7 makes for the bridge.
 */
for (const axes of producibleGrains()) {
  const label = serializeAxes(axes) || "(whole order)";
  const rows = slicesForAxes(axes, ORDER);
  if (isRefusal(rows)) {
    failed++;
    console.error(`FAIL  '${label}' should be producible: ${rows.refused}`);
    continue;
  }
  check(`'${label}' rows are partitioned 1:1 by the grain they claim`, rowCountFor(axes, rows), rows.length);
  /* AND EVERY GRAIN TOTALS THE SAME ORDER. This is the invariant the whole
     requirement suite leans on hardest: a finer cut must not create or lose
     pieces, or two attributes would disagree about one order. */
  check(`'${label}' totals the order`, totalOf(rows), ORDER_TOTAL);
}

/* THE GRAIN COUNTS, so a partition that is technically 1:1 but the wrong SIZE
   is caught. The fixture is 2 styles x (2,1) colourways x 2 sizes x 2 countries. */
const rowsOf = (axes: Axis[]) => {
  const r = slicesForAxes(axes, ORDER);
  return isRefusal(r) ? -1 : r.length;
};
check("{} is one row", rowsOf([]), 1);
check("{style_ref} is 2 — one per style", rowsOf(["style_ref"]), 2);
check("{size} is 2 — colours collapsed", rowsOf(["size"]), 2);
check("{country} is 2 — one per destination", rowsOf(["country"]), 2);
check("{style_ref, colour} is 3 — WHITE under two styles stays apart", rowsOf(["style_ref", "colour"]), 3);
check("{style_ref, size} is 4 — the client's #5 / #22", rowsOf(["style_ref", "size"]), 4);
check("{size, country} is 4", rowsOf(["size", "country"]), 4);
check("{style_ref, colour, size} is 6", rowsOf(["style_ref", "colour", "size"]), 6);
/* THE CLIENT'S #16, the one grain this module composes rather than delegates.
   Each of the 6 colour-size rows ships to exactly one destination in this
   fixture (S -> USA, M -> CHINA), so refining by country does not multiply. */
check("{style_ref, colour, size, country} is 6 — each size ships to one place", rowsOf(["style_ref", "colour", "size", "country"]), 6);

/* AND IT REALLY CARRIES THE DESTINATION, rather than passing the count by
   accident with a null in every row. */
const matrix = slicesForAxes(["style_ref", "colour", "size", "country"], ORDER);
check(
  "...and every row names its destination",
  isRefusal(matrix) ? null : matrix.every((s) => !!s.country_id),
  true,
);
check(
  "...labelled through to the country",
  isRefusal(matrix) ? null : matrix[0].label,
  "TSH-001 · WHITE · S · USA",
);

console.log("\n§9  a grain that cannot be produced REFUSES by name");

check(
  "Pack Ref No refuses before any work",
  refusalOf(slicesForAxes(["style_ref", "pack"], ORDER)),
  "Pack Ref No is not on the order yet — no packing reference to split by",
);
/* {colour} ALONE — the client's #26. The engine argues against it: a colourway
   belongs to a style, and collapsing WHITE across two styles lets one absorb the
   other's target. So it is REFUSED BY NAME rather than quietly answered. */
check(
  "colour-across-styles refuses and says why",
  refusalOf(slicesForAxes(["colour"], ORDER)),
  "Colour across every style is not a split this engine makes — a colourway belongs to a style (see #26)",
);
refute(
  "...it does not silently answer as {style_ref, colour}",
  rowsOf(["colour"]),
  rowsOf(["style_ref", "colour"]),
);
check(
  "an unreachable grain names itself",
  refusalOf(slicesForAxes(["style_ref", "country"], ORDER)),
  "Style Ref No / Country is not a split this order can be exploded by yet",
);

/* TRIM COLOUR IS NOT AN ORDER AXIS. It is applied per BOM LINE by `colourSplits`
   downstream, so a grain carrying it must produce the same ORDER rows as the
   same grain without it — otherwise the trim colour would divide twice. */
check(
  "trim_colour does not divide the order",
  orderAxesOf(["style_ref", "colour", "trim_colour"]),
  ["style_ref", "colour"],
);
check(
  "...so it produces the same rows",
  rowsOf(["style_ref", "colour", "trim_colour"] as Axis[]),
  rowsOf(["style_ref", "colour"]),
);

console.log("\n§10  the size tick is IDEMPOTENT — a size crossed with itself is not a grain");

/*
 * THE DEFECT THIS SECTION EXISTS FOR (found by probe, 2026-08-23, fixed the same
 * day). `size` and `combination` are already one row per size, and the per-row
 * tick split them AGAIN: "WHITE · S · S", "WHITE · S · M", "WHITE · M · S",
 * "WHITE · M · M". Every pair is identical on (style_ref_no, combo, size_id,
 * country_id), so `uq_mba_req_slice` refuses the second insert and the SAVE dies
 * on a constraint name — after the screen has already drawn the doubled rows.
 *
 * Reachable because neither basis left the system when it left the MENU on
 * 2026-08-21: both are live CHECK values documented to keep resolving, and the
 * tick is stored per slice, independently of the basis.
 */
for (const basis of ["size", "combination"] as RequirementBasis[]) {
  const plain = productionSlices(basis, ORDER);
  const ticked = productionSlices(basis, ORDER, undefined, () => true);
  check(
    `'${basis}' already IS the size grain, so the tick adds nothing`,
    isEngineRefusal(ticked) ? null : ticked,
    isEngineRefusal(plain) ? null : plain,
  );
  refute(
    `...it does not square the size axis on '${basis}'`,
    isEngineRefusal(ticked) ? -1 : ticked.length,
    isEngineRefusal(plain) ? -1 : plain.length * 2,
  );
}

/* THE TICK STILL WORKS WHERE THE GRAIN LACKS SIZE — the guard must be narrow, or
   it would silently disable the feature. These two are the engine's own
   documented equivalences and they must survive it. */
const orderTicked = productionSlices("order", ORDER, undefined, () => true);
check(
  "'order' + tick still IS the size basis",
  isEngineRefusal(orderTicked) ? null : orderTicked.map((s) => [s.label, s.qty]),
  (() => {
    const s = productionSlices("size", ORDER);
    return isEngineRefusal(s) ? null : s.map((x) => [x.label, x.qty]);
  })(),
);
const colourTicked = productionSlices("colour", ORDER, undefined, () => true);
check(
  "'colour' + tick still IS the combination basis",
  isEngineRefusal(colourTicked) ? null : colourTicked.map((s) => [s.label, s.qty]),
  (() => {
    const s = productionSlices("combination", ORDER);
    return isEngineRefusal(s) ? null : s.map((x) => [x.label, x.qty]);
  })(),
);

/* THE GUARD AND THE AXIS MODEL MUST AGREE. `requirement.ts` holds the list of
   size-grain bases as a literal to avoid an import cycle, so this is what stops
   the two declarations drifting: the tick is a no-op on EXACTLY the bases whose
   axis set contains `size`. */
for (const basis of REQUIREMENT_BASES) {
  const b = basis as RequirementBasis;
  const hasSize = axesOfBasis(b).includes("size");
  const plain = productionSlices(b, ORDER);
  const ticked = productionSlices(b, ORDER, undefined, () => true);
  const unchanged =
    JSON.stringify(isEngineRefusal(plain) ? null : plain) ===
    JSON.stringify(isEngineRefusal(ticked) ? null : ticked);
  check(`the tick is a no-op on '${basis}' exactly when its axes hold size`, unchanged, hasSize);
}

// ---------------------------------------------------------------------------
// 11. The legacy NAME for a grain (0455 · 0456)
// ---------------------------------------------------------------------------

console.log("\n§11  basisForAxes — a grain's legacy name, where it has one");

/*
 * `material_bom_amendment_requirements.basis` is CHECKed against the six legacy
 * names, so this function is what decides whether a requirement row can carry
 * one. 0456 made the column NULLABLE rather than widening its vocabulary — a
 * column holding two vocabularies would let `'colour'` and `'style_ref+colour'`
 * mean the same thing while comparing unequal.
 */

/* THE ROUND TRIP IS EXACT. `basisForAxes` is derived from `BASIS_AXES` rather
   than hand-written, so this asserts the derivation rather than a second table —
   the day the two disagreed, a stored row would change meaning. */
for (const basis of REQUIREMENT_BASES) {
  const b = basis as RequirementBasis;
  check(`'${basis}' -> axes -> '${basis}'`, basisForAxes(axesOfBasis(b)), b);
}

/* AND ORDER DOES NOT MATTER, because the lookup canonicalises both sides. */
check("a grain typed in any order still finds its name", basisForAxes(["size", "colour", "style_ref"]), "combination");

/* A COMPOSED GRAIN HAS NO NAME, and that is the normal case rather than a gap —
   these were not expressible before the set model. Returning null is what makes
   0456's nullable column necessary. */
check("#16 has no legacy name", basisForAxes(["style_ref", "colour", "size", "country"]), null);
check("{style_ref, size} has no legacy name either", basisForAxes(["style_ref", "size"]), null);
check("{size, country} likewise", basisForAxes(["size", "country"]), null);
/* THE WHOLE-ORDER GRAIN DOES HAVE ONE, and it is not null — a distinction that
   matters because `[]` is falsy-looking and `basis` is what old readers use. */
check("the whole-order grain is named 'order'", basisForAxes([]), "order");
refute("...and is emphatically not nameless", basisForAxes([]), null);

/* HOW THE NINE PRODUCIBLE GRAINS SPLIT. Six carry a legacy name and three do
   not, which is exactly the set 0456's nullable `basis` exists to hold. */
const named = producibleGrains().filter((g) => basisForAxes(g) !== null);
check("six producible grains carry a legacy name", named.length, 6);
check("...and three do not", producibleGrains().length - named.length, 3);

/* -------------------------------------------------------------------------
   THE CLIENT'S 22-ROW ATTRIBUTE LIST

   `client-matrix.ts` claims a mapping from the client's numbered list onto the
   grains this engine produces. A mapping table is worth exactly what the
   assertion behind it is worth - the lesson `PLANS` records one file over - so
   every claim it makes is re-derived here against the real `producibleGrains()`.

   The assertion that earns its place is the LAST one: it is what makes deleting
   a working grain to "match the client's list" fail a check rather than a
   purchase order.
   ------------------------------------------------------------------------- */

check("the client's list is 22 rows", CLIENT_GRAIN_MATRIX.length, 22);

/* NUMBERED 1..22 WITH NO GAPS AND NO REPEATS. The whole point of carrying the
   client's own S.No is that a conversation about "#19" resolves to one row; a
   duplicated or missing number silently breaks that. */
check(
  "S.No runs 1..22 exactly once each",
  CLIENT_GRAIN_MATRIX.map((r) => r.sno).sort((a, b) => a - b),
  Array.from({ length: 22 }, (_, i) => i + 1),
);

/* EVERY ROW ANSWERS, one way or the other. A row with neither a grain nor a
   reason is the state that file exists to make impossible - it reads as
   "handled" in a table and does nothing on screen. */
/* EVERY ROW IS EXPRESSIBLE. Since "enable all" every row carries real axes —
   `blocked` now says whether the engine can BUILD it, not whether it can be
   named. A row with no axes could not be stored at all, so the menu would
   accept the click and write NULL. */
check(
  "every row carries real axes",
  CLIENT_GRAIN_MATRIX.filter((r) => !Array.isArray(r.axes)).length,
  0,
);
/* AND EVERY ROW'S AXES ARE AXES. A typo here compiles (the array is typed) but
   `parseAxes` would refuse the stored value on the way back. */
for (const r of CLIENT_GRAIN_MATRIX) {
  check(
    `#${r.sno} names only real axes`,
    r.axes.every((a) => (AXES as readonly string[]).includes(a)),
    true,
  );
}

check("thirteen of the client's rows produce", servedRows().length, 13);
check("...and nine refuse", blockedRows().length, 9);
/* FIVE OF THE THIRTEEN CARRY `trim_colour` and produce their base grain's rows.
   Counted so that reclassifying one back to "blocked" — the mistake this file
   already made once — fails here rather than silently removing an option. */
check("five produce via the line, not the order", CLIENT_GRAIN_MATRIX.filter((r) => r.downstream).length, 5);

/* EVERY BLOCKED ROW SAYS SOMETHING OF ITS OWN. A refusal that does not name its
   cause sends the operator to the wrong screen. */
for (const r of blockedRows()) {
  check(`#${r.sno} names a reason`, r.reason.length > 20, true);
}

/* EVERY SERVED ROW IS REALLY PRODUCIBLE - asserted against the engine's own plan
   table, not against a second copy of it. This is the claim that would rot
   first: a plan removed from `PLANS` leaves this table pointing at a grain
   nothing can build, and the screen would offer it. */
const producibleKeys = new Set(producibleGrains().map((g) => serializeAxes(g)));
/* COMPARED AT ORDER LEVEL, because that is the grain the engine plans by.
   `trim_colour` is stripped by `orderAxesOf` on its way in (asserted in §9), so
   testing the raw axes would fail all five `downstream` rows and read as five
   missing options. */
for (const r of servedRows()) {
  check(
    `#${r.sno} "${r.label}" is a grain the engine produces`,
    producibleKeys.has(serializeAxes(orderAxesOf(r.axes))),
    true,
  );
}

/*
 * THE ASSERTION THAT MAKES "ENABLE ALL" SAFE.
 *
 * Every row the matrix calls blocked must REFUSE when the engine is asked for
 * it — not return rows. A refusal prints a sentence the operator can act on; a
 * silent collapse to a coarser grain returns a smaller row count and a total
 * that looks entirely correct, which is the partial-explosion failure
 * `requirement.ts` opens its header with.
 *
 * MADE TO FAIL FIRST, and it genuinely did: before `compose.ts` learned to
 * refuse a dropped axis, `["trim_colour"]` PRODUCED 1 ROW rather than refusing,
 * because `orderAxesOf` stripped the token and matched the whole-order plan.
 * Five of the client's rows would have shipped that number.
 */
/* THE FULL FIXTURE §4 ALREADY BUILDS — a real order with combos, sizes,
   approvals and countries. Asking these grains of an EMPTY order would prove
   nothing: everything refuses for want of data, so the collapse this guards
   against would hide inside a refusal that happens to be right. */
for (const r of blockedRows()) {
  const out = slicesForAxes(r.axes, ORDER);
  check(`#${r.sno} "${r.label}" REFUSES rather than collapsing`, isRefusal(out), true);
}

/* NO TWO SERVED ROWS ARE THE SAME GRAIN. Two client rows resolving to one grain
   would put one option in the dropdown twice under two names. */
const servedKeys = servedRows().map((r) => serializeAxes(orderAxesOf(r.axes)));
/* THE FIVE `downstream` ROWS DELIBERATELY DUPLICATE five others at order level —
   #10 "Style / Combination" plans exactly what #6 "Style" plans. So the distinct
   count is 13 - 5 = 8, and asserting THAT rather than uniqueness is what keeps
   the duplication intentional instead of merely tolerated. */
check("the thirteen cover eight distinct order grains", new Set(servedKeys).size, 8);

/* THE ENGINE SERVES NINE AND THE CLIENT NAMED EIGHT - and the ninth is kept.
   `producibleGrains()` must be EXACTLY the served rows plus `EXTRA_SERVED`:
   nothing offered that no row claims, and nothing claimed that is not offered.
   MADE TO FAIL FIRST by emptying `EXTRA_SERVED`, which reported the
   {style_ref, colour, size, country} grain as unaccounted for. */
const accounted = new Set([...servedKeys, ...EXTRA_SERVED.map((e) => serializeAxes(e.axes))]);
check("every producible grain is accounted for", [...producibleKeys].filter((k) => !accounted.has(k)), []);
check("...and nothing accounted for is unproducible", [...accounted].filter((k) => !producibleKeys.has(k)), []);
check("the ninth grain is retained by decision, not by accident", EXTRA_SERVED.length, 1);

/*
 * THE COMBINATION BUTTON'S GATE (client 2026-08-26).
 *
 * The screen enables the Combination cell only where the chosen grain names
 * `trim_colour`, and that is the ONLY thing distinguishing five of the client's
 * rows from five others — "Style / Combination" plans exactly what "Style"
 * plans. So the set of rows that unlock the button is asserted here rather than
 * left to a predicate in a 5,000-line screen: if the matrix stops marking a row
 * `downstream`, or a row gains the token by a copy-paste, the count moves and
 * this fails.
 *
 * `downstream` and "names trim_colour" must be the SAME set. They are two
 * statements of one fact — the flag is what the matrix documents, the token is
 * what the screen tests — and a row carrying one without the other would either
 * enable a button on a grain with no panels or disable it on one with them.
 */
const namesTrimColour = CLIENT_GRAIN_MATRIX.filter((r) => r.axes.includes("trim_colour"));
check("five client rows unlock the Combination button", namesTrimColour.length, 5);
check(
  "...and they are exactly the rows marked downstream",
  namesTrimColour.map((r) => r.sno),
  CLIENT_GRAIN_MATRIX.filter((r) => r.downstream).map((r) => r.sno),
);
/* AND NO OTHER ROW DOES. Named individually rather than counted, because a
   count of five is satisfied by the wrong five. */
check(
  "the unlocking rows are #5, #10, #11, #12, #13",
  namesTrimColour.map((r) => r.sno),
  [5, 10, 11, 12, 13],
);

/*
 * THE ATTRIBUTE TOOLTIP AND THE BUTTON'S REFUSAL ARE ONE FACT.
 *
 * The cell explains the rule, the button explains its own refusal, and both read
 * `namesCombination` and the two sentences from `client-matrix`. Asserted
 * because the failure is silent and directional: a tooltip saying "pick a
 * Combination attribute" beside a button refusing for some OTHER reason sends
 * the operator to change a field that was already right.
 */
for (const r of CLIENT_GRAIN_MATRIX) {
  check(
    `#${r.sno} agrees with its own axes about Combination`,
    namesCombination(r.axes),
    r.axes.includes("trim_colour"),
  );
}
/* NULL IS NOT A COMBINATION — an unanswered line must take the LOCKED sentence,
   not crash and not read as unlocked. `combinationsBlocked` answers "choose an
   Attribute first" ahead of this, but the tooltip has no such ordering and asks
   the question directly. */
check("an unanswered grain does not name a Combination", namesCombination(null), false);
check("...nor does an empty one", namesCombination([]), false);
/* THE TWO SENTENCES ARE DIFFERENT AND BOTH SAY SOMETHING. Two identical hints
   would render the tooltip useless while looking wired up. */
refute("the two hints are not the same sentence", COMBINATION_LOCKED_HINT, COMBINATION_UNLOCKED_HINT);
check("the locked hint names the thing to pick", COMBINATION_LOCKED_HINT.includes("Combination"), true);
check("the unlocked hint names the button", COMBINATION_UNLOCKED_HINT.includes("button"), true);

console.log(failed === 0 ? "\nAll BOM explosion vectors pass." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
