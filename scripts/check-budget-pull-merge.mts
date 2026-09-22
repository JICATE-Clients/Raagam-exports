/**
 * Vectors for `lib/orders/budget/pull-merge.ts`: what "Refresh from BOMs" does
 * to a budget's lines, and what `submitBudget` refuses.
 *
 * Every clause is pinned by the case that breaks it: the typed rate a refresh
 * must not touch, the saved CAPITALS and 4-place quantity that must not read as
 * "the BOM changed", the hand-typed yarn a pull must adopt rather than cost
 * twice, the stale line, and the re-split fabric process that keeps its split.
 *
 * Runs under `tsx` for `check-budget-totals.mts`'s reason.
 */
import {
  mergeKey,
  mergePulled,
  pullMergeIsEmpty,
  pullMergeSize,
  type FreshLine,
  type HeldLine,
} from "../lib/orders/budget/pull-merge.ts";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `\n      got      ${JSON.stringify(actual)}\n      expected ${JSON.stringify(expected)}`}`);
}

const fresh = (over: Partial<FreshLine> = {}): FreshLine => ({
  source: "yarn",
  garment_order_id: "o1",
  item_id: "y-30s",
  process_id: null,
  combo: null,
  basis: null,
  style_ref_no: null,
  component_id: null,
  qty: 100,
  uom_id: "kg",
  description: "30s Combed",
  stage_id: "grey",
  is_foc: false,
  is_import: false,
  ...over,
});
const held = (key: string, over: Partial<HeldLine> = {}): HeldLine => ({
  ...fresh(),
  key,
  from_bom: true,
  ...over,
});

// ---- 1. a budget already in step is left alone ----
{
  const m = mergePulled([held("a")], [fresh()]);
  check("in step: nothing to do", pullMergeIsEmpty(m), true);
}

// ---- 2. what SAVING does to a value is not a change ----
{
  // Saved in CAPITALS (capsTextNullable) and at 4 places (numeric(16,4)).
  const m = mergePulled(
    [held("a", { description: "30S COMBED", qty: 100.1235, combo: "NAVY" })],
    [fresh({ description: "30s Combed", qty: 100.123456, combo: "Navy" })],
  );
  check("caps + 4dp: not a change", pullMergeIsEmpty(m), true);
}

// ---- 3. the BOM's quantity moved: update, and nothing else ----
{
  const m = mergePulled([held("a", { qty: 100 })], [fresh({ qty: 120 })]);
  check("qty moved: one update", m.update.map((u) => [u.key, u.line.qty]), [["a", 120]]);
  check("qty moved: nothing added or stale", [m.add.length, m.stale.length], [0, 0]);
}

// ---- 4. a new BOM line is added; a vanished one goes stale ----
{
  const m = mergePulled([held("a"), held("b", { item_id: "y-40s" })], [fresh(), fresh({ item_id: "y-20s" })]);
  check("new line added", m.add.map((l) => l.item_id), ["y-20s"]);
  check("vanished line is stale", m.stale.map((s) => s.key), ["b"]);
  check("stale defaults to flag", m.stale.map((s) => s.disposition), ["flag"]);
}

// ---- 5. a TYPED line with a BOM line's key is adopted, never doubled ----
{
  const m = mergePulled([held("t", { from_bom: false, qty: 1, description: "" })], [fresh()]);
  check("typed twin: adopted by update", m.update.map((u) => u.key), ["t"]);
  check("typed twin: not added beside it", m.add.length, 0);
}

// ---- 6. a typed line with no BOM twin never goes stale ----
{
  const m = mergePulled([held("t", { from_bom: false, item_id: "y-extra" })], []);
  check("typed line: never stale", m.stale.length, 0);
}

// ---- 7. FOC / Import are the operator's on EVERY line (user 2026-09-19) ----
{
  const acc = mergePulled([held("m", { source: "material", is_foc: true })], [fresh({ source: "material", is_foc: false })]);
  check("accessory FOC set on the budget is not a BOM change", pullMergeIsEmpty(acc), true);
  const yarn = mergePulled([held("y", { is_import: true })], [fresh({ is_import: false })]);
  check("yarn Import set on the budget is not a BOM change", pullMergeIsEmpty(yarn), true);
}

// ---- 8. two lots of one yarn are two lines (combo in the key) ----
{
  check("combo keys apart", mergeKey(fresh({ combo: "NAVY" })) === mergeKey(fresh({ combo: "WHITE" })), false);
  check("combo case-folded", mergeKey(fresh({ combo: "navy " })) === mergeKey(fresh({ combo: "NAVY" })), true);
}

// ---- 9. Fabric Processes: by group ----
const fp = (over: Partial<FreshLine> = {}) =>
  fresh({ source: "fabric_process", process_id: "dye", item_id: "sj", basis: "fabric", stage_id: null, ...over });
const hp = (key: string, over: Partial<HeldLine> = {}): HeldLine => ({ ...fp(), key, from_bom: true, ...over });
{
  // Fabric-wise, same total, weight moved between fabrics: still a change.
  const m = mergePulled(
    [hp("a", { item_id: "sj", qty: 60 }), hp("b", { item_id: "rib", qty: 40 })],
    [fp({ item_id: "sj", qty: 50 }), fp({ item_id: "rib", qty: 50 })],
  );
  check("fabric-wise: shifted weight re-fits", m.refit.map((g) => g.basis), ["fabric"]);
}
{
  // Re-split per colour: keys never match a pulled line, the TOTAL is the fact.
  const split = [
    hp("n", { basis: "color", item_id: null, combo: "NAVY", qty: 70 }),
    hp("w", { basis: "color", item_id: null, combo: "WHITE", qty: 30 }),
  ];
  const same = mergePulled(split, [fp({ qty: 100 })]);
  check("colour split, same total: left alone", pullMergeIsEmpty(same), true);
  const moved = mergePulled(split, [fp({ qty: 110 })]);
  check("colour split, total moved: re-fit at its grain", moved.refit.map((g) => g.basis), ["color"]);
  check("colour split lines are not stale", moved.stale.length, 0);
}
{
  const m = mergePulled([], [fp()]);
  check("new process group: re-fit with no grain", m.refit.map((g) => g.basis), [null]);
  const gone = mergePulled([hp("a")], []);
  check("process gone from the BOM: stale", gone.stale.map((s) => s.key), ["a"]);
}

// ---- 10. the refusal counts what a refresh would touch ----
{
  const m = mergePulled([held("a", { qty: 1 }), held("b", { item_id: "gone" })], [fresh(), fresh({ item_id: "new" })]);
  check("size = update + add + stale", pullMergeSize(m), 3);
}

console.log(failed ? `\n${failed} FAILED` : "\nall pull-merge vectors pass");
process.exit(failed ? 1 : 0);
