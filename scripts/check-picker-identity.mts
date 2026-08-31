// Verification vectors for lib/masters/picker-identity.ts.
//
// The repo has no test framework, so this runs standalone:
//     node --experimental-strip-types scripts/check-picker-identity.mts
//
// WHY THIS FILE EXISTS. `RecordPicker` accepted a `code` on every one of its
// ~60 call sites and rendered `label: i.name`, discarding it. For a Vendor that
// is correct — the name IS the identity, and codes are backend-only
// (client 2026-07-23). For an SC No it was fatal: the code is the identity and
// the "name" is the customer, so the Garment Order Amendment screen's `SCNo`
// field listed five rows all reading `Aurelia Retail` and three all reading
// `ABASIC`, with no way to tell which order was which (client 2026-08-10).
//
// The fix splits on `identity`, which means one rule now has to be right in two
// directions at once and must not double up where a call site ALREADY composed
// the code into the name. The vectors below are the call-site shapes that
// actually exist in this repo, named after the screens they come from — not
// invented cases.
//
// Exits non-zero on the first mismatch so it can gate a commit if wanted.

import {
  pickerIdentityParts,
  redundantBeside,
  type PickerIdentity,
} from "../lib/masters/picker-identity.ts";

let failed = 0;

function check(
  label: string,
  code: string | null,
  name: string | null,
  identity: PickerIdentity,
  wantLabel: string,
  wantSub: string | null,
) {
  const got = pickerIdentityParts(code, name, identity);
  const ok = got.label === wantLabel && got.sublabel === wantSub;
  if (!ok) {
    failed++;
    console.error(
      `FAIL  ${label}\n      got  ${JSON.stringify(got.label)} / ${JSON.stringify(got.sublabel)}` +
        `\n      want ${JSON.stringify(wantLabel)} / ${JSON.stringify(wantSub)}`,
    );
  } else {
    console.log(`ok    ${label}`);
  }
}

// ---------------------------------------------------------------------------
// identity="code" — the nine fields whose NUMBER names the record.
// ---------------------------------------------------------------------------

// amendment-screen.tsx:1374 — the reported bug. code=order_number, name=buyer.
check("SCNo shows the number, buyer beside it",
  "SO/26-27/0401", "ABASIC", "code", "SO/26-27/0401", "ABASIC");

// The same field once 0395's format is in play.
check("SCNo carries the new SC No format",
  "HO/RE/26-27/0001", "ABASIC", "code", "HO/RE/26-27/0001", "ABASIC");

// sales/quotes/prepare-quote-client.tsx:315 — name is a composed sentence.
check("Enquiry No keeps its composed subtitle",
  "ENQ-14", "ABASIC · SS26 · Polo", "code", "ENQ-14", "ABASIC · SS26 · Polo");

// A row whose code is missing must NOT render a blank field.
check("a codeless row falls back to the name",
  null, "ABASIC", "code", "ABASIC", null);
check("a blank-string code falls back too",
  "   ", "ABASIC", "code", "ABASIC", null);

// ---------------------------------------------------------------------------
// identity="name" — the ~50 defaults. The closed field must still read the NAME
// (codes are backend-only), with the code searchable beside it in the list.
// ---------------------------------------------------------------------------

// The commonest shape: vendors, customers, items, UOMs, activities.
check("Vendor reads its name, code rides along",
  "VKS", "Kandagiri Spinning", "name", "Kandagiri Spinning", "VKS");

// ---------------------------------------------------------------------------
// The redundancy guard. Each of these is a real call site that would otherwise
// print the same text twice.
// ---------------------------------------------------------------------------

// material-hsn-assign-screen.tsx:25 pre-composes `${code} — ${name}` into name
// to work around the dropped code. Without the containment guard this reads
// "6109 — T-SHIRTS   6109".
check("HSN does not repeat a pre-composed code",
  "6109", "6109 — T-SHIRTS", "name", "6109 — T-SHIRTS", null);

// default-account-head-screen.tsx:135 does the same with short_name.
check("Account Head does not repeat its short name",
  "SAL", "SAL — Salaries", "name", "SAL — Salaries", null);

// customer-master-screen.tsx:1549 passes `name: name ?? short_name`, so on the
// fallback the two halves are identical.
check("Port on its short-name fallback shows one value",
  "TUT", "TUT", "name", "TUT", null);

// ta-plan-screen.tsx:313 passes order_number as BOTH code and name.
check("TA Plan SC No, where code and name are one value",
  "SO-0003", "SO-0003", "name", "SO-0003", null);

// Case-insensitively identical still counts as redundant.
check("case difference is still redundant",
  "tut", "TUT", "name", "TUT", null);

// Services that hardcode `code: null` (Contact, Process).
check("a null code adds no sublabel",
  null, "R. Kumar", "name", "R. Kumar", null);

// ---------------------------------------------------------------------------
// The guard itself, directly.
// ---------------------------------------------------------------------------

const guards: [string, string, string, boolean][] = [
  ["empty is always redundant",        "",     "ANYTHING",         true],
  ["identical is redundant",           "ABC",  "ABC",              true],
  ["contained is redundant",           "ABC",  "ABC — Something",  true],
  ["contained mid-string is redundant","ABC",  "X ABC Y",          true],
  ["unrelated is NOT redundant",       "VKS",  "Kandagiri",        false],
  ["partial overlap is NOT redundant", "ABCD", "ABC — Something",  false],

  /*
   * AN AUTO-GENERATED CODE IS THE NAME AGAIN, SQUASHED (client 2026-08-31,
   * screenshot 2558: "customer value showing two times ... no need that second
   * time customer name").
   *
   * `generateUniqueCode` (lib/masters/auto-code.ts) builds the code FROM the
   * name: uppercase, strip everything non-alphanumeric, truncate to 10, then a
   * collision integer. So the code is not a second fact about the record, it is
   * the first one with the spaces taken out — and the containment guard above
   * cannot see it, because removing the spaces is exactly what stops
   * `"AARSAN AMERICAS LLC".includes("AARSANAMER")` being true.
   */
  ["a squashed auto-code is redundant",   "AARSANAMER", "AARSAN AMERICAS LLC", true],
  ["a collision suffix is redundant",     "ASMARA3",    "ASMARA",              true],
  ["punctuation-stripped is redundant",   "TAPEALOEIL", "TAPE A 'L' OEIL",     true],

  /*
   * ...and the other side of it. A code that is NOT derived from the name is
   * real information and must survive — an HSN, an account head, a ledger code.
   * The length rule is what separates them: an auto-code is either the whole
   * squashed name or a 10-character truncation of it, never a two-letter prefix.
   */
  ["an HSN code is NOT redundant",        "6109",       "T-SHIRTS",            false],
  ["a short prefix is NOT redundant",     "AH001",      "AH Sundry Debtors",   false],
  ["a numeric code is NOT redundant",     "4021",       "4021 Freight",        true],
];
for (const [label, other, primary, want] of guards) {
  const got = redundantBeside(other, primary);
  if (got !== want) {
    failed++;
    console.error(`FAIL  guard: ${label} — got ${got}, want ${want}`);
  } else {
    console.log(`ok    guard: ${label}`);
  }
}

console.log(
  failed ? `\n${failed} check(s) FAILED` : "\nall picker-identity vectors pass",
);
process.exit(failed ? 1 : 0);
