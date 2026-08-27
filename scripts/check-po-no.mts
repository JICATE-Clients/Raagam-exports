// Verification for the row-vs-header PO number rule (`lib/orders/po-no.ts`).
//
// The repo has no test framework, so this runs standalone:
//     node --experimental-strip-types scripts/check-po-no.mts
//
// Listed in tsconfig `exclude` for the same reason as check-module-groups.mts:
// node's type stripping needs the `.ts` extension on the import and the app's
// tsconfig forbids it. `po-no.ts` imports NOTHING, which is what makes it
// runnable here — keep it that way.
//
// ## What is actually at stake
//
// A buyer issues one master order covering several destinations, and invoices
// each shipped lot against ITS OWN PO number. Their customs agent matches PO to
// delivery on the paperwork; a mismatch is a hold at the port. `multi_order`
// (0427) is the toggle that lets a Quantities row carry its own PO.
//
// The rule has exactly one interesting property and every vector here exists to
// pin it: **blank on the row is the NORMAL case, not the error case.** A buyer
// typically sub-POs two destinations of five and leaves the rest on the master
// contract PO, so a row with no PO of its own inherits the header's. Only a row
// with nothing on either level is unanswered.
//
// Verified by being made to FAIL first, per the house rule: swapping the
// coalesce to header-first fails vector 3 (a row's own PO must win), and
// dropping the `.trim()` fails the whitespace vectors — a cell holding one space
// is empty, and a stored " " would otherwise print as a PO number.
import {
  requireRowPoNo,
  resolveRowPoNo,
  rowHasOwnPoNo,
} from "../lib/orders/po-no.ts";

let failures = 0;
let checks = 0;

function ok(label: string, actual: unknown, expected: unknown) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`  FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
  }
}

console.log("resolveRowPoNo — the fallback");
ok("a row with no PO inherits the order's", resolveRowPoNo(null, "PO-1000"), "PO-1000");
ok("an empty string inherits too", resolveRowPoNo("", "PO-1000"), "PO-1000");
ok("a row's OWN PO wins over the header", resolveRowPoNo("4471-B", "PO-1000"), "4471-B");
ok("no PO anywhere is null, not empty string", resolveRowPoNo(null, null), null);
ok("undefined is handled like null", resolveRowPoNo(undefined, undefined), null);
ok("a row PO with no header still answers", resolveRowPoNo("4471-B", null), "4471-B");

console.log("Whitespace is not a PO number");
// A cell the operator tabbed through holds "", and one they typed a space into
// holds " ". Both mean the same thing to a customs agent: nothing.
ok("a space-only row cell falls back", resolveRowPoNo("   ", "PO-1000"), "PO-1000");
ok("a space-only header is not a PO either", resolveRowPoNo(null, "  "), null);
ok("both blank is null", resolveRowPoNo("  ", "\t"), null);
ok("surrounding space is trimmed off a real one", resolveRowPoNo("  4471-B  ", null), "4471-B");

console.log("rowHasOwnPoNo — which level answered");
ok("a row with its own", rowHasOwnPoNo("4471-B"), true);
ok("a blank row", rowHasOwnPoNo(""), false);
ok("a space-only row", rowHasOwnPoNo(" "), false);
ok("a null row", rowHasOwnPoNo(null), false);

console.log("requireRowPoNo — for a document that bills");
ok("the row's own, flagged as the row's", requireRowPoNo("4471-B", "PO-1000", "FRANCE"), {
  ok: true,
  poNo: "4471-B",
  fromRow: true,
});
ok("the header's, flagged as inherited", requireRowPoNo(null, "PO-1000", "UK"), {
  ok: true,
  poNo: "PO-1000",
  fromRow: false,
});
// The ONLY blocking case. Everything else must compile.
const refused = requireRowPoNo(null, null, "CANADA");
ok("neither level: refused, not thrown", refused.ok, false);
ok(
  "and the refusal NAMES the row, or it is not actionable on a twelve-row sheet",
  refused.ok === false && refused.reason.includes("CANADA"),
  true,
);
ok(
  "and says where to fix it",
  refused.ok === false && refused.reason.includes("Quantities row"),
  true,
);
// A blank header must not rescue a blank row just by existing.
ok("a whitespace header does not satisfy the requirement", requireRowPoNo("", "   ", "SPAIN").ok, false);

console.log(`\ncheck-po-no: ${checks} vectors, ${failures} failed.`);
if (failures) process.exit(1);
console.log("check-po-no: OK");
