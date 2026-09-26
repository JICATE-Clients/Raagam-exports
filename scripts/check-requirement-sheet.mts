/**
 * Vectors for `lib/orders/requirement/sheet.ts` — the Accessories Requirement.
 *
 *   npm run check:requirement-sheet
 *
 * ## THE FIXTURE IS THE PRINTED SHEET
 *
 * Every figure below is lifted from the legacy PDF (Format.pdf, printed
 * 22-08-2026) rather than invented, so a vector failing means this module
 * disagrees with the document the business already circulates. The sharpest case
 * in it is the one that looks like a bug:
 *
 *     LABEL / WASH CARE   XS 136 + S 191 + M 233 + L 186 + XL 136 = 882
 *     LABEL / MAIN & SIZE                              un-split   = 881
 *
 * Both are correct. `apportion()` floors each size's share and hands the
 * leftover to the largest remainder, so a split total can exceed the un-split
 * figure by up to one unit per size. A sheet that "corrected" 882 to 881 would
 * disagree with the requirement the purchase order is written from.
 *
 * Runs under `tsx` because the module imports a `@/lib/...` alias at runtime.
 */
import {
  accessoryQty,
  accessoryRows,
  consumptionLabel,
  itemLabel,
  requirementRows,
  requirementSummary,
  sheetQty,
  type SheetNames,
  type StoredRequirement,
} from "../lib/orders/requirement/sheet.ts";

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
function refute(label: string, actual: unknown, forbidden: unknown) {
  const same = JSON.stringify(actual) === JSON.stringify(forbidden);
  if (same) {
    failed++;
    console.error(`FAIL  ${label}\n      must NOT be ${JSON.stringify(forbidden)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

// ---------------------------------------------------------------------------
// 1. The item name splits into head + spec, with the category dropped
// ---------------------------------------------------------------------------

check(
  "the category prefix is dropped and the rest splits head / spec",
  itemLabel("LABEL / MAIN & SIZE / PRINTED / SATIN / CUT & SEAL", "LABEL"),
  { head: "MAIN & SIZE", spec: "PRINTED / SATIN / CUT & SEAL" },
);
check(
  "an item with no spec has a null spec, not an empty string",
  itemLabel("SILICA GEL / SILICA GEL", "SILICA GEL"),
  { head: "SILICA GEL", spec: null },
);
/* A NAME THAT DOES NOT START WITH ITS CATEGORY IS LEFT ALONE. The convention is
   not enforced by the schema, and eating a first segment that merely looked
   similar would RENAME the item on a document a supplier reads. */
check(
  "a name that does not lead with its category keeps every segment",
  itemLabel("MOBILON TAPE / 6 MM", "TAPE"),
  { head: "MOBILON TAPE", spec: "6 MM" },
);
check("category matching ignores case", itemLabel("label / main", "LABEL"), {
  head: "main",
  spec: null,
});
check("a nameless item still prints something", itemLabel("", null), {
  head: "(unnamed item)",
  spec: null,
});

// ---------------------------------------------------------------------------
// 2. The Consumption column
// ---------------------------------------------------------------------------

check("one per piece", consumptionLabel(1, 1, "NOS"), "1 NOS / 1 PCS");
check("a cone covers ten", consumptionLabel(1, 10, "CONE"), "1 CONE / 10 PCS");
check("a roll covers a hundred and fifty", consumptionLabel(1, 150, "ROLL"), "1 ROLL / 150 PCS");
check("a carton covers twelve", consumptionLabel(1, 12, "NOS"), "1 NOS / 12 PCS");

/* AN INCOMPLETE RATIO PRINTS A DASH. The engine refuses such a line and the
   refusal is already on the row; a consumption cell reading `1 / 0` would imply
   a ratio the requirement does not have. */
check("a zero divisor is a dash, never 1 / 0", consumptionLabel(1, 0, "NOS"), "—");
check("a missing ratio is a dash", consumptionLabel(null, 1, "NOS"), "—");
refute("...and never a bare number", consumptionLabel(null, 1, "NOS"), "1");

// ---------------------------------------------------------------------------
// 3. The document — built from the printed sheet's own figures
// ---------------------------------------------------------------------------

const NAMES: SheetNames = {
  items: {
    "i-main": { name: "LABEL / MAIN & SIZE / PRINTED / SATIN / CUT & SEAL", category: "LABEL" },
    "i-wash": { name: "LABEL / WASH CARE / PRINTED / SATIN / CUT & SEAL", category: "LABEL" },
    "i-thread": { name: "SEWING THREAD / COTTON / 3 PLY RFD", category: "SEWING THREAD" },
  },
  uoms: { "u-nos": { code: "NOS", decimals: 2 }, "u-cone": { code: "CONE", decimals: 2 } },
  sizes: { "z-xs": "XS", "z-s": "S", "z-m": "M", "z-l": "L", "z-xl": "XL" },
  colours: {},
};

const row = (over: Partial<StoredRequirement>): StoredRequirement => ({
  item_id: "i-main",
  sno: 1,
  slice_label: null,
  size_id: null,
  item_color_id: null,
  no_of_items: 1,
  per_pieces: 1,
  required_qty: 881,
  refusal_reason: null,
  consumption_uom_id: "u-nos",
  ...over,
});

const doc = requirementRows(
  [
    row({}),
    row({ item_id: "i-wash", sno: 2, size_id: "z-xs", required_qty: 136 }),
    row({ item_id: "i-wash", sno: 2, size_id: "z-s", required_qty: 191 }),
    row({ item_id: "i-wash", sno: 2, size_id: "z-m", required_qty: 233 }),
    row({ item_id: "i-wash", sno: 2, size_id: "z-l", required_qty: 186 }),
    row({ item_id: "i-wash", sno: 2, size_id: "z-xl", required_qty: 136 }),
    row({ item_id: "i-thread", sno: 3, required_qty: 89, per_pieces: 10, consumption_uom_id: "u-cone" }),
  ],
  NAMES,
);

check(
  "the document reads category, item, sizes, total, category, item",
  doc.map((r) => r.kind),
  ["category", "item", "item", "size", "size", "size", "size", "size", "total", "category", "item"],
);
check(
  "categories are alphabetical",
  doc.filter((r) => r.kind === "category").map((r) => (r as { label: string }).label),
  ["LABEL", "SEWING THREAD"],
);

/* THE CASE THAT LOOKS LIKE A BUG AND IS NOT. */
check(
  "the split total is 882 — the SUM OF THE STORED ROWS",
  (doc.find((r) => r.kind === "total") as { qty: number }).qty,
  882,
);
refute(
  "...it is NOT re-derived to match the un-split 881",
  (doc.find((r) => r.kind === "total") as { qty: number }).qty,
  881,
);

/* A SPLIT ITEM'S PARENT CARRIES NO FIGURE. Printing one invites the reader to
   add it to the total below it. */
const wash = doc.find((r) => r.kind === "item" && (r as { key: string }).key === "i:i-wash") as {
  qty: number | null;
  split: boolean;
};
check("a split item's own row has no qty", wash.qty, null);
check("...and is marked split", wash.split, true);

const main = doc.find((r) => r.kind === "item" && (r as { key: string }).key === "i:i-main") as {
  qty: number | null;
  split: boolean;
  spec: string | null;
};
check("an un-split item keeps its figure", main.qty, 881);
check("...is not marked split", main.split, false);
check("...and carries its spec", main.spec, "PRINTED / SATIN / CUT & SEAL");

/* SEVERAL ROWS DO NOT MEAN SPLIT. A colour-wise or country-wise BOM also
   produces several rows per item, and those are not sizes — the test is
   `size_id`, and getting it wrong would invent a Total nobody asked for. */
const colourwise = requirementRows(
  [
    row({ item_id: "i-main", combo: "WHITE", required_qty: 500 } as Partial<StoredRequirement>),
    row({ item_id: "i-main", combo: "NAVY", required_qty: 381 } as Partial<StoredRequirement>),
  ],
  NAMES,
);
check(
  "two colour rows are one item and NO total",
  colourwise.map((r) => r.kind),
  ["category", "item"],
);
refute(
  "...a Total row is not invented for them",
  colourwise.some((r) => r.kind === "total"),
  true,
);

/* WITHIN a category the operator's own order survives; only categories sort. */
check(
  "items keep their sno inside a category",
  requirementRows(
    [row({ item_id: "i-wash", sno: 9 }), row({ item_id: "i-main", sno: 2 })],
    NAMES,
  )
    .filter((r) => r.kind === "item")
    .map((r) => (r as { head: string }).head),
  ["MAIN & SIZE", "WASH CARE"],
);

// ---------------------------------------------------------------------------
// 4. Refusals and unknowns survive to the page
// ---------------------------------------------------------------------------

const refused = requirementRows(
  [row({ required_qty: null, refusal_reason: "Enter how many are used per piece" })],
  NAMES,
).find((r) => r.kind === "item") as { qty: number | null; refusal: string | null };
check("a refused row carries its sentence", refused.refusal, "Enter how many are used per piece");
check("...and no quantity", refused.qty, null);
refute("...never a zero", refused.qty, 0);
check(
  "an item whose master row is gone is still printed, under UNCATEGORISED",
  requirementRows([row({ item_id: "i-vanished" })], NAMES).map((r) =>
    r.kind === "category" ? r.label : r.kind,
  ),
  ["UNCATEGORISED", "item"],
);
check("nothing in, nothing out", requirementRows([], NAMES), []);

// ---------------------------------------------------------------------------
// 5. Figures print at the unit's own precision
// ---------------------------------------------------------------------------

check("a quantity prints through fmtQty", sheetQty(882, 2), "882");
check("a fractional quantity keeps its decimals", sheetQty(2719.2, 2), "2,719.2");
check("a six-decimal unit is not truncated", sheetQty(85.714286, 6), "85.714286");
check("no quantity is a dash, never 0", sheetQty(null, 2), "—");
refute("...and never the string zero", sheetQty(null, 2), "0");

check("the summary counts what the band claims", requirementSummary(doc), {
  categories: 2,
  items: 3,
  split: 1,
});

// ---------------------------------------------------------------------------
// 5. The RP printout's grid (client 2026-09-24, "Accessories Requirement.pdf")
// ---------------------------------------------------------------------------

const PNAMES: SheetNames = {
  ...NAMES,
  items: {
    ...NAMES.items,
    "i-pin": { name: "PIN / TAG PIN", category: "PIN" },
  },
  colours: { "c-red": "RED", "c-blue": "BLUE" },
  lines: {
    "l-1": { supplyType: "Local", specification: null },
    "l-2": { supplyType: "Local", specification: "SATIN FINISH" },
    "l-3": { supplyType: null, specification: null },
  },
};
const grid = accessoryRows(
  [
    // Entered THREAD first, then LABEL, then PIN — the BOM's order, not the alphabet's.
    row({ item_id: "i-thread", sno: 1, item_line_id: "l-1", required_qty: 315, consumption_uom_id: "u-cone", per_pieces: 10 }),
    row({ item_id: "i-main", sno: 2, item_line_id: "l-2", required_qty: 3141 }),
    row({ item_id: "i-wash", sno: 3, item_line_id: "l-1", required_qty: 3141 }),
    row({ item_id: "i-pin", sno: 4, item_line_id: "l-3", required_qty: 100, item_color_id: "c-red" }),
    row({ item_id: "i-pin", sno: 5, item_line_id: "l-3", required_qty: 50, item_color_id: "c-blue" }),
    // The same pin, same colour, a second style's line — summed, as bought.
    row({ item_id: "i-pin", sno: 6, item_line_id: "l-3", required_qty: 25, item_color_id: "c-red" }),
  ],
  PNAMES,
);
check(
  "categories print in the BOM's own order",
  grid.filter((r) => r.category).map((r) => r.category),
  ["SEWING THREAD", "LABEL", "PIN"],
);
check(
  "a category is written once, spanning its items",
  grid.map((r) => [r.category, r.span]),
  [["SEWING THREAD", 1], ["LABEL", 2], [null, 0], ["PIN", 2], [null, 0]],
);
check(
  "the item prints its FULL name, category word included",
  grid[1].item,
  "LABEL / MAIN & SIZE / PRINTED / SATIN / CUT & SEAL",
);
check("Specification is the line's supply type, as the printout", grid[0].spec, "Type:Local");
check("...followed by the line's own specification text", grid[1].spec, "Type:Local SATIN FINISH");
check("a line with no supply type prints nothing, not 'Type:'", grid[3].spec, null);
check(
  "each colour is its own row, and one colour across two lines is summed",
  grid.filter((r) => r.item.startsWith("PIN")).map((r) => [r.colour, r.qty]),
  [["RED", 125], ["BLUE", 50]],
);
check("the consumption column carries through", grid[0].consumption, "1 CONE / 10 PCS");

const gridRefused = accessoryRows(
  [
    row({ item_id: "i-pin", sno: 1, required_qty: 100 }),
    row({ item_id: "i-pin", sno: 2, required_qty: null, refusal_reason: "No Approval Qty" }),
  ],
  PNAMES,
);
check(
  "a refused slice refuses the whole row — never a partial sum",
  [gridRefused[0].qty, gridRefused[0].refusal],
  [null, "No Approval Qty"],
);
check("a sheet frozen before item_line_id existed still builds", accessoryRows([row({})], NAMES)[0].spec, null);
check("nothing in, nothing out (printout)", accessoryRows([], PNAMES), []);

check("the printout's quantity has three decimals", accessoryQty(3141), "3,141.000");
check("...a fraction rounds to three", accessoryQty(85.7142857), "85.714");
check("no quantity is a dash (printout)", accessoryQty(null), "—");

console.log(failed === 0 ? "\nOK — every requirement sheet vector holds." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
