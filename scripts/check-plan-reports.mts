/**
 * check:plan-reports — the pure half of the Sample plan reports + Plan
 * Approval (2026-10-13, lib/sales/plan-reports/types.ts).
 *
 * `planChanges` is what an approver of a REVISED plan decides on: the purchase
 * lines against what was approved before the revision reopened the plan. A
 * wrong answer there either hides a raised quantity from the approver or
 * invents a change that did not happen, so it is pinned here.
 */
import { planApprovalLabel, planChanges, shadeChanges, type ApprovedLine, type ShadeLine } from "../lib/sales/plan-reports/types.ts";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${ok ? "" : `\n      got      ${JSON.stringify(actual)}\n      expected ${JSON.stringify(expected)}`}`);
}

const L = (name: string, qty: number | null, uom = "KGS", item_id: string | null = null): ApprovedLine => ({ item_id, name, purchase_qty: qty, uom });

// ── 0727: SHADES (spec v8 §8.2 "dyeing shade changes") ──────────────────────
// The case planChanges is blind to by construction: NAVY → BLACK at the same
// kilos moves no purchase quantity, so it must surface here or nowhere.
const S = (colour: string, qty: number | null, name = "SINGLE JERSEY", part = "Fabric colour"): ShadeLine => ({ part, name, colour, qty, uom: "KGS" });
check("shade: NAVY → BLACK at the same kilos moves no purchase line", planChanges([L("30'S COTTON", 100)], [L("30'S COTTON", 100)]), []);
check(
  "shade: …but is one shade dropped and one added",
  shadeChanges([S("NAVY", 50)], [S("BLACK", 50)]),
  [
    { part: "Fabric colour", name: "SINGLE JERSEY", colour: "BLACK", before: null, now: 50, uom: "KGS", kind: "added" },
    { part: "Fabric colour", name: "SINGLE JERSEY", colour: "NAVY", before: 50, now: null, uom: "KGS", kind: "removed" },
  ],
);
check("shade: an unchanged shade reports nothing (case is not a change)", shadeChanges([S("NAVY", 50)], [S(" navy ", 50)]), []);
check("shade: the same shade at a new weight is a quantity change", shadeChanges([S("RED", 25)], [S("RED", 30)]), [
  { part: "Fabric colour", name: "SINGLE JERSEY", colour: "RED", before: 25, now: 30, uom: "KGS", kind: "changed" },
]);
check("shade: the same colour on a yarn and on a fabric are two facts", shadeChanges([S("RED", 10, "30'S", "Yarn shade")], [S("RED", 10)]).length, 2);

check("an unchanged revision reports nothing", planChanges([L("30'S COTTON", 100)], [L("30'S COTTON", 100)]), []);
check(
  "a raised quantity is reported with both figures",
  planChanges([L("30'S COTTON", 100)], [L("30'S COTTON", 120)]),
  [{ name: "30'S COTTON", uom: "KGS", before: 100, now: 120, kind: "changed" }],
);
check(
  "the snapshot's ids do not stop a match on the same material name",
  planChanges([L("30'S COTTON", 100, "KGS", "item-1")], [L("30'S COTTON", 100)]),
  [],
);
check("case and spacing are not a change", planChanges([L("30'S COTTON", 100)], [L(" 30's cotton ", 100)]), []);
check(
  "a reordered plan is not a changed one",
  planChanges([L("A", 1), L("B", 2)], [L("B", 2), L("A", 1)]),
  [],
);
check(
  "an added and a removed material are each named",
  planChanges([L("A", 1)], [L("B", 2)]),
  [
    { name: "B", uom: "KGS", before: null, now: 2, kind: "added" },
    { name: "A", uom: "KGS", before: 1, now: null, kind: "removed" },
  ],
);
check(
  "two lines of one material are summed, as the purchase gate sums them",
  planChanges([L("LABEL", 100, "NOS")], [L("LABEL", 60, "NOS"), L("LABEL", 40, "NOS")]),
  [],
);
check(
  "a different unit is a different line, never added together",
  planChanges([L("LABEL", 100, "NOS")], [L("LABEL", 100, "BOX")]),
  [
    { name: "LABEL", uom: "BOX", before: null, now: 100, kind: "added" },
    { name: "LABEL", uom: "NOS", before: 100, now: null, kind: "removed" },
  ],
);
check(
  "a line that lost its quantity is a change, not silence",
  planChanges([L("A", 5)], [L("A", null)]),
  [{ name: "A", uom: "KGS", before: 5, now: null, kind: "changed" }],
);

check("labels: never submitted", planApprovalLabel("open", 0), "Not submitted");
check("labels: an open revision", planApprovalLabel("open", 2), "Revision 2 open");
check("labels: a revision with the approver", planApprovalLabel("submitted", 1), "Rev 1 with approver");
check("labels: approved after a revision", planApprovalLabel("approved", 1), "Approved · Rev 1");

if (failed) {
  console.error(`\n${failed} plan-report vector(s) failed.`);
  process.exit(1);
}
console.log("\ncheck:plan-reports — a revision's changes are what the approver is shown.");
