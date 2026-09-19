/**
 * IWO Budget ▸ the pull (0594, Phase 3) — what a work order's stored BOM puts
 * on its budget, source by source.
 *
 *     npm run check:iwo-budget
 *
 * The rule under every vector: a budget line is the BOM's OWN stored figure
 * (or, for fabric processes, the order report's own arithmetic on it), never
 * a second computation; a figure the BOM could not state is SKIPPED AND SAID,
 * never pulled as 0; and the IWO's cost adds up through the order Budget's
 * `budgetTotals` unchanged, with no sales to be relative to.
 */

import { pullIwoLines, iwoPulledKey, type IwoPullInput, type IwoPulledLine } from "../lib/orders/iwo-budget/pull.ts";
import { isBlankIwoBudgetLine, iwoBudgetProblems } from "../lib/orders/iwo-budget/rules.ts";
import { iwoMergeIsEmpty, mergeIwoPulled } from "../lib/orders/iwo-budget/merge.ts";
import { budgetTotals, isRefusal, NO_ORDERS_YET } from "../lib/orders/budget/totals.ts";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  } else console.log(`ok    ${label}`);
}
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

const KG = "kg";
const GREY = "st-grey";
const DYED = "st-dyed";
const COTTON = "yarn-cotton";
const FAB = "fab-sj";
const KNIT = "p-knit";
const DYE = "p-dye";
const YDYE = "p-ydye";
const names: Record<string, string> = { [COTTON]: "30'S COTTON", [FAB]: "SINGLE JERSEY", tape: "TAPE" };

const input = (over: Partial<IwoPullInput>): IwoPullInput => ({
  iwoFor: "yarn",
  fabricBom: null,
  materialBom: null,
  kgUomId: KG,
  greyYarnStageId: GREY,
  processKinds: new Map([
    [KNIT, { is_knitting: true, is_dyeing: false }],
    [DYE, { is_knitting: false, is_dyeing: true }],
  ]),
  name: (id) => names[id] ?? id,
  ...over,
});
const fbom = (over: Partial<NonNullable<IwoPullInput["fabricBom"]>>) => ({
  is_draft: false,
  yarns: [],
  lines: [],
  processes: [],
  ...over,
});
const yarn = (over: Partial<NonNullable<IwoPullInput["fabricBom"]>["yarns"][number]>) => ({
  item_id: COTTON,
  purchase_qty: 1000,
  uom_id: KG,
  refusal_reason: null,
  buy_stage_id: GREY,
  colour_by: null,
  shades: [],
  stages: [],
  ...over,
});
const step = (process_id: string, combo: string | null, process_qty: number | null, sno = 1) => ({
  sno,
  stage_id: GREY,
  process_id,
  combo,
  process_qty,
  uom_id: KG,
  refusal_reason: process_qty == null ? "Enter the loss" : null,
});
const pulled = (i: IwoPullInput) => {
  const r = pullIwoLines(i);
  return "refused" in r ? r : { lines: r.lines.map((l) => [l.source, l.item_id, l.process_id, l.combo, l.basis, l.qty, l.stage_id]), skipped: r.skipped };
};

// §1 — nothing is pulled from a BOM that is not there, or not finished.
check("§1 no Fabric BOM refuses", pullIwoLines(input({})), {
  refused: "This work order has no Fabric BOM yet — raise it first.",
});
check("§1 a draft Fabric BOM refuses", pullIwoLines(input({ fabricBom: fbom({ is_draft: true }) })), {
  refused: "The Fabric BOM is a draft — save it (not as a draft) before budgeting it.",
});
check("§1 no Material BOM refuses (Accessories)", pullIwoLines(input({ iwoFor: "accessories" })), {
  refused: "This work order has no Material BOM yet — raise it first.",
});
check(
  "§1 a draft Material BOM refuses",
  pullIwoLines(input({ iwoFor: "accessories", materialBom: { is_draft: true, items: [], processes: [] } })),
  { refused: "The Material BOM is a draft — save it (not as a draft) before budgeting it." },
);

// §2 — Yarn IWO, the three shapes (0592).
check("§2 GREY: one line at its own stage", pulled(input({ fabricBom: fbom({ yarns: [yarn({})] }) })), {
  lines: [["yarn", COTTON, null, null, null, 1000, GREY]],
  skipped: [],
});
check(
  "§2 DYED · Dyed Purchase: one purchase line PER SHADE, shade in capitals",
  pulled(
    input({
      fabricBom: fbom({
        yarns: [
          yarn({
            buy_stage_id: DYED,
            colour_by: "dyed_purchase",
            purchase_qty: 222.224,
            shades: [
              { color_name: "navy", purchase_qty: 111.112 },
              { color_name: "BLACK", purchase_qty: 111.112 },
            ],
          }),
        ],
      }),
    }),
  ),
  {
    lines: [
      ["yarn", COTTON, null, "NAVY", null, 111.112, DYED],
      ["yarn", COTTON, null, "BLACK", null, 111.112, DYED],
    ],
    skipped: [],
  },
);
check(
  "§2 DYED · Yarn Dyeing: ONE grey lot, then a dyeing line per shade",
  pulled(
    input({
      fabricBom: fbom({
        yarns: [
          yarn({
            buy_stage_id: DYED,
            colour_by: "yarn_dyeing",
            purchase_qty: 222.223,
            shades: [
              { color_name: "NAVY", purchase_qty: null },
              { color_name: "BLACK", purchase_qty: null },
            ],
            stages: [step(YDYE, "NAVY", 111.1111, 1), step(YDYE, "BLACK", 111.1111, 2)],
          }),
        ],
      }),
    }),
  ),
  {
    lines: [
      ["yarn", COTTON, null, null, null, 222.223, DYED],
      ["yarn_process", COTTON, YDYE, "NAVY", "color", 111.1111, GREY],
      ["yarn_process", COTTON, YDYE, "BLACK", "color", 111.1111, GREY],
    ],
    skipped: [],
  },
);

// §3 — a figure the BOM could not state is skipped and said, never a zero.
check(
  "§3 a refused yarn is skipped with the BOM's own sentence",
  pulled(input({ fabricBom: fbom({ yarns: [yarn({ purchase_qty: null, refusal_reason: "Enter the Planned Weight" })] }) })),
  { lines: [], skipped: ["30'S COTTON: Enter the Planned Weight"] },
);
check(
  "§3 a refused step is skipped; its yarn still pulls",
  pulled(input({ fabricBom: fbom({ yarns: [yarn({ stages: [step(YDYE, null, null)] })] }) })),
  {
    lines: [["yarn", COTTON, null, null, null, 1000, GREY]],
    skipped: ["30'S COTTON: a Yarn Process step — Enter the loss"],
  },
);
check(
  "§3 two steps of one process on one lot are one charge",
  pulled(input({ fabricBom: fbom({ yarns: [yarn({ stages: [step(YDYE, null, 500, 1), step(YDYE, null, 520, 2)] })] }) })),
  {
    lines: [
      ["yarn", COTTON, null, null, null, 1000, GREY],
      ["yarn_process", COTTON, YDYE, null, "process", 1020, GREY],
    ],
    skipped: [],
  },
);

// §4 — Fabric IWO: yarn bought grey; fabric processes from Req Wt through the
// route, the order report's `toOrderedWt` arithmetic (net × factorAfter).
const fabricInput = input({
  iwoFor: "fabric",
  fabricBom: fbom({
    yarns: [yarn({ buy_stage_id: null, purchase_qty: 2100 })],
    lines: [
      { item_id: FAB, req_kgs: 1000 },
      { item_id: FAB, req_kgs: 1000 },
    ],
    processes: [
      { item_id: FAB, sno: 1, stage_id: GREY, process_id: KNIT, loss_pct: 1 },
      { item_id: FAB, sno: 2, stage_id: DYED, process_id: DYE, loss_pct: 3 },
    ],
  }),
});
check("§4 Fabric IWO: two dias of one fabric are one net, each step through the route", pulled(fabricInput), {
  lines: [
    ["yarn", COTTON, null, null, null, 2100, GREY],
    ["fabric_process", FAB, KNIT, null, "fabric", r4(2000 / 0.99), GREY],
    ["fabric_process", FAB, DYE, null, "fabric", r4(2000 / 0.99 / 0.97), DYED],
  ],
  skipped: [],
});
check(
  "§4 a fabric with no Req Wt is skipped, named",
  pulled(input({ iwoFor: "fabric", fabricBom: fbom({ lines: [{ item_id: FAB, req_kgs: null }] }) })),
  { lines: [], skipped: ["SINGLE JERSEY: Enter the Req Wt for SINGLE JERSEY on Fabric Consumption."] },
);

// §5 — Accessories: required qty in the consumption unit, FOC from the BOM,
// one line per colour; a process charges on Σ that item's required qty.
const matInput = input({
  iwoFor: "accessories",
  materialBom: {
    is_draft: false,
    items: [
      { item_id: "tape", color_name: "Navy", required_qty: 100, consumption_uom_id: "mtr", specification: "12MM", is_foc: false, refusal_reason: null },
      { item_id: "tape", color_name: "BLACK", required_qty: 50, consumption_uom_id: "mtr", specification: null, is_foc: true, refusal_reason: null },
    ],
    processes: [{ item_id: "tape", process_id: DYE }],
  },
});
check("§5 accessories pull per colour, then the process on their sum", pulled(matInput), {
  lines: [
    ["material", "tape", null, "NAVY", null, 100, null],
    ["material", "tape", null, "BLACK", null, 50, null],
    ["material_process", "tape", DYE, null, null, 150, null],
  ],
  skipped: [],
});
{
  const r = pullIwoLines(matInput);
  check("§5 FOC comes from the BOM line", "refused" in r ? r : r.lines.map((l) => l.is_foc), [false, true, false]);
}
check(
  "§5 an item with no required qty is skipped, and so is its process",
  pulled(
    input({
      iwoFor: "accessories",
      materialBom: {
        is_draft: false,
        items: [{ item_id: "tape", color_name: null, required_qty: null, consumption_uom_id: "mtr", specification: null, is_foc: false, refusal_reason: "No UOM conversion" }],
        processes: [{ item_id: "tape", process_id: DYE }],
      },
    }),
  ),
  { lines: [], skipped: ["TAPE: No UOM conversion"] },
);

// §6 — the key a refresh matches by folds the shade's case.
check(
  "§6 a stored NAVY and a fresh navy are one line",
  iwoPulledKey({ source: "yarn", item_id: COTTON, combo: "navy" }) === iwoPulledKey({ source: "yarn", item_id: COTTON, combo: "NAVY " }),
  true,
);

// §7 — the IWO's cost adds up through the ORDER Budget's own totals.
{
  const r = pullIwoLines(fabricInput);
  const lines = "refused" in r ? [] : r.lines.map((l) => ({ source: l.source, qty: l.qty, rate: 10, is_foc: l.is_foc }));
  const t = budgetTotals(lines, []);
  // Each line's money is rounded to the paisa before it is added (`lineAmount`),
  // so the total is the sum of rounded lines, not the rounded sum.
  const money = (n: number) => Math.round(n * 100) / 100;
  check(
    "§7 cost is Σ (qty × rate, per line) over every pulled line",
    t.cost,
    money(money(2100 * 10) + money(r4(2000 / 0.99) * 10) + money(r4(2000 / 0.99 / 0.97) * 10)),
  );
  check("§7 there is no sales value on a stock run — sales refuses, it is never 0", t.sales, { refused: NO_ORDERS_YET });
  check("§7 …and so profit refuses too", isRefusal(t.profit), true);
  check("§7 an unpriced pulled line is counted, not zeroed", budgetTotals([{ source: "yarn", qty: 5, rate: null }], []).unpriced.length, 1);
}

// ---------------------------------------------------------------------------
// §8 THE RULES (Phase 4, rules.ts) — what stops a save.
// ---------------------------------------------------------------------------
const bl = (over: Partial<Parameters<typeof iwoBudgetProblems>[0][number]>) => ({
  source: "yarn" as const,
  item_id: COTTON,
  process_id: null,
  cost_head_id: null,
  description: null,
  qty: 100,
  rate: 85,
  rate_type: "per_unit" as const,
  currency_code: null,
  ex_rate: null,
  is_foc: false,
  from_bom: true,
  ...over,
});
const probs = (ls: ReturnType<typeof bl>[], f: "yarn" | "fabric" | "accessories" = "yarn") =>
  iwoBudgetProblems(ls, f).map((p) => p.message);

check("§8 a priced pulled yarn line is clean", probs([bl({})]), []);
check(
  "§8 an untouched seeded row (Qty 1, nothing else) is blank — never saved, never refused",
  [isBlankIwoBudgetLine(bl({ item_id: null, rate: null, qty: 1, from_bom: false })), probs([bl({ item_id: null, rate: null, qty: 1, from_bom: false })])],
  [true, []],
);
check("§8 a pulled line is never blank, even unpriced", isBlankIwoBudgetLine(bl({ rate: null })), false);
check(
  "§8 a paid line owes its rate (the order Budget's own sentence)",
  iwoBudgetProblems([bl({ rate: null })], "yarn").map((p) => p.field),
  ["rate"],
);
check(
  "§8 a source the work order does not carry is refused",
  probs([bl({ source: "material" })], "yarn"),
  ["Accessories Purchases: this work order does not carry this kind of line."],
);
check(
  "§8 a Fabric IWO carries fabric processes; a Yarn IWO does not",
  [
    probs([bl({ source: "fabric_process", process_id: DYE })], "fabric"),
    probs([bl({ source: "fabric_process", process_id: DYE })], "yarn"),
  ],
  [[], ["Fabric Processes: this work order does not carry this kind of line."]],
);
check("§8 a process line owes its Process", probs([bl({ source: "yarn_process" })]), ["Yarn Processes: choose the Process."]);
check(
  "§8 an Other Expense owes a Head or a description",
  probs([bl({ source: "expense", item_id: null, from_bom: false, rate: 500, rate_type: "flat" })]),
  ["Other Expenses: choose the Head or type what the expense is."],
);
check(
  "§8 …and a flat expense with a description needs no quantity",
  probs([bl({ source: "expense", item_id: null, from_bom: false, description: "COURIER", rate: 500, rate_type: "flat", qty: null })]),
  [],
);
check(
  "§8 a foreign currency owes its exchange rate",
  iwoBudgetProblems([bl({ currency_code: "USD" })], "yarn").map((p) => p.field),
  ["ex_rate"],
);

// ---------------------------------------------------------------------------
// §9 REFRESH FROM BOM (merge.ts) — the order Budget's policy, line by line.
// ---------------------------------------------------------------------------
const held = (key: string, over: Partial<Parameters<typeof mergeIwoPulled>[0][number]> = {}) => ({
  key,
  from_bom: true,
  source: "yarn",
  item_id: COTTON,
  process_id: null,
  combo: null,
  basis: null,
  qty: 1000,
  uom_id: KG,
  stage_id: GREY,
  is_foc: false,
  ...over,
});
const fresh = (over: Partial<IwoPulledLine> = {}): IwoPulledLine => ({
  source: "yarn",
  item_id: COTTON,
  process_id: null,
  combo: null,
  basis: null,
  qty: 1000,
  uom_id: KG,
  stage_id: GREY,
  specification: null,
  is_foc: false,
  ...over,
});
check("§9 nothing changed → an empty plan", iwoMergeIsEmpty(mergeIwoPulled([held("a")], [fresh()])), true);
check("§9 a stored 1000.00004 is 1000 (numeric(16,4))", iwoMergeIsEmpty(mergeIwoPulled([held("a", { qty: 1000 })], [fresh({ qty: 1000.00004 })])), true);
check(
  "§9 the BOM's qty moved → the line is updated (its rate is the screen's to keep)",
  mergeIwoPulled([held("a")], [fresh({ qty: 1111.112 })]).update.map((u) => [u.key, u.line.qty]),
  [["a", 1111.112]],
);
check(
  "§9 a hand-typed line with the key of a BOM line is ADOPTED, not doubled",
  (() => {
    const m = mergeIwoPulled([held("t", { from_bom: false })], [fresh()]);
    return [m.update.map((u) => u.key), m.add.length];
  })(),
  [["t"], 0],
);
check(
  "§9 a new BOM line is added; a dropped one is FLAGGED, never removed",
  (() => {
    const m = mergeIwoPulled([held("a"), held("b", { combo: "NAVY" })], [fresh(), fresh({ combo: "BLACK" })]);
    return [m.add.map((l) => l.combo), m.stale];
  })(),
  [["BLACK"], ["b"]],
);
check("§9 a typed line the BOM never had is never stale", mergeIwoPulled([held("t", { from_bom: false, item_id: "x" })], []).stale, []);
check(
  "§9 an accessory's FOC is the BOM's — a flip is a change",
  mergeIwoPulled([held("m", { source: "material", is_foc: false })], [fresh({ source: "material", is_foc: true })]).update.length,
  1,
);

if (failed) {
  console.error(`\n${failed} IWO Budget vector(s) failed.`);
  process.exit(1);
}
console.log("\nIWO Budget: the pull reads each BOM's own figures, and the cost adds up.");
