/**
 * WHICH SIZES AN ASSORTMENT OVERLAY HAS COLUMNS FOR.
 *
 * The defect these exist for was reported TWICE in two days — screenshots 2418
 * and 2419 — and shipped both times through a clean `tsc`, a clean build and
 * every audit in the repo. It is invisible to all of them because both sides of
 * the mis-wiring are a `string`:
 *
 *     quantities.style_ref_no   free text, a DESTINATION reference since 08-17
 *     styles.style_ref_no       a real style reference
 *
 * Vector 1 reproduces screenshot 2419 exactly. It must FAIL against the code as
 * it was before `lib/orders/amendments/assort-style.ts` existed, or it is
 * proving nothing — that is this repo's own rule for a new check.
 *
 * Every vector asserts the SIZE LABELS, never a count. A count passes against a
 * union that took the right number of sizes from the wrong style, which is
 * precisely the failure mode here.
 */

import {
  assortLineRef,
  declaredStyleRef,
  defaultSingleStylePack,
  inheritedStyleFor,
  sizesForOverlay,
  sizesOfRef,
  soleStyleRef,
  type AssortQuantity,
  type AssortStyle,
} from "../lib/orders/amendments/assort-style.ts";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok    ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}\n      expected ${e}\n      actual   ${a}`);
  }
}
function refute(label: string, actual: unknown, notExpected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(notExpected)) {
    console.log(`ok    ${label}`);
  } else {
    failed++;
    console.log(`FAIL  ${label}\n      got the value it must not: ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures — sizes carry their id AND a label, so a wrong style is legible in
// the failure output rather than showing up as a different array length.
// ---------------------------------------------------------------------------

const size = (id: string) => ({ size_id: id });
const names = (zs: readonly { size_id: string | null }[]) => zs.map((z) => z.size_id);

/** MENS R NECK — the style in screenshot 2419. */
const TEE: AssortStyle = {
  style_ref_no: "STL/26-27/0002",
  sizes: [size("S"), size("M"), size("L"), size("XL"), size("XXL")],
};
/** A second style with an OVERLAPPING but differently-ordered size set. */
const POLO: AssortStyle = {
  style_ref_no: "STL/26-27/0007",
  sizes: [size("M"), size("L"), size("3XL")],
};
/** The row an operator has just added and not yet named. */
const BLANK: AssortStyle = { style_ref_no: "", sizes: [size("FREE")] };

const dest = (over: Partial<AssortQuantity> = {}): AssortQuantity => ({
  style_ref_no: "",
  is_single_style_pack: true,
  assort_lines: [],
  ...over,
});

// ---------------------------------------------------------------------------
// 1. THE REGRESSION — screenshot 2419, reproduced
// ---------------------------------------------------------------------------

// The destination's Ref No is `12`: free text, a destination reference, and the
// value that was being resolved as a style. One style is declared, so it is the
// only answer there can be.
const twoFourNineteen = dest({ style_ref_no: "12" });

check(
  "Ref No `12` with one declared style still gets that style's sizes",
  names(sizesForOverlay([TEE], twoFourNineteen)),
  ["S", "M", "L", "XL", "XXL"],
);
refute(
  "…and NOT an empty column set, which is the bug in screenshots 2418 and 2419",
  names(sizesForOverlay([TEE], twoFourNineteen)),
  [],
);
check(
  "`12` names no style, and says so",
  declaredStyleRef([TEE], "12"),
  "",
);
check(
  "…so the destination inherits the order's only style",
  inheritedStyleFor([TEE], twoFourNineteen),
  "STL/26-27/0002",
);

// ---------------------------------------------------------------------------
// 2. A Ref No that really IS a style still works
// ---------------------------------------------------------------------------

// It was a style PICKER until 2026-08-17, so real orders still hold style refs
// here and must not regress. Case and padding are normalised.
check(
  "a Ref No naming a declared style resolves to it",
  names(sizesForOverlay([TEE, POLO], dest({ style_ref_no: "STL/26-27/0007" }))),
  ["M", "L", "3XL"],
);
check(
  "…case-insensitively, and trimmed",
  inheritedStyleFor([TEE, POLO], { style_ref_no: "  stl/26-27/0007 " }),
  "STL/26-27/0007",
);
refute(
  "a named style beats the sole-style fallback",
  names(sizesForOverlay([TEE, POLO], dest({ style_ref_no: "STL/26-27/0007" }))),
  ["S", "M", "L", "XL", "XXL"],
);

// ---------------------------------------------------------------------------
// 3. A blank Ref No
// ---------------------------------------------------------------------------

check(
  "blank Ref No with one style takes that style",
  names(sizesForOverlay([TEE], dest())),
  ["S", "M", "L", "XL", "XXL"],
);

// THE GUARD `sizesOfRef` DOCUMENTS. `styleKey("")` is `""`, so a blank
// destination would match a half-typed style row and borrow its sizes — a
// column set the operator never declared, appearing while they are still typing.
check(
  "a blank ref must not borrow a half-typed style row's sizes",
  names(sizesOfRef([BLANK, TEE], "")),
  [],
);
refute(
  "…specifically not FREE",
  names(sizesOfRef([BLANK, TEE], "")),
  ["FREE"],
);

// ---------------------------------------------------------------------------
// 4. Ref No `12` with SEVERAL styles declared — no guess
// ---------------------------------------------------------------------------

// With more than one style and no clue which this destination packs, inheriting
// would be a wrong default that saves as if it were an answer.
check("no sole style to fall back on", soleStyleRef([TEE, POLO]), "");
check(
  "a single-style pack with an unusable Ref No and two styles has no columns",
  names(sizesForOverlay([TEE, POLO], dest({ style_ref_no: "12" }))),
  [],
);
// ...but a MULTIPLE-style pack still has the lines to go on, so the columns come
// from what each line actually packs.
check(
  "a multiple-style pack takes its columns from the lines instead",
  names(
    sizesForOverlay(
      [TEE, POLO],
      dest({
        style_ref_no: "12",
        is_single_style_pack: false,
        assort_lines: [{ style_ref_no: "STL/26-27/0007" }],
      }),
    ),
  ),
  ["M", "L", "3XL"],
);

// ---------------------------------------------------------------------------
// 5. The Multiple Style union — order preserved, deduped by id
// ---------------------------------------------------------------------------

const multi = dest({
  style_ref_no: "STL/26-27/0002",
  is_single_style_pack: false,
  assort_lines: [{ style_ref_no: "STL/26-27/0007" }, { style_ref_no: "" }],
});

// TEE contributes S M L XL XXL in ITS order; POLO adds only 3XL, because M and L
// are the same `size_id` and must share one column. 3XL lands where it first
// appears — at the end — rather than where a sort would put it.
check(
  "the union preserves each style's declared order and appends what is new",
  names(sizesForOverlay([TEE, POLO], multi)),
  ["S", "M", "L", "XL", "XXL", "3XL"],
);
refute(
  "…it does not sort, which would re-order a grid mid-entry",
  names(sizesForOverlay([TEE, POLO], multi)),
  ["3XL", "L", "M", "S", "XL", "XXL"],
);
check(
  "a line naming no style inherits rather than contributing nothing",
  assortLineRef([TEE], dest({ style_ref_no: "12" }), { style_ref_no: "" }),
  "STL/26-27/0002",
);

// A size with no id is not a column: it is a row the operator has added to the
// Style(s) grid and not yet answered.
check(
  "a size with no id is skipped rather than drawn as a blank column",
  names(
    sizesForOverlay(
      [{ style_ref_no: "STL/26-27/0002", sizes: [size("S"), { size_id: null }, size("M")] }],
      dest({ style_ref_no: "12", is_single_style_pack: false }),
    ),
  ),
  ["S", "M"],
);

// ---------------------------------------------------------------------------
// 6. Which toggle a destination opens on (screenshot 2422)
// ---------------------------------------------------------------------------

// One declared style cannot be packed several ways, and the Multiple branch
// seeds no lines — so it opens with size columns, a TOTAL of 0 and nothing to
// type into. That is the whole defect: not a wrong number, an unusable screen.
check("one declared style opens on Single", defaultSingleStylePack([TEE]), true);
check("two declared styles stay on Multiple", defaultSingleStylePack([TEE, POLO]), false);
check("no declared style stays on Multiple", defaultSingleStylePack([]), false);
// A style row the operator has added and not yet named is not a declared style,
// so it must not tip a one-style order into Multiple mid-typing.
check(
  "a half-typed style row does not count as a second style",
  defaultSingleStylePack([TEE, BLANK]),
  true,
);
// The payload's column is NULLABLE, so the load path can hand us a null ref.
// It is a blank by another route and must be treated as one.
check(
  "a null style reference is not a declared style either",
  defaultSingleStylePack([TEE, { style_ref_no: null }]),
  true,
);
check("null refs alone declare nothing", soleStyleRef([{ style_ref_no: null }]), "");

console.log(
  failed === 0 ? "\nOK — every assortment style vector holds." : `\n${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
