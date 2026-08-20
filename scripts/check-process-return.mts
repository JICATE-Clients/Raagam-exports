/**
 * Vectors for `lib/orders/material-bom/process-return.ts` — greige material sent
 * out for processing, and what came back.
 *
 * ## THE WHOLE SUITE EXISTS FOR ONE PAIR OF VECTORS
 *
 * There are two plausible readings of "did the job come back short", and on
 * almost every real row they agree:
 *
 *     A. received < sent       -> short   (the obvious one, and wrong)
 *     B. received < required   -> short   (what this module implements)
 *
 * They agree on every row where sent == required, which is most of them, so a
 * suite built from ordinary jobs would pass against either. The two vectors
 * below are built so they DISAGREE — same received quantity, opposite verdicts,
 * decided only by the wastage buffer sitting between required and sent. That is
 * the same discipline `check-bom-requirement.mts` states in its own header:
 * the client's own examples prove almost nothing because they divide evenly.
 *
 * Reading A raises a shortage on every ordinary dye job — dye loss is normal
 * and expected — which is worse than raising none, because an alarm that fires
 * on healthy rows teaches the operator to ignore the column.
 *
 * ## AND FOR ONE INVARIANT: NOTHING HERE BLOCKS
 *
 * `issuable` must equal what came back in EVERY branch, including `short`. A
 * future edit that "tightens" the rule by zeroing `issuable` on a shortfall
 * would halt a production line over a loss the wastage buffer already paid for,
 * and it would look like a stricter, safer rule while doing it. Asserted
 * directly rather than left to inspection.
 *
 * Runs under `tsx` for the reason `check-bom-requirement.mts` gives: the module
 * imports `@/lib/orders/material-bom/requirement` for its `Refusal` vocabulary,
 * and Node's ESM resolver reads neither the alias nor the missing extension.
 */
import {
  isRefusal,
  jobWorkAgeing,
  jobWorkDeadline,
  processVerdict,
  type ProcessReturn,
} from "../lib/orders/material-bom/process-return.ts";

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

/** Asserts a value is NOT something — for the wrong answers a plausible
 *  implementation produces. A vector that only states the right answer cannot
 *  say which wrong one it was guarding against. */
function refute(label: string, actual: unknown, forbidden: unknown) {
  const same = JSON.stringify(actual) === JSON.stringify(forbidden);
  if (same) {
    failed++;
    console.error(`FAIL  ${label}\n      must NOT be ${JSON.stringify(forbidden)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

function refusalOf(v: unknown): string | null {
  return isRefusal(v) ? v.refused : null;
}

const row = (over: Partial<ProcessReturn> = {}): ProcessReturn => ({
  qty_out: null,
  qty_in: null,
  sent_on: null,
  ...over,
});

// ---------------------------------------------------------------------------
// THE PAIR. Same 960 back, opposite verdicts.
// ---------------------------------------------------------------------------

const covered = processVerdict(row({ qty_out: 1000, qty_in: 960 }), 940);
check("960 back against a requirement of 940 is COVERED — the wastage absorbed the dye loss", covered, {
  state: "covered",
  issuable: 960,
  atVendor: 40,
});

const short = processVerdict(row({ qty_out: 1000, qty_in: 960 }), 990);
check("960 back against a requirement of 990 is SHORT by 30", short, {
  state: "short",
  issuable: 960,
  atVendor: 40,
  shortfall: 30,
});

// The disagreement stated as an assertion rather than left to the reader: a
// `received < sent` implementation calls the first one short too.
refute(
  "the covered case is NOT reported short — that is reading A, and it fires on every healthy job",
  (covered as { state: string }).state,
  "short",
);
check(
  "both cases leave the same 40 at the vendor — `atVendor` is sent-minus-back and never the shortfall",
  [(covered as { atVendor: number }).atVendor, (short as { atVendor: number }).atVendor],
  [40, 40],
);
refute(
  "the shortfall is measured against the REQUIREMENT, not against what was sent",
  (short as { shortfall: number }).shortfall,
  40, // 1000 - 960, the answer reading A gives
);

// ---------------------------------------------------------------------------
// Nothing blocks
// ---------------------------------------------------------------------------

check(
  "a short job still issues everything that came back",
  (short as { issuable: number }).issuable,
  960,
);
refute("a short job does NOT withhold the received material", (short as { issuable: number }).issuable, 0);
check(
  "a job with nothing back yet issues nothing, but is not a refusal",
  processVerdict(row({ qty_out: 1000, qty_in: null }), 990),
  { state: "short", issuable: 0, atVendor: 1000, shortfall: 990 },
);

// ---------------------------------------------------------------------------
// `planned` is a state, not a refusal
// ---------------------------------------------------------------------------

check("a row with nothing sent is planned", processVerdict(row(), 990), { state: "planned" });
check(
  "planned is answered BEFORE the requirement is demanded — a grid being filled in must not go red",
  processVerdict(row(), null),
  { state: "planned" },
);
check(
  "qty_out of 0 is not a dispatch",
  processVerdict(row({ qty_out: 0 }), 990),
  { state: "planned" },
);

// ---------------------------------------------------------------------------
// Refusals. Every one carries the sentence the screen prints.
// ---------------------------------------------------------------------------

check(
  "material back that was never sent is refused",
  refusalOf(processVerdict(row({ qty_out: null, qty_in: 50 }), 990)),
  "Material has come back that was never recorded as sent",
);
check(
  "more back than went out is refused, not treated as a credit",
  refusalOf(processVerdict(row({ qty_out: 1000, qty_in: 1200 }), 990)),
  "More has come back than went out — check the quantities",
);
check(
  "a dispatch with no stored requirement is refused and says where to go",
  refusalOf(processVerdict(row({ qty_out: 1000, qty_in: 960 }), null)),
  "No stored requirement for this material yet — open the Requirement tab",
);
check(
  "a negative sent quantity is refused",
  refusalOf(processVerdict(row({ qty_out: -5 }), 990)),
  "Sent quantity cannot be negative",
);

// A requirement of exactly 0 is a real answer and must not be read as absent —
// the `NULL IS AN ANSWER, 0 IS NOT` rule cuts the other way here.
check(
  "a requirement of 0 is covered, never refused as missing",
  processVerdict(row({ qty_out: 100, qty_in: 100 }), 0),
  { state: "covered", issuable: 100, atVendor: 0 },
);

// ---------------------------------------------------------------------------
// The one-year clock (CGST s.143 — inputs must return within a year)
// ---------------------------------------------------------------------------

check("one year from dispatch", jobWorkDeadline("2026-03-14"), "2027-03-14");
check(
  "a leap day rolls to 1 March rather than shifting by a day",
  jobWorkDeadline("2024-02-29"),
  "2025-03-01",
);
refute(
  "the deadline is NOT 365 days added blindly across a leap year",
  jobWorkDeadline("2023-06-01"),
  "2024-05-31",
);
check("a malformed date is unageable, never overdue", jobWorkDeadline("not-a-date"), null);

check(
  "a job 30 days from its deadline is due when the warning window is 60",
  jobWorkAgeing("2025-09-19", 40, "2026-08-20", 60),
  { state: "due", dueOn: "2026-09-19", daysLeft: 30 },
);
check(
  "the same job is merely ok when the window is 14",
  jobWorkAgeing("2025-09-19", 40, "2026-08-20", 14),
  { state: "ok", dueOn: "2026-09-19", daysLeft: 30 },
);
check(
  "past the year it is overdue, and says by how much",
  jobWorkAgeing("2025-01-10", 40, "2026-08-19", 60),
  { state: "overdue", dueOn: "2026-01-10", daysOver: 221 },
);
check(
  "material fully back is unageable however old — s.143 is satisfied",
  jobWorkAgeing("2020-01-01", 0, "2026-08-19", 60),
  { state: "unageable" },
);
check(
  "a row with no dispatch date is unageable, never overdue",
  jobWorkAgeing(null, 40, "2026-08-19", 60),
  { state: "unageable" },
);

// ---------------------------------------------------------------------------

console.log(failed === 0 ? "\nAll process-return vectors pass." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
