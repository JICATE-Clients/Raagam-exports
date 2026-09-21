/**
 * Material BOM ▸ Item Color is mandatory on a colour-wise row (client
 * 2026-09-21).
 *
 *     npm run check:bom-colour-required
 *
 * The rule under every vector: a line whose grain carries the colourway axis
 * owes an Item Color on every chosen row — by the row or by the line — and
 * nothing else does. Mutation-tested by hand when written: dropping the
 * `includes("colour")` test fails §1; dropping the line-colour short-circuit
 * fails §2.
 */

import { colourRequired, missingItemColours, type ColourWiseLineFacts } from "../lib/orders/material-bom/colour-required.ts";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  } else console.log(`ok    ${label}`);
}

const line = (over: Partial<ColourWiseLineFacts>): ColourWiseLineFacts => ({
  sno: 1,
  material: "SEWING THREAD 40/2",
  grain: ["colour"],
  item_color_id: null,
  rows: [
    { label: "WHITE", item_color_id: null },
    { label: "NAVY", item_color_id: null },
  ],
  ...over,
});

// §1 — the switch is the colourway axis, whatever else the grain carries.
check("§1 Attribute = Colour requires", colourRequired(["colour"]), true);
check("§1 Colour + Size wise (the legacy combination) requires", colourRequired(["colour", "size"]), true);
check("§1 Style / Colour requires", colourRequired(["style_ref", "colour"]), true);
check("§1 Attribute = Order does not", colourRequired([]), false);
check("§1 Order + Size wise does not", colourRequired(["size"]), false);
check("§1 Country does not", colourRequired(["country"]), false);
check("§1 no grain yet does not (the Attribute cell already refuses)", colourRequired(null), false);

// §2 — what satisfies it.
check("§2 a non-colour line with blank rows is not a problem", missingItemColours([line({ grain: ["size"] })]), []);
check("§2 the LINE's colour answers every row", missingItemColours([line({ item_color_id: "c-white" })]), []);
check(
  "§2 every row coloured is answered",
  missingItemColours([line({ rows: [{ label: "WHITE", item_color_id: "c-white" }, { label: "NAVY", item_color_id: "c-navy" }] })]),
  [],
);
check("§2 no rows (an unticked line) is answered", missingItemColours([line({ rows: [] })]), []);

// §3 — what is refused, and how it is said.
check(
  "§3 blank rows are named, in explosion order, with the line and the material",
  missingItemColours([line({ rows: [{ label: "WHITE", item_color_id: "c-white" }, { label: "NAVY", item_color_id: null }] })]),
  [
    {
      sno: 1,
      rows: ["NAVY"],
      message: "Line 1 (SEWING THREAD 40/2) splits by colour — pick the Item Color on its colour row: NAVY.",
    },
  ],
);
check(
  "§3 two blank rows read as a count",
  missingItemColours([line({})])[0]?.message,
  "Line 1 (SEWING THREAD 40/2) splits by colour — pick the Item Color on each of its 2 colour rows: WHITE, NAVY.",
);
check(
  "§3 past three rows the rest are counted, not listed",
  missingItemColours([
    line({
      sno: 4,
      rows: ["WHITE", "NAVY", "CRANBERRY", "BLACK", "GREY"].map((label) => ({ label, item_color_id: null })),
    }),
  ])[0]?.message,
  "Line 4 (SEWING THREAD 40/2) splits by colour — pick the Item Color on each of its 5 colour rows: WHITE, NAVY, CRANBERRY and 2 more.",
);
check(
  "§3 a Colour × Size line names its size rows",
  missingItemColours([
    line({
      grain: ["colour", "size"],
      rows: [
        { label: "WHITE · S", item_color_id: "c-white" },
        { label: "WHITE · M", item_color_id: null },
      ],
    }),
  ]).map((m) => m.rows),
  [["WHITE · M"]],
);
check(
  "§3 one entry per failing line, the answered line left out",
  missingItemColours([line({ sno: 1, item_color_id: "c-white" }), line({ sno: 2 }), line({ sno: 3, grain: ["country"] })]).map(
    (m) => m.sno,
  ),
  [2],
);

if (failed) {
  console.error(`\n${failed} vector(s) failed.`);
  process.exit(1);
}
console.log("\nMaterial BOM: a colour-wise row owes its Item Color, and nothing else does.");
