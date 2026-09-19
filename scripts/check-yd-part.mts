// Vectors for YD Part (0596) — one yarn-dyed fabric allocated more than once
// on a Fabric BOM (a Top and a Bottom knitted to different stripe ratios).
//
//     npm run check:yd-part
//
// Run by tsx (the modules resolve `@/`), listed in tsconfig `exclude`.
//
// What it pins:
//   1. The Save-gate rules (`ydPartProblems`) — an unnamed part beside a named
//      one is refused, a Manual entry of a split fabric must name a live part,
//      and a fabric that is not yarn-dyed is never asked.
//   2. `nextYdPartName` — the placeholder a second pick starts with.
//   3. THE ARITHMETIC. Two parts of one cloth, same colourway, different
//      stripes and dye losses: each part's weight is grossed by ITS OWN stripes.
//      Without the part in the match the two parts' shares pool to 200% of the
//      yarn and the engine refuses the cloth — so this vector fails loudly if
//      the part ever stops reaching `shadeDyeFactor`.
//   4. No part anywhere = the arithmetic every document before 0596 had.

import { nextYdPartName, ydPartProblems, ydPartsOf } from "../lib/orders/fabric-bom/yd-part.ts";
import { fabricGroupKey, ydPartKey } from "../lib/orders/fabric-bom/component-map.ts";
import { yarnShadesFrom, type YdRepeatRow } from "../lib/orders/fabric-bom/yarn-dyed.ts";
import { yarnPurchase, type FabricGross } from "../lib/orders/fabric-bom/yarn-process.ts";

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
}
function near(name: string, got: unknown, want: number, tol = 0.011) {
  const ok = typeof got === "number" && Math.abs(got - want) <= tol;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${want} ± ${tol}`}`);
}

// ---------------------------------------------------------------- 1. rules
const YD = new Set(["yd-jersey"]);
const isYd = (id: string) => YD.has(id);
const name = (id: string) => ({ "yd-jersey": "YD JERSEY", solid: "SOLID JERSEY" })[id] ?? id;

eq("part key folds case and blank", [ydPartKey(" top "), ydPartKey(null), ydPartKey("")], ["TOP", "", ""]);
eq(
  "the group key keeps a part-less row's old shape apart from a TOP row",
  fabricGroupKey({ style_ref_no: "S1", structure_id: "st", item_id: "f" }) !==
    fabricGroupKey({ style_ref_no: "S1", structure_id: "st", item_id: "f", yd_part: "TOP" }),
  true,
);

const splitLines = [
  { style_ref_no: "S1", item_id: "yd-jersey", yd_part: "TOP" },
  { style_ref_no: "S1", item_id: "yd-jersey", yd_part: "BOTTOM" },
  { style_ref_no: "S1", item_id: "solid", yd_part: null },
];
eq("parts of a split fabric, first-seen order", ydPartsOf(splitLines, "yd-jersey", "S1"), ["TOP", "BOTTOM"]);
eq(
  "a split fabric, both parts named, each entry on a live part → no problem",
  ydPartProblems(
    splitLines,
    [
      { style_ref_no: "S1", item_id: "yd-jersey", yd_part: "TOP" },
      { style_ref_no: "S1", item_id: "yd-jersey", yd_part: "bottom" },
      { style_ref_no: "S1", item_id: "solid", yd_part: null },
    ],
    isYd,
    name,
  ),
  [],
);
eq(
  "an unnamed part beside a named one → refused, naming the count",
  ydPartProblems(
    [
      { style_ref_no: "S1", item_id: "yd-jersey", yd_part: "TOP" },
      { style_ref_no: "S1", item_id: "yd-jersey", yd_part: "" },
    ],
    [],
    isYd,
    name,
  ),
  ["YD JERSEY is allocated 2 times — give every allocation a YD Part name (e.g. TOP, BOTTOM) on Fabric Allocation."],
);
eq(
  "a Manual entry of a split fabric with no part → refused, listing the parts",
  ydPartProblems(splitLines, [{ style_ref_no: "S1", item_id: "yd-jersey", yd_part: "" }], isYd, name),
  ["YD JERSEY: this fabric has 2 YD Parts (TOP, BOTTOM) — pick which one this Manual entry weighs."],
);
eq(
  "a Manual entry on a part Fabric Allocation no longer has → refused",
  ydPartProblems(splitLines, [{ style_ref_no: "S1", item_id: "yd-jersey", yd_part: "SLEEVE" }], isYd, name),
  ["YD JERSEY: Manual entry is for YD Part SLEEVE, which Fabric Allocation no longer has — pick one of TOP, BOTTOM."],
);
eq(
  "a fabric that is not yarn-dyed is never asked, even with odd data",
  ydPartProblems(
    [
      { style_ref_no: "S1", item_id: "solid", yd_part: "TOP" },
      { style_ref_no: "S1", item_id: "solid", yd_part: "" },
    ],
    [{ style_ref_no: "S1", item_id: "solid", yd_part: "" }],
    isYd,
    name,
  ),
  [],
);
eq(
  "one part only (every pre-0596 document) → no problem",
  ydPartProblems(
    [{ style_ref_no: "S1", item_id: "yd-jersey", yd_part: null }],
    [{ style_ref_no: "S1", item_id: "yd-jersey", yd_part: null }],
    isYd,
    name,
  ),
  [],
);
eq(
  "parts are per STYLE — the same cloth split in S1 is not split in S2",
  ydPartProblems(splitLines, [{ style_ref_no: "S2", item_id: "yd-jersey", yd_part: "" }], isYd, name),
  [],
);

// ---------------------------------------------------------------- 2. names
eq("second pick is PART 2", nextYdPartName([""]), "PART 2");
eq("skips a taken number", nextYdPartName(["PART 1", "part 2"]), "PART 3");
eq("renamed parts do not block PART 2", nextYdPartName(["TOP"]), "PART 2");

// ---------------------------------------------------------------- 3. arithmetic
const COMP = new Map([
  ["yd-jersey", { fabric_id: "yd-jersey", fabric_name: "YD JERSEY", components: [{ yarn_id: "y-1", blend_pct: 100 }] }],
]);
const rep = (sno: number, value: number): YdRepeatRow => ({
  key: `r${sno}`,
  sno,
  yarn_item_id: "y-1",
  dye_type: "dyed",
  color_name: `Color ${sno}`,
  uom_id: null,
  value,
  twisted_yarn: "",
});
const combo = (losses: number[]) => [
  { combo: "WHITE/NAVY", colors: losses.map((l, i) => ({ sno: i + 1, dyeing_loss_pct: l })) },
];
// TOP: 80% NAVY (5% loss) / 20% WHITE (3%).  BOTTOM: 70 / 30, same losses.
const shadesTop = yarnShadesFrom("yd-jersey", [rep(1, 80), rep(2, 20)], COMP.get("yd-jersey")!, combo([5, 3]), undefined, "TOP");
const shadesBottom = yarnShadesFrom("yd-jersey", [rep(1, 70), rep(2, 30)], COMP.get("yd-jersey")!, combo([5, 3]), undefined, "BOTTOM");
eq("each shade carries its part", [...new Set([...shadesTop, ...shadesBottom].map((h) => h.yd_part))], ["TOP", "BOTTOM"]);

const gross: FabricGross[] = [
  { fabric_id: "yd-jersey", yd_part: "TOP", combo: "WHITE/NAVY", gross: 100, uom_id: "kg" },
  { fabric_id: "yd-jersey", yd_part: "BOTTOM", combo: "WHITE/NAVY", gross: 100, uom_id: "kg" },
];
const fTop = 0.8 / 0.95 + 0.2 / 0.97;
const fBottom = 0.7 / 0.95 + 0.3 / 0.97;
const split = yarnPurchase("y-1", gross, COMP, new Map(), [], 3, new Map(), [...shadesTop, ...shadesBottom]);
near(
  "TOP and BOTTOM grossed by their OWN stripes: 100·(0.8/0.95+0.2/0.97) + 100·(0.7/0.95+0.3/0.97)",
  typeof split === "object" && "qty" in split ? split.qty : split,
  100 * fTop + 100 * fBottom,
);

/* THE FAILURE THIS FEATURE PREVENTS, pinned: strip the parts and the same
   shades pool to 200% of the yarn — the engine refuses the cloth. */
const pooled = yarnPurchase(
  "y-1",
  gross.map((g) => ({ ...g, yd_part: null })),
  COMP,
  new Map(),
  [],
  3,
  new Map(),
  [...shadesTop, ...shadesBottom].map((h) => ({ ...h, yd_part: null })),
);
eq(
  "without parts the two stripe sets pool and the cloth is refused",
  typeof pooled === "object" && "refused" in pooled,
  true,
);

// ---------------------------------------------------------------- 4. no part = before
const plainShades = yarnShadesFrom("yd-jersey", [rep(1, 80), rep(2, 20)], COMP.get("yd-jersey")!, combo([5, 3]));
const plain = yarnPurchase(
  "y-1",
  [{ fabric_id: "yd-jersey", combo: "WHITE/NAVY", gross: 100, uom_id: "kg" }],
  COMP,
  new Map(),
  [],
  3,
  new Map(),
  plainShades,
);
near("no part anywhere = the pre-0596 figure, 100·(0.8/0.95+0.2/0.97)", typeof plain === "object" && "qty" in plain ? plain.qty : plain, 100 * fTop);

if (failed) {
  console.error(`\ncheck:yd-part — ${failed} failure(s)`);
  process.exit(1);
}
console.log("\ncheck:yd-part — all vectors pass");
