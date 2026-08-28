/**
 * THE GARMENT ORDER SHEET'S VECTORS.
 *
 * Every number on a shop-floor directive is a number somebody cuts fabric to,
 * and nobody is standing at the printer to disbelieve it. So the arithmetic and
 * the refusals both get vectors, and both were made to FAIL before being
 * trusted — this repo's own rule, and the one `check-assort-style.mts` records:
 * an assertion nobody has seen refuse is an assertion nobody knows is wired.
 *
 * ## VECTOR 1 IS A LIVE ORDER, NOT A FIXTURE SOMEBODY IMAGINED
 *
 * `SRC` below is HO/RE/26-27/0009 as it sits in the database on 2026-08-23:
 * one style STL/26-27/0007, two colourways NAVY and YELLOW, seven sizes, 1,000
 * pieces — and a Quantities row whose `style_ref_no` is the free text `111`
 * while its assortment lines say `STL/26-27/0007`.
 *
 * That last detail is the whole reason this file exists. `assortSizeWeights`
 * attributes every cell to the DESTINATION's ref, so on this order it labels
 * all 1,000 pieces `111` — a style nothing declares. Vector 1 asserts the
 * pieces land on the declared style, and vector 1b asserts the divergence is
 * real rather than something this file imagined. Both sides are checked,
 * because "my function disagrees with the shared one" is only worth writing
 * down if the disagreement is reproducible.
 *
 * ## ASSERT THE LABELS, NEVER JUST THE COUNTS
 *
 * A matrix with the right number of rows can still have them under the wrong
 * colourway, and a row total that is right by coincidence is the failure mode
 * this repo has already been bitten by ("Diff vectors assert LABELS"). So the
 * matrix vectors assert the combo names, the size labels AND the numbers.
 */

import {
  buildGosSheet,
  coordinateWarning,
  sizeCells,
  styleMatrix,
  type GosSource,
} from "../lib/orders/gos/sheet.js";
import { isRefusal, type GosMatrix } from "../lib/orders/gos/types.js";
import { assortSizeWeights } from "../lib/orders/assort-weights.js";

let failed = 0;
/** Asserts a value is NOT something — for the wrong answer a plausible
 *  implementation gives. Same helper the sibling suites carry. */
function refute(label: string, actual: unknown, notExpected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(notExpected)) {
    failed++;
    console.log(`FAIL  ${label}
      must not be ${JSON.stringify(notExpected)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

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

// --------------------------------------------------------------------------
// The live order, reduced to what the sheet reads.
// --------------------------------------------------------------------------

const SIZES = {
  XXS: "s-xxs",
  XS: "s-xs",
  S: "s-s",
  M: "s-m",
  L: "s-l",
  XL: "s-xl",
  XXL: "s-xxl",
} as const;

const sizeNames: Record<string, string> = Object.fromEntries(
  Object.entries(SIZES).map(([name, id]) => [id, name]),
);

const REF = "STL/26-27/0007";

/** The style's sizes in the order the Style(s) tab declares them (0407). */
const STYLE_SIZES = (["XXS", "XS", "S", "M", "L", "XL", "XXL"] as const).map((n, i) => ({
  style_ref_no: REF,
  sno: i + 1,
  size_id: SIZES[n],
}));

const cells = (row: Partial<Record<keyof typeof SIZES, number>>) =>
  (Object.keys(row) as (keyof typeof SIZES)[]).map((n) => ({
    size_id: SIZES[n],
    qty: row[n] ?? 0,
  }));

const panel = (
  sno: number,
  coordinate: string,
  component: string,
  colour: string,
  print: string | null = null,
) => ({
  sno,
  coordinate_id: `co-${coordinate}`,
  coordinate,
  component_id: `cm-${component}`,
  component,
  color_name: colour,
  print,
});

const structures = (colour: string) => [
  {
    sno: 1,
    structure_id: "cat-sj",
    structure: "SINGLE JERSEY",
    gsm: 180,
    gsm_tolerance: 5,
    components: [
      panel(1, "PIECES", "FRONT BODY", colour),
      panel(2, "PIECES", "BACK BODY", colour),
      panel(3, "PIECES", "SLEEVE", colour),
    ],
  },
  {
    sno: 2,
    structure_id: "cat-rib",
    structure: "1X1 LYCRA RIB",
    gsm: 180,
    gsm_tolerance: null,
    components: [panel(1, "PIECES", "NECK", colour)],
  },
];

const SRC: GosSource = {
  amendment: {
    code: "GOA-0011",
    is_draft: false,
    po_no: "245454",
    po_date: "2026-08-01",
    season: "Summer",
    delivery_date: "2026-10-10",
    customer: "ACME APPAREL",
    country: "UNITED KINGDOM",
    merchandiser: "R SUNDHARAM",
  },
  order: { order_number: "HO/RE/26-27/0009", order_date: "2026-08-02" },
  styles: [
    {
      sno: 1,
      style_ref_no: REF,
      article_no: null,
      style_description: "RIB NECK T SHIRT 100% COTTON",
      description: null,
      po_qty: 1000,
      style_code: REF,
      style_name: "RIB NECK T SHIRT",
      unit_kind: "piece",
      approved_sample_no: null,
    },
  ],
  style_sizes: STYLE_SIZES,
  combos: [
    {
      sno: 1,
      style_ref_no: REF,
      combo: "NAVY",
      combo_description: null,
      structures: structures("NAVY"),
    },
    {
      sno: 2,
      style_ref_no: REF,
      combo: "YELLOW",
      combo_description: null,
      structures: structures("YELLOW"),
    },
  ],
  quantities: [
    {
      sno: 1,
      // THE FREE TEXT THAT BROKE THE SHARED ENGINE. This is the live value.
      style_ref_no: "111",
      is_single_style_pack: false,
      assortment_type: { code: "solid_solid", name: "Solid Colour / Solid Size" },
      // Irrelevant on a SOLID pack — the ratio scope only multiplies an assorted
      // one. Section 13 below is where it does the work.
      ratio_for: null,
      po_no: null,
      po_qty: 1000,
      delivery_date: "2026-10-10",
      earlier_shipment_date: null,
      destination: "UNITED KINGDOM",
      assort_lines: [
        {
          sno: 1,
          style_ref_no: REF,
          combo: "NAVY",
          no_of_cartons: 0,
          inners_per_carton: 1,
          sizes: cells({ XXS: 50, XS: 50, S: 50, M: 150, L: 100, XL: 50, XXL: 50 }),
        },
        {
          sno: 2,
          style_ref_no: REF,
          combo: "YELLOW",
          no_of_cartons: 0,
          inners_per_carton: 1,
          sizes: cells({ XXS: 100, XS: 100, S: 100, M: 100, L: 50, XL: 25, XXL: 25 }),
        },
      ],
    },
  ],
  sizeNames,
  printedAt: "2026-08-23T09:00:00.000Z",
};

const matrixOf = (src: GosSource, ref = REF): GosMatrix => {
  const m = styleMatrix(src, ref, sizeCells(src));
  if (isRefusal(m)) throw new Error(`expected a matrix, got a refusal: ${m.refused}`);
  return m;
};

// --------------------------------------------------------------------------
// 1 — The style a size cell belongs to.
// --------------------------------------------------------------------------

check(
  "1  the live order's pieces land on the DECLARED style, not on the destination's free text",
  [...new Set(sizeCells(SRC).map((c) => c.styleRef))],
  [REF],
);

/*
 * 1b WAS A PIN ON A BUG, AND THE BUG IS FIXED — so the pin is inverted rather
 * than deleted (2026-08-23).
 *
 * It asserted `["111"]`: proof that the SHARED `assortSizeWeights` attributed
 * this order's size cells to `quantities.style_ref_no`, which the client made
 * free text on 2026-08-17, while this sheet computed its own attribution and got
 * `STL/26-27/0007`. Lane C pinned the disagreement so it could not be dismissed
 * as imagined, and reported it rather than fixing it — the fix moved Material
 * BOM and budget numbers and was a decision, not a cleanup.
 *
 * The decision was taken and `assort-weights.ts` now prefers the LINE's ref,
 * falling back to the destination's. So the two agree, and this vector now says
 * SO — because "the shared engine agrees with this sheet" is worth asserting for
 * exactly as long as the two exist. Deleting it would leave nothing watching the
 * seam, and a silent re-divergence is how it arose the first time.
 */
check(
  "1b the shared assortSizeWeights now AGREES with this sheet — the 08-23 fix holds",
  [
    ...new Set(
      assortSizeWeights(
        SRC.quantities.map((q) => ({
          style_ref_no: q.style_ref_no,
          assortment_type: q.assortment_type,
          assort_lines: q.assort_lines,
        })),
      ).map((w) => w.style_ref_no),
    ),
  ],
  [REF],
);
/* AND IT IS EMPHATICALLY NOT THE FREE TEXT ANY MORE. Kept as its own line so the
   value that used to be correct here is still named — a reader meeting this in a
   year should be able to see what changed without reading the git history. */
refute(
  "1b' ...and no longer the destination's free text",
  [
    ...new Set(
      assortSizeWeights(
        SRC.quantities.map((q) => ({
          style_ref_no: q.style_ref_no,
          assortment_type: q.assortment_type,
          assort_lines: q.assort_lines,
        })),
      ).map((w) => w.style_ref_no),
    ),
  ],
  ["111"],
);

check(
  "1c a line naming a style the order does not declare is NOT quietly given one",
  sizeCells({
    ...SRC,
    styles: [
      { ...SRC.styles[0] },
      { ...SRC.styles[0], sno: 2, style_ref_no: "STL/26-27/0099" },
    ],
    quantities: [
      {
        ...SRC.quantities[0],
        assort_lines: [
          { ...SRC.quantities[0].assort_lines[0], style_ref_no: "STL/26-27/0404" },
        ],
      },
    ],
  }).map((c) => c.styleRef)[0],
  null,
);

// --------------------------------------------------------------------------
// 2 — The mode multiplier.
// --------------------------------------------------------------------------

check(
  "2  Solid/Solid: the cell IS the pieces, and a 0 carton count does not zero it",
  matrixOf(SRC).total,
  1000,
);

const ASSORT: GosSource = {
  ...SRC,
  quantities: [
    {
      ...SRC.quantities[0],
      assortment_type: { code: "solid_assort", name: "Solid Colour / Assort Size" },
      /* STATED, not left blank (2026-08-28). Inners only multiply when the ratio
         fills an INNER, and this vector is about the inner count — a blank here
         would read as `master`, halve the expected figure, and quietly turn this
         into a test of a different formula. */
      ratio_for: "inner",
      assort_lines: [
        {
          sno: 1,
          style_ref_no: REF,
          combo: "NAVY",
          no_of_cartons: 10,
          inners_per_carton: 2,
          // A ratio of 1:2:1 per inner.
          sizes: cells({ S: 1, M: 2, L: 1 }),
        },
      ],
    },
  ],
};

check(
  "2b Solid/Assort: cartons x inners x ratio — 10 x 2 x (1+2+1)",
  matrixOf(ASSORT).total,
  80,
);
check(
  "2c …and the per-size split follows the ratio, not the total",
  matrixOf(ASSORT).rows[0].cells,
  [null, null, 20, 40, 20, null, null],
);

// --------------------------------------------------------------------------
// 3 — Blank is not zero.
// --------------------------------------------------------------------------

const WITH_ZERO: GosSource = {
  ...SRC,
  quantities: [
    {
      ...SRC.quantities[0],
      assort_lines: [
        {
          ...SRC.quantities[0].assort_lines[0],
          // XL is stated as zero; XXL is not stated at all.
          sizes: cells({ XXS: 50, XS: 50, S: 50, M: 150, L: 100, XL: 0 }),
        },
      ],
    },
  ],
};

check(
  "3  an explicit 0 is a number and an unmentioned size is null — they must never merge",
  matrixOf(WITH_ZERO).rows[0].cells,
  [50, 50, 50, 150, 100, 0, null],
);
check(
  "3b a stated zero does not inflate the row total",
  matrixOf(WITH_ZERO).rows[0].total,
  400,
);

// --------------------------------------------------------------------------
// 4 — Columns: declared order, then strays.
// --------------------------------------------------------------------------

check(
  "4  size columns follow the style's DECLARED order, never a sort",
  matrixOf(SRC).columns.map((c) => c.label),
  ["XXS", "XS", "S", "M", "L", "XL", "XXL"],
);

const STRAY_SIZE: GosSource = {
  ...SRC,
  // The style declares three sizes; the break-up uses a fourth.
  style_sizes: STYLE_SIZES.slice(0, 3),
  quantities: [
    {
      ...SRC.quantities[0],
      assort_lines: [
        {
          ...SRC.quantities[0].assort_lines[0],
          sizes: cells({ XXS: 10, XS: 10, S: 10, XXL: 25 }),
        },
      ],
    },
  ],
};

check(
  "4b a size in the break-up that the style never declared gets a column — appended, so its lateness shows",
  matrixOf(STRAY_SIZE).columns.map((c) => c.label),
  ["XXS", "XS", "S", "XXL"],
);
check(
  "4c …and its pieces are counted, rather than falling out of every column",
  matrixOf(STRAY_SIZE).total,
  55,
);

// --------------------------------------------------------------------------
// 5 — Colourways: declared order, then the undeclared, marked.
// --------------------------------------------------------------------------

const STRAY_COMBO: GosSource = {
  ...SRC,
  quantities: [
    {
      ...SRC.quantities[0],
      assort_lines: [
        ...SRC.quantities[0].assort_lines,
        {
          sno: 3,
          style_ref_no: REF,
          combo: "RED",
          no_of_cartons: 0,
          inners_per_carton: 1,
          sizes: cells({ M: 40 }),
        },
      ],
    },
  ],
};

check(
  "5  colourways come in the Combos tab's order, with an undeclared one appended",
  matrixOf(STRAY_COMBO).rows.map((r) => [r.combo, r.undeclared]),
  [
    ["NAVY", false],
    ["YELLOW", false],
    ["RED", true],
  ],
);
check(
  "5b …and its pieces are in the grand total, not silently dropped",
  matrixOf(STRAY_COMBO).total,
  1040,
);

// --------------------------------------------------------------------------
// 6 — Totals.
// --------------------------------------------------------------------------

check(
  "6  column totals are per size and index-aligned with the columns",
  matrixOf(SRC).columnTotals,
  [150, 150, 150, 250, 150, 75, 75],
);
check("6b row totals", matrixOf(SRC).rows.map((r) => [r.combo, r.total]), [
  ["NAVY", 500],
  ["YELLOW", 500],
]);

// --------------------------------------------------------------------------
// 7 — Refusals.
// --------------------------------------------------------------------------

const NO_BREAKUP: GosSource = { ...SRC, quantities: [], style_sizes: [] };
const refusal = styleMatrix(NO_BREAKUP, REF, sizeCells(NO_BREAKUP));
check(
  "7  no break-up refuses with a sentence rather than returning an empty grid",
  isRefusal(refusal),
  true,
);
check(
  "7b the sentence names what is missing",
  isRefusal(refusal) && /size break-up/i.test(refusal.refused),
  true,
);

// --------------------------------------------------------------------------
// 8 — Piece vs Set.
// --------------------------------------------------------------------------

check("8  a Piece with one coordinate is silent", coordinateWarning("piece", 1), null);
check(
  "8b a Piece with two coordinates says so",
  (coordinateWarning("piece", 2) ?? "").includes("at most 1 coordinate"),
  true,
);
check("8c a Set with two coordinates is silent", coordinateWarning("set", 2), null);
check("8d a Set with six coordinates is silent — six is the cap, not the breach", coordinateWarning("set", 6), null);
check(
  "8e a Set with seven coordinates says so",
  (coordinateWarning("set", 7) ?? "").includes("at most 6 coordinates"),
  true,
);
check(
  "8f a Set with one coordinate says so — half the garment would have no panels",
  (coordinateWarning("set", 1) ?? "").includes("at least 2 coordinates"),
  true,
);
check(
  "8g a style with NO unit kind is silent — every style before 0392 has none, and a warning on a historical record is one nobody can act on",
  coordinateWarning(null, 3),
  null,
);
check(
  "8h no coordinates at all is reported whatever the unit kind",
  (coordinateWarning("piece", 0) ?? "").includes("No coordinates"),
  true,
);

// --------------------------------------------------------------------------
// 9 — The component list.
// --------------------------------------------------------------------------

const sheet = buildGosSheet(SRC);
const style = sheet.styles[0];

check(
  "9  panels group under their coordinate, in first-appearance order",
  style.coordinates.map((b) => [b.coordinate, b.panels.map((p) => p.component)]),
  [["PIECES", ["FRONT BODY", "BACK BODY", "SLEEVE", "NECK"]]],
);
check(
  "9b one panel is ONE row across every colourway — not a block per colour",
  style.coordinates[0].panels[0].colours.map((c) => c?.colour ?? null),
  ["NAVY", "YELLOW"],
);
check(
  "9c the structure and GSM ride with the panel",
  [
    style.coordinates[0].panels[0].structure,
    style.coordinates[0].panels[0].gsm,
    style.coordinates[0].panels[3].structure,
  ],
  ["SINGLE JERSEY", 180, "1X1 LYCRA RIB"],
);

// A colourway pieced differently: YELLOW has no SLEEVE row.
const ODD_COLOURWAY: GosSource = {
  ...SRC,
  combos: [
    SRC.combos[0],
    {
      ...SRC.combos[1],
      structures: [
        {
          ...structures("YELLOW")[0],
          components: [
            panel(1, "PIECES", "FRONT BODY", "YELLOW"),
            panel(2, "PIECES", "BACK BODY", "YELLOW"),
          ],
        },
        structures("YELLOW")[1],
      ],
    },
  ],
};
check(
  "9d a panel one colourway does not use is null in that slot, not blank-filled from the other",
  buildGosSheet(ODD_COLOURWAY)
    .styles[0].coordinates[0].panels.find((p) => p.component === "SLEEVE")!
    .colours.map((c) => c?.colour ?? null),
  ["NAVY", null],
);

// A colour-blocked garment: two SLEEVE panels in one structure.
const TWO_SLEEVES: GosSource = {
  ...SRC,
  combos: SRC.combos.map((c) => ({
    ...c,
    structures: [
      {
        ...c.structures[0],
        components: [
          panel(1, "PIECES", "SLEEVE", `${c.combo} LEFT`),
          panel(2, "PIECES", "SLEEVE", `${c.combo} RIGHT`),
        ],
      },
    ],
  })),
};
check(
  "9e two panels of the same part are TWO rows, aligned Nth-to-Nth across colourways — never collapsed to one",
  buildGosSheet(TWO_SLEEVES).styles[0].coordinates[0].panels.map((p) =>
    p.colours.map((c) => c?.colour ?? null),
  ),
  [
    ["NAVY LEFT", "YELLOW LEFT"],
    ["NAVY RIGHT", "YELLOW RIGHT"],
  ],
);

// A Set — two coordinates.
const SET: GosSource = {
  ...SRC,
  styles: [{ ...SRC.styles[0], unit_kind: "set" }],
  combos: [
    {
      ...SRC.combos[0],
      structures: [
        {
          ...structures("NAVY")[0],
          components: [
            panel(1, "TOP", "FRONT BODY", "NAVY"),
            panel(2, "TOP", "SLEEVE", "NAVY"),
            panel(3, "BOTTOM", "FRONT PANEL", "NAVY"),
          ],
        },
      ],
    },
  ],
};
check(
  "9f a Set groups its panels under each garment — the only thing that says which coordinate a SLEEVE belongs to",
  buildGosSheet(SET).styles[0].coordinates.map((b) => [
    b.coordinate,
    b.panels.map((p) => p.component),
  ]),
  [
    ["TOP", ["FRONT BODY", "SLEEVE"]],
    ["BOTTOM", ["FRONT PANEL"]],
  ],
);
check("9g …and the coordinate count follows the panels", buildGosSheet(SET).styles[0].coordinateCount, 2);

// --------------------------------------------------------------------------
// 10 — Orphans, and the header.
// --------------------------------------------------------------------------

const ORPHANED: GosSource = {
  ...SRC,
  // Two declared styles, so a line naming neither cannot inherit one.
  styles: [SRC.styles[0], { ...SRC.styles[0], sno: 2, style_ref_no: "STL/26-27/0099" }],
  quantities: [
    {
      ...SRC.quantities[0],
      assort_lines: [
        { ...SRC.quantities[0].assort_lines[0], style_ref_no: "STL/26-27/0404" },
      ],
    },
  ],
};
check(
  "10 pieces that belong to no declared style are REPORTED, with the ref they claimed",
  buildGosSheet(ORPHANED).orphans,
  [{ ref: "STL/26-27/0404", combo: "NAVY", qty: 500 }],
);
check(
  "10b …and are not counted into the grand total, which would hide them in a number that looks right",
  buildGosSheet(ORPHANED).grandTotal,
  0,
);
check("10c a clean order reports no orphans", sheet.orphans, []);

// --------------------------------------------------------------------------
// 15 — RATIO FOR REACHES THE SHEET (2026-08-28).
//
// `sizeCells` and `destinationsOf` each carried their OWN copy of the packing
// multiplication — the fourth and fifth in the codebase — and both ignored
// `ratio_for`, so a Master-ratio pack printed the Inner answer: every figure on
// the buyer's sheet multiplied by the inner count. Both call `packFactor` now.
//
// THIS IS THE DATA HALF AS MUCH AS THE RULE HALF. `gos/service.ts` writes its
// select by hand AND re-maps every row field by field, so the column has to be
// named twice to arrive at all; miss either and this section reads `undefined`,
// `ratioScope` answers `master`, and the vector below catches it — which is the
// same failure AGENTS.md records for `created_by` on the sales registers.
// --------------------------------------------------------------------------

const assorted = (ratioFor: string | null): GosSource => ({
  ...SRC,
  quantities: [
    {
      ...SRC.quantities[0],
      style_ref_no: REF,
      assortment_type: { code: "solid_assort", name: "Solid Colour / Assort Size" },
      ratio_for: ratioFor,
      po_qty: 0,
      assort_lines: [
        {
          ...SRC.quantities[0].assort_lines[0],
          // 100 cartons, 10 bundles each, a 1:2 ratio across two sizes.
          no_of_cartons: 100,
          inners_per_carton: 10,
          sizes: cells({ M: 1, L: 2 }),
        },
      ],
    },
  ],
});

check(
  "15 master: the ratio IS the carton, so the sheet prints cartons x ratio",
  buildGosSheet(assorted("master")).grandTotal,
  300,
);
check(
  "15b inner: the same row, ten bundles deep",
  buildGosSheet(assorted("inner")).grandTotal,
  3000,
);
// THE REGRESSION AS ITSELF: both copies used to return the inner answer either
// way, so this is the vector that fails if the sheet stops reading `ratio_for`.
check(
  "15c master must NOT print the inner answer",
  buildGosSheet(assorted("master")).grandTotal === 3000,
  false,
);
// The destination band totals the SAME cells the matrix prints. They were two
// separately-typed expressions and are now one, so they cannot disagree.
check(
  "15d the destination band agrees with the matrix it summarises",
  buildGosSheet(assorted("inner")).destinations.map((d) => d.qty),
  [3000],
);

check(
  "11 the header states the approved sample only when ONE style makes it unambiguous",
  [
    buildGosSheet({
      ...SRC,
      styles: [{ ...SRC.styles[0], approved_sample_no: "SMP-0004" }],
    }).header.approvedSampleNo,
    buildGosSheet({
      ...SRC,
      styles: [
        { ...SRC.styles[0], approved_sample_no: "SMP-0004" },
        { ...SRC.styles[0], sno: 2, style_ref_no: "STL/26-27/0099", approved_sample_no: "SMP-0005" },
      ],
    }).header.approvedSampleNo,
  ],
  ["SMP-0004", null],
);

// --------------------------------------------------------------------------
// 12 — THE TWO NUMBERS ON THE HEADER ARE READ, NEVER COMPOSED.
//
// The sheet must not parse, pad, normalise or "fix" an RE Number, and TWO
// shapes are live: the new `HO/RE/26-27/0001` and the legacy
// `U2/RE//2526/2047`, whose DOUBLE SLASH after RE looks exactly like the kind
// of thing a well-meaning normaliser would collapse. The legacy series is 86 of
// the 91 orders in this database, so "it works on the new format" tests the
// rare case.
//
// 0431's header is why this is a hard boundary: the fiscal-year segment is the
// counter's primary key, so tidying the shape re-mints numbers already issued —
// and a printed sheet quoting a re-minted RE Number is a tracking failure
// across 500+ people on the floor.
// --------------------------------------------------------------------------

const RE_NUMBERS = [
  "HO/RE/26-27/0001", // new (0431 put the dash in the fiscal year)
  "HO/RE/26-27/0009",
  "U2/RE//2526/2047", // legacy: double slash, no dash — most of the live data
  "U2/RE//2627/2086", // the highest legacy number issued
];

check(
  "12 every live RE Number shape reaches the header byte for byte — the double slash included",
  RE_NUMBERS.map(
    (n) => buildGosSheet({ ...SRC, order: { ...SRC.order, order_number: n } }).header.reNumber,
  ),
  RE_NUMBERS,
);

check(
  "12b an order with no number yet is null, not an invented one",
  buildGosSheet({ ...SRC, order: { ...SRC.order, order_number: null } }).header.reNumber,
  null,
);

check(
  "12c S No is the amendment's OWN code — an existing serial, not a third scheme",
  sheet.header.sNo,
  "GOA-0011",
);

check(
  "12d …and it does not change when the order gains another amendment. The field held a\n     COMPUTED POSITION until 2026-08-23, so two prints of one sheet disagreed about their\n     own S No. Nothing in the source below says how many amendments exist, and that is\n     the point: there is no length for a position to be derived from.",
  Object.keys(SRC).includes("sNo"),
  false,
);

check(
  "12e a style states its STL number and no second serial beside it",
  Object.keys(style).includes("sNo"),
  false,
);

check(
  "13 a destination's quantity is COMPUTED from its assortment, so a disagreement with the stored po_qty is visible rather than hidden",
  sheet.destinations.map((d) => [d.label, d.qty]),
  [["UNITED KINGDOM", 1000]],
);

// --------------------------------------------------------------------------
// 14 — The Trim Clutter Prevention Policy, asserted structurally.
//
// The policy cannot be checked by reading the rendered page from here, so it is
// checked where it is actually enforced: the sheet's own shape. A `GosSheet`
// with nowhere to put a trim cannot print one, and this vector fails the moment
// somebody adds the field.
// --------------------------------------------------------------------------

const SHEET_KEYS = Object.keys(sheet).sort();
check(
  "14 the sheet carries construction and nothing procurement-shaped",
  SHEET_KEYS,
  ["destinations", "grandTotal", "header", "orphans", "printedAt", "styles"],
);
check(
  "14b a panel describes the fabric it is cut from, and says nothing about trims",
  Object.keys(style.coordinates[0].panels[0]).sort(),
  ["colours", "component", "coordinate", "gsm", "gsmTolerance", "structure"],
);

console.log(
  failed === 0
    ? "\nOK — every Garment Order Sheet vector holds."
    : `\n${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
