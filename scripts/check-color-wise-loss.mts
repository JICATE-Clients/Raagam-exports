/**
 * Vectors for COLOUR-WISE PROCESS LOSS (0606, client spec 2026-09-21).
 *
 * A route step (Fabric Process) or a yarn step (Yarn Process) marked "Assort
 * Color-Wise Loss" carries one loss % per colourway. The arithmetic lives in ONE
 * place — `lossForCombo`, applied inside `stagesForGroup` — so these vectors go
 * through the public ladders (`comboUplift`, `comboUpliftBreakdown`,
 * `yarnPurchase`) rather than the helper alone: a resolution that worked in the
 * helper and was bypassed by a ladder would pass a helper-only test.
 *
 * ## THE NUMBERS ARE THE LEGACY PDF'S OWN
 *
 * `Yarndyed _Format.pdf`: 510.500 at 5% → 537.368, 340.299 at 4% → 354.478,
 * 170.201 at 3% → 175.465, total 1067.311. Each is `net / (1 - L)`.
 *
 * ## THE "Avg" IS NOT THE SPEC'S 4.54%
 *
 * The spec's sample prints "Avg 4.54%" — the markup, 1067.311/1021 − 1. Under
 * `/(1 − L)` the single loss that reproduces the total is 4.34%. Vector §7
 * refutes 4.54 by name so a "fix" back to the spec's figure fails loudly.
 *
 * Run: npx tsx scripts/check-color-wise-loss.mts
 */
import {
  comboUplift,
  comboUpliftBreakdown,
  isRefusal,
  lossForCombo,
  stagesForGroup,
  yarnPurchase,
  type FabricComposition,
  type FabricGross,
  type RouteStage,
} from "../lib/orders/fabric-bom/yarn-process";
import {
  colorLossProblem,
  colorLossSeed,
  colorLossesForStorage,
  colorLossesFromDraft,
  colorLossesInput,
  colorLossesToDraft,
  isColorWiseFor,
  sectionAverageLoss,
} from "../lib/orders/fabric-bom/color-loss";
import {
  blankFabricProcess,
  expandByColour,
  fabricBomProcessInput,
  gatherByRoute,
  type FabricProcessRow,
} from "../lib/orders/fabric-bom/processes";

let failed = 0;
let passed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`ok    ${label}`);
  } else {
    failed++;
    console.error(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  }
}
function near(label: string, actual: unknown, expected: number, eps = 5e-4) {
  const ok = typeof actual === "number" && Math.abs(actual - expected) < eps;
  if (ok) {
    passed++;
    console.log(`ok    ${label}`);
  } else {
    failed++;
    console.error(`FAIL  ${label}\n      expected ~${expected}\n      actual   ${JSON.stringify(actual)}`);
  }
}
const num = (v: unknown): number => {
  if (isRefusal(v as never)) throw new Error(`refused: ${(v as { refused: string }).refused}`);
  return v as number;
};

const DYEING: RouteStage = {
  combo: null,
  stage_id: "DYED",
  process_id: "DYEING",
  loss_pct: 5,
  color_losses: { GREEN: 5, RED: 4, WHITE: 3 },
};

// ---------------------------------------------------------------------------
// 1. `lossForCombo` — own figure wins, missing falls back, keys by comboKey.
// ---------------------------------------------------------------------------
check("RED's own loss wins over the step's 5", lossForCombo(DYEING, "RED"), 4);
check("a colourway absent from the map pays the step's default", lossForCombo(DYEING, "NAVY"), 5);
check("keys match through comboKey (trim + caps)", lossForCombo({ loss_pct: 5, color_losses: { " green ": 2 } }, "GREEN"), 2);
check("no map is the flat loss", lossForCombo({ loss_pct: 7, color_losses: null }, "RED"), 7);
check("a blank default with no own figure stays null, never invented", lossForCombo({ loss_pct: null, color_losses: { RED: 4 } }, "WHITE"), null);

// ---------------------------------------------------------------------------
// 2. THE LEGACY PDF, THROUGH THE LADDER — not through the helper.
// ---------------------------------------------------------------------------
{
  const route = [DYEING];
  near("GREEN 510.500 at 5% → 537.368", 510.5 * num(comboUplift(route, "GREEN")), 537.368);
  near("RED 340.299 at 4% → 354.478", 340.299 * num(comboUplift(route, "RED")), 354.478);
  near("WHITE 170.201 at 3% → 175.465", 170.201 * num(comboUplift(route, "WHITE")), 175.465);
  const total =
    510.5 * num(comboUplift(route, "GREEN")) +
    340.299 * num(comboUplift(route, "RED")) +
    170.201 * num(comboUplift(route, "WHITE"));
  near("...and the three sum to the PDF's 1067.311", total, 1067.311, 2e-3);
  /* THE REFUTATION — a flat 5% on all three is what the engine did before 0606. */
  check("...which a flat 5% (pre-0606) does NOT give", Math.abs(1021 / 0.95 - total) < 0.01, false);
}

// ---------------------------------------------------------------------------
// 3. COMPOUNDING: Knitting 2% → Dyeing (colour-wise) → Compacting 1%.
// ---------------------------------------------------------------------------
{
  const route: RouteStage[] = [
    { combo: null, stage_id: "GREY", process_id: "KNITTING", loss_pct: 2 },
    DYEING,
    { combo: null, stage_id: "DYED", process_id: "COMPACTING", loss_pct: 1 },
  ];
  near("GREEN compounds /0.98 /0.95 /0.99", num(comboUplift(route, "GREEN")), 1 / 0.98 / 0.95 / 0.99, 1e-12);
  near("WHITE compounds /0.98 /0.97 /0.99", num(comboUplift(route, "WHITE")), 1 / 0.98 / 0.97 / 0.99, 1e-12);

  const bd = comboUpliftBreakdown(route, "RED");
  if (isRefusal(bd)) throw new Error(bd.refused);
  check("the report ladder prints RED's own 4% on the DYEING line", bd.steps.map((s) => s.loss_pct), [2, 4, 1]);
  near("...and its factor is exactly comboUplift's", bd.factor, num(comboUplift(route, "RED")), 1e-12);
  check(
    "...and the ladder chains (after[i] === before[i+1])",
    bd.steps.every((s, i) => i === 0 || bd.steps[i - 1].factorAfter === s.factorBefore),
    true,
  );
}

// ---------------------------------------------------------------------------
// 4. `stagesForGroup` is the ONE filter — it hands every ladder the resolved
//    loss, and never mutates the caller's stage.
// ---------------------------------------------------------------------------
{
  const route = [DYEING];
  const g = stagesForGroup(route, "WHITE");
  if (isRefusal(g)) throw new Error(g.refused);
  check("stagesForGroup writes WHITE's 3 into loss_pct", g[0].loss_pct, 3);
  check("...without touching the stored step (still 5)", DYEING.loss_pct, 5);
  const flat: RouteStage = { combo: null, loss_pct: 5 };
  const g2 = stagesForGroup([flat], "WHITE");
  check("a step with no map comes back as the same object", !isRefusal(g2) && g2[0] === flat, true);
}

// ---------------------------------------------------------------------------
// 5. YARN PURCHASE — a yarn's OWN colour-wise step reaches the stored figure.
// ---------------------------------------------------------------------------
{
  const comp = new Map<string, FabricComposition>([
    ["F1", { fabric_id: "F1", fabric_name: "SJ", components: [{ yarn_id: "Y1", blend_pct: 100 }] }],
  ]);
  const fabrics: FabricGross[] = [
    { fabric_id: "F1", combo: "GREEN", gross: 100, uom_id: "KG" },
    { fabric_id: "F1", combo: "WHITE", gross: 100, uom_id: "KG" },
  ];
  const w = yarnPurchase("Y1", fabrics, comp, new Map(), [
    { combo: null, loss_pct: 5, color_losses: { GREEN: 10, WHITE: 2 } },
  ], 3);
  if (isRefusal(w)) throw new Error(w.refused);
  check(
    "yarn step GREEN 10% / WHITE 2% → 111.112 + 102.041",
    w.byCombo.map((c) => [c.combo, c.gross]),
    [["GREEN", 111.112], ["WHITE", 102.041]],
  );
  near("...purchase rounds the EXACT total up once (213.152, not the rounded sum 213.153)", w.qty, 213.152, 1e-9);
}

// ---------------------------------------------------------------------------
// 6. THE DIALOG'S GATE AND SEED.
// ---------------------------------------------------------------------------
{
  const cs = ["GREEN", "RED", "WHITE"];
  check("seed fills every colour with the default", colorLossSeed(cs, {}, "5"), { GREEN: "5", RED: "5", WHITE: "5" });
  check("seed keeps what is set, defaults the rest", colorLossSeed(cs, { RED: "4" }, "5"), { GREEN: "5", RED: "4", WHITE: "5" });
  check("seed drops a colourway that left the fabric", colorLossSeed(["RED"], { RED: "4", NAVY: "9" }, "5"), { RED: "4" });
  check("gate: all valid → saves", colorLossProblem(cs, { GREEN: "5", RED: "4", WHITE: "0" }), null);
  check("gate: a blank colour is refused by name", colorLossProblem(cs, { GREEN: "5", RED: "", WHITE: "3" }), "Enter the loss % for RED");
  check("gate: negative refused", colorLossProblem(["RED"], { RED: "-1" }), "The loss % for RED cannot be negative");
  check("gate: 100 refused (divides by zero)", colorLossProblem(["RED"], { RED: "100" }), "The loss % for RED must be below 100");
  check("gate: no colourways is refused, not an empty save", colorLossProblem([], {}) !== null, true);
}

// ---------------------------------------------------------------------------
// 7. THE SECTION "Avg" — consistent with /(1 − L), and NOT the spec's 4.54.
// ---------------------------------------------------------------------------
{
  const lines = [{ lossPct: 5 }, { lossPct: 4 }, { lossPct: 3 }];
  const avg = sectionAverageLoss(lines, 1021, 1067.311);
  near("Avg for the PDF's block is 4.34%", avg, 4.339, 1e-3);
  check("...NOT the spec's 4.54% (that is the markup)", avg !== null && Math.abs(avg - 4.54) < 0.01, false);
  near("...and it reproduces the total: 1021 / (1 - avg)", 1021 / (1 - (avg as number) / 100), 1067.311, 1e-6);
  check("uniform losses print no Avg (the column already says it)", sectionAverageLoss([{ lossPct: 5 }, { lossPct: 5 }], 100, 105.263), null);
}

// ---------------------------------------------------------------------------
// 8. STORAGE — off stores empty; the schema normalises and refuses.
// ---------------------------------------------------------------------------
{
  check("off stores an empty map whatever was typed", colorLossesForStorage(false, { RED: 4 }), { color_wise_loss: false, color_losses: {} });
  check("on stores the map", colorLossesForStorage(true, { RED: 4 }), { color_wise_loss: true, color_losses: { RED: 4 } });
  check("the payload normalises keys and drops blanks", colorLossesInput.parse({ " red ": "4", "": 2 }), { RED: 4 });
  check("the payload refuses 100", colorLossesInput.safeParse({ RED: 100 }).success, false);
  check("a stored jsonb map round-trips to text", colorLossesToDraft({ RED: 4, GREEN: 5.5 }), { RED: "4", GREEN: "5.5" });
  check("draft → numbers skips a blank (default applies)", colorLossesFromDraft(true, { RED: "4", WHITE: "" }), { RED: 4 });
  check("draft with the toggle off → null (flat loss)", colorLossesFromDraft(false, { RED: "4" }), null);
  const row = fabricBomProcessInput.parse({ item_id: "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e" });
  check("a pre-0606 payload lands on flat loss", [row.color_wise_loss, row.color_losses], [false, {}]);
}

// ---------------------------------------------------------------------------
// 9. THE COLOUR FOLD must not merge two steps whose colour losses differ —
//    a fold that did would silently rewrite one of them on the next save.
// ---------------------------------------------------------------------------
{
  const FAB = "11111111-1111-1111-1111-111111111111";
  let n = 0;
  const step = (over: Partial<FabricProcessRow>): FabricProcessRow => ({
    ...blankFabricProcess(`k${++n}`, FAB),
    stage_id: "DYED",
    process_id: "DYEING",
    loss_pct: "5",
    ...over,
  });
  const a = step({ key: "a", combo: null, color_wise_loss: true, color_losses: { RED: "4" } });
  const b = step({ key: "b", combo: null, color_wise_loss: true, color_losses: { RED: "3" } });
  check("different colour losses stay two rows", gatherByRoute([a, b]).length, 2);
  const back = gatherByRoute([a, b]).flatMap((g) => expandByColour(g, () => "new"));
  check("...and gather → expand returns them unchanged", back, [a, b]);
}

// ---------------------------------------------------------------------------
// 10. THE For FIELD IS THE SWITCH (client 2026-09-21) — one rule, both grids.
// ---------------------------------------------------------------------------
{
  const L = [
    { id: "pw", code: "process_wise", name: "PROCESS WISE" },
    { id: "cw", code: "color_wise", name: "COLOR WISE" },
    { id: "renamed", code: "x1", name: "Colour Wise" },
    { id: "other", code: "x2", name: "PIECE WISE" },
  ];
  check("COLOR WISE → the [Color Loss] list", isColorWiseFor("cw", L), true);
  check("PROCESS WISE → the one Loss % box", isColorWiseFor("pw", L), false);
  check("blank For → the box (a row not yet answered)", isColorWiseFor(null, L), false);
  check("a label renamed COLOUR WISE still counts", isColorWiseFor("renamed", L), true);
  check("an unrelated label does not", isColorWiseFor("other", L), false);
  check("an id no longer in the list does not", isColorWiseFor("gone", L), false);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
