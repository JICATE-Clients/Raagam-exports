// Verification for the Garment Rejection Rule engine — the tier arithmetic
// (`rejectionFor`) and the range kind/caption derived from a tier's bounds.
//
// The repo has no test framework, so this runs standalone:
//     node --experimental-strip-types scripts/check-rejection-ladder.mts
//
// Listed in tsconfig `exclude` for the same reason as check-module-groups.mts:
// node's type stripping needs the `.ts` extension on the import and the app's
// tsconfig forbids it. `rejection-rule.ts` imports NOTHING, which is what makes
// it runnable here at all — keep it that way.
//
// ## The vectors that matter, and why each is here
//
// The client demonstrated their rule on the legacy screen (2026-08-25, screen
// 2493) as five brackets. Those five rows are the spine of this file, because
// three separate things about them are only visible when they are evaluated:
//
//   1. THE SMALL-ORDER CASE, which is the whole reason the rule exists. An
//      order of 10 must produce +3 pieces. Under the code as it stood before
//      2026-08-26 the flat tier could not be ENTERED — the screen hard-coded
//      every tier to "percent" — so 10 produced ceil(0.3) = 1, and a 3% tier on
//      a 10-piece size run is the `0.3 → 0` failure the client opened their
//      recording by describing.
//
//   2. THE BOUNDARIES. Both ends are inclusive, so 10/11, 50/51, 500/501 and
//      1000/1001 are four places an off-by-one is invisible by eye and fatal in
//      the cutting room.
//
//   3. THE BACKWARD STEP. Their own table dips twice: 500 → 525 but 501 → 517,
//      and 1000 → 1030 but 1001 → 1022. Nothing reports that on screen any more
//      (the checker and its strip were removed at the client's word), so the
//      arithmetic is pinned here instead — otherwise the prose in
//      `rejection-rule.ts` describing it becomes a claim nobody can check.
//
// Verified by being made to FAIL first, per the house rule: hard-coding
// `allowance_type` back to "percent" fails the small-order vectors that open
// this file, which is the exact defect the screen shipped with for months.
import {
  rangeKindOf,
  rangeLabelOf,
  rejectionFor,
  type RejectionTier,
} from "../lib/masters/rejection-rule.ts";

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

const tier = (
  from: number | null,
  to: number | null,
  type: "flat" | "percent",
  allowance: number,
): RejectionTier => ({
  from_value: from,
  to_value: to,
  allowance_type: type,
  rejection_allowance: allowance,
});

// ---------------------------------------------------------------------------
// The client's five brackets, exactly as entered on the legacy screen
// ---------------------------------------------------------------------------
const CLIENT: RejectionTier[] = [
  tier(null, 10, "flat", 3),
  tier(11, 50, "flat", 2),
  tier(51, 500, "percent", 5),
  tier(501, 1000, "percent", 3),
  tier(1001, null, "percent", 2),
];

const cut = (q: number, tiers: RejectionTier[]) => rejectionFor(q, tiers)?.sdQty ?? null;
const rej = (q: number, tiers: RejectionTier[]) => rejectionFor(q, tiers)?.rejectionQty ?? null;

console.log("Client's five brackets — the case that started this");
// 1 — the failure the whole rule exists to prevent. A 3% tier would give 1.
ok("10 pieces gets the flat 3, not a percentage", rej(10, CLIENT), 3);
ok("10 pieces cuts 13", cut(10, CLIENT), 13);
// 2 — a size run of 2, from the earlier brief. Percent would give 1.
ok("2 pieces still gets the full flat 3", rej(2, CLIENT), 3);

console.log("Boundaries — both ends inclusive");
ok("10 is in the first tier", rej(10, CLIENT), 3);
ok("11 crosses to the second", rej(11, CLIENT), 2);
ok("50 is still the second", rej(50, CLIENT), 2);
ok("51 crosses to 5%", rej(51, CLIENT), 3); // ceil(2.55)
ok("500 is still 5%", rej(500, CLIENT), 25);
ok("501 crosses to 3%", rej(501, CLIENT), 16); // ceil(15.03)
ok("1000 is still 3%", rej(1000, CLIENT), 30);
ok("1001 crosses to the unbounded 2%", rej(1001, CLIENT), 21); // ceil(20.02)
ok("the top tier really is unbounded", rej(5568, CLIENT), 112); // ceil(111.36)

console.log("Rounding — up, always");
ok("55 + 8% is 60, never 59", rejectionFor(55, [tier(1, null, "percent", 8)])?.sdQty, 60);
ok("a fraction of a piece still costs a piece", rej(10, [tier(1, null, "percent", 3)]), 1);
ok("zero order quantity is unanswerable, not zero", rejectionFor(0, CLIENT), null);
ok("a negative quantity is unanswerable", rejectionFor(-5, CLIENT), null);

console.log("A gap returns null, never 0");
const HOLED: RejectionTier[] = [tier(null, 10, "flat", 3), tier(51, null, "percent", 5)];
ok("11 falls in the hole", rejectionFor(11, HOLED), null);
ok("a blank row swallows nothing", rejectionFor(11, [tier(null, null, "percent", 5)]), null);

// ---------------------------------------------------------------------------
// Range kind + label, derived from the bounds
// ---------------------------------------------------------------------------
console.log("Range kind is derived, never stored");
ok("no lower bound is 'up to'", rangeKindOf({ from_value: null, to_value: 10 }), "upto");
ok("no upper bound is 'above'", rangeKindOf({ from_value: 1001, to_value: null }), "above");
ok("both bounds is 'between'", rangeKindOf({ from_value: 11, to_value: 50 }), "between");
ok("a blank row reads as 'between'", rangeKindOf({ from_value: null, to_value: null }), "between");
ok("the caption follows", rangeLabelOf({ from_value: null, to_value: 10 }), "UP TO 10");
ok("and groups its digits", rangeLabelOf({ from_value: 1001, to_value: null }), "1,001 AND ABOVE");
ok("and reads as a span", rangeLabelOf({ from_value: 51, to_value: 500 }), "51 TO 500");
ok("a blank row has no caption to compose", rangeLabelOf({ from_value: null, to_value: null }), "");

// ---------------------------------------------------------------------------
// THE BACKWARD STEP — arithmetic only, now that nothing reports it
//
// `ladderIssues()` was built on 2026-08-26 and removed the same day, when the
// client removed its strip from the screen. The DEFECT it found is a property
// of the rule, not of the checker, and `rejection-rule.ts` now states it in
// prose — so these vectors keep that prose from rotting into a claim nobody can
// check. Their five brackets dip twice: one more garment ordered, eight fewer
// cut.
// ---------------------------------------------------------------------------
console.log("The backward step in the client's own table");
ok("500 cuts 525", cut(500, CLIENT), 525);
ok("501 cuts 517 — EIGHT FEWER than 500", cut(501, CLIENT), 517);
ok("1,000 cuts 1,030", cut(1000, CLIENT), 1030);
ok("1,001 cuts 1,022 — eight fewer again", cut(1001, CLIENT), 1022);

// The rates the prose names as the repair. Bottom-up, and that ordering is the
// point: raising 501–1,000 also lifts what 1,000 produces, so the top tier's
// figure is derived from the NEW 1,048 rather than the old 1,030.
const FIXED: RejectionTier[] = [
  tier(null, 10, "flat", 3),
  tier(11, 50, "flat", 2),
  tier(51, 500, "percent", 5),
  tier(501, 1000, "percent", 4.8),
  tier(1001, null, "percent", 4.7),
];
ok("at 4.8% the step at 501 is gone", cut(501, FIXED)! >= cut(500, FIXED)!, true);
ok("at 4.7% the step at 1,001 is gone too", cut(1001, FIXED)! >= cut(1000, FIXED)!, true);
ok("and the small end did not move — 10 still cuts 13", cut(10, FIXED), 13);


console.log(
  `\ncheck-rejection-ladder: ${checks} vectors, ${failures} failed.`,
);
if (failures) process.exit(1);
console.log("check-rejection-ladder: OK");
