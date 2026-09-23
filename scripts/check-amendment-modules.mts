// Vectors for the Order Amendment module rules (0619, doc/order/amenment update.md).
//
//     npm run check:amendment-modules      (also runs inside `build:check`)
//
// Listed in tsconfig `exclude` like every other .mts checker: run with tsx.
//
// What it pins, each verified by being made to FAIL first:
//   1. MODULES — the four spec checkboxes become kinds and back again
//      (`kindsForSelection` ∘ `modulesOf` round-trips), and Order Entry without
//      its detail is refused with the spec's own words.
//   2. THE BUDGET RULE (`budgetScopeProblem`) — without Order Budget picked:
//      an approved rate cannot move, an Expense line cannot be added, changed
//      or removed, but an UNPRICED line takes a rate and a BOM quantity moves.
//   3. THE SPEC'S STATUSES — outcome × budget status → DRAFT /
//      PENDING_MD_APPROVAL / APPROVED / REJECTED (+ returned, abandoned, superseded).
//   4. THE MANUAL ENTRY SENTENCE — the spec's example, word for word.

import {
  entryStatusCode,
  entryStatusOf,
  kindsForSelection,
  moduleSelectionProblem,
  modulesOf,
} from "../lib/orders/amendments/amendment-entry.ts";
import { budgetScopeProblem, type BudgetScopeLine } from "../lib/orders/budget/amendment-scope.ts";
import { manualEntryMessage } from "../lib/orders/amendments/manual-entry.ts";

let failures = 0;
const ok = (m: string) => console.log(`ok    ${m}`);
const fail = (m: string) => {
  failures++;
  console.error(`FAIL  ${m}`);
};
const eq = (label: string, got: unknown, want: unknown) =>
  JSON.stringify(got) === JSON.stringify(want) ? ok(label) : fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// 1 --------------------------------------------------------------------------
{
  const kinds = kindsForSelection({ modules: ["order_entry", "fabric_bom"], orderKinds: ["qty_addition"] });
  eq("Order Entry (Qty) + Fabric BOM → kinds", kinds, ["qty_addition", "fabric_bom_revision"]);
  eq("…and back to modules", modulesOf(kinds), ["order_entry", "fabric_bom"]);
  eq("all four modules round-trip", modulesOf(kindsForSelection({
    modules: ["order_entry", "material_bom", "fabric_bom", "order_budget"],
    orderKinds: ["price_change"],
  })), ["order_entry", "material_bom", "fabric_bom", "order_budget"]);
  eq("legacy bom_revision = both BOMs", modulesOf(["bom_revision"]), ["material_bom", "fabric_bom"]);
  eq("a detail is ignored when Order Entry is not ticked", kindsForSelection({ modules: ["material_bom"], orderKinds: ["qty_addition"] }), ["material_bom_revision"]);
  const noDetail = moduleSelectionProblem({ modules: ["order_entry"], orderKinds: [] });
  if (noDetail?.includes("PO Qty, Delivery Date, FOB Price or Color Combos")) ok("Order Entry without its detail is refused in the spec's words");
  else fail(`Order Entry without detail: ${noDetail}`);
  eq("nothing picked is refused", moduleSelectionProblem({ modules: [], orderKinds: [] }), "Pick at least one module to revise");
}

// 2 --------------------------------------------------------------------------
{
  const zip: BudgetScopeLine = { source: "material", item_id: "zip", garment_order_id: "o1", description: "DYED ZIPPER", qty: 100, rate: 12 };
  const newTrim: BudgetScopeLine = { source: "material", item_id: "lbl", garment_order_id: "o1", description: "WASH LABEL", qty: 50, rate: null };
  const freight: BudgetScopeLine = { source: "expense", cost_head_id: "frt", description: "FREIGHT", qty: 1, rate: 5000 };
  const baseline = [zip, { ...newTrim }, freight];
  const run = (next: BudgetScopeLine[]) =>
    budgetScopeProblem({ entryNo: "AMD/26-27/0009", baseline, baselineHeader: {}, next, nextHeader: {} });

  eq("unchanged budget passes", run([zip, newTrim, freight]), null);
  eq("a BOM quantity moving passes", run([{ ...zip, qty: 120 }, newTrim, freight]), null);
  eq("an unpriced line taking a rate passes", run([zip, { ...newTrim, rate: 3.5 }, freight]), null);
  eq("a NEW line (new trim) taking a rate passes", run([zip, newTrim, freight, { source: "material", item_id: "btn", description: "BUTTON", qty: 10, rate: 1 }]), null);
  const rateMoved = run([{ ...zip, rate: 11 }, newTrim, freight]);
  if (rateMoved?.includes("DYED ZIPPER") && rateMoved.includes("stays as approved")) ok("an approved rate moving is refused, naming the line");
  else fail(`approved rate moved: ${rateMoved}`);
  if (run([zip, newTrim, { ...freight, rate: 6000 }])?.includes("Expenses")) ok("an Expense line changed is refused");
  else fail("expense change not refused");
  if (run([zip, newTrim])?.includes("removed")) ok("an Expense line removed is refused");
  else fail("expense removal not refused");
  if (run([zip, newTrim, freight, { source: "expense", cost_head_id: "ins", description: "INSURANCE", qty: 1, rate: 100 }])?.includes("added or changed")) ok("an Expense line added is refused");
  else fail("expense addition not refused");
  eq("a numeric string equals its number (the screen sends strings)", run([{ ...zip, qty: "100", rate: "12" }, newTrim, { ...freight, qty: "1", rate: "5000.00" }]), null);
}

// 3 --------------------------------------------------------------------------
{
  const s = (outcome: string, budgetStatus: string | null) => entryStatusCode(entryStatusOf({ outcome, budgetStatus }));
  eq("open + draft budget → DRAFT", s("open", "draft"), "DRAFT");
  eq("open + submitted budget → PENDING_MD_APPROVAL", s("open", "submitted"), "PENDING_MD_APPROVAL");
  eq("reapproved → APPROVED", s("reapproved", "approved"), "APPROVED");
  eq("rejected (reverted) → REJECTED", s("rejected", "approved"), "REJECTED");
  eq("open + rejected budget (not reverted) → RETURNED", s("open", "rejected"), "RETURNED");
  eq("abandoned → ABANDONED", s("abandoned", "approved"), "ABANDONED");
}

// 4 --------------------------------------------------------------------------
eq(
  "the spec's Manual Entry Needed example",
  manualEntryMessage({ source: "material", name: "Dyed Zipper", field: "rate" }),
  'Manual Entry Needed: [Material BOM] -> "Dyed Zipper" requires a Unit Purchase Rate.',
);
eq(
  "a fabric process asks for a job-work rate",
  manualEntryMessage({ source: "fabric_process", name: "COMPACTING", field: "rate" }),
  'Manual Entry Needed: [Fabric BOM] -> "COMPACTING" requires a Job-Work Rate.',
);

if (failures > 0) {
  console.error(`\n${failures} amendment-module check(s) failed.`);
  process.exit(1);
}
console.log("\nOK — every amendment module vector holds.");
