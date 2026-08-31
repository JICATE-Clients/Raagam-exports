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

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  pickerIdentityParts,
  redundantBeside,
  type PickerIdentity,
} from "../lib/masters/picker-identity.ts";

/** Every .ts/.tsx under the app's own source roots. */
function walkSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      if (e === "node_modules" || e === ".next" || e === ".claude" || e === ".git") continue;
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".tsx") || full.endsWith(".ts")) out.push(full);
    }
  };
  for (const root of ["app", "components", "lib"]) walk(root);
  return out;
}

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
// identity="name" — the ~50 defaults. THE NAME AND NOTHING ELSE IS DISPLAYED
// (client 2026-08-31, screenshot 2571, third report of the same thing:
// "no need to add that sub-name behind the value ... fix it globally").
// The code moves to `search`: still typeable, never printed.
// ---------------------------------------------------------------------------

// The commonest shape: vendors, customers, items, UOMs, activities.
check("Vendor reads its name, code hidden but searchable",
  "VKS", "Kandagiri Spinning", "name", "Kandagiri Spinning", null, "VKS");

// THE REPORTED BUG, as a vector. `EMP-MERCH-01` is hand-typed and unrelated to
// the name, so every duplication guard correctly let it through — which is why
// the rule, not the guard, had to change.
check("Merchandiser does not print the employee code",
  "EMP-MERCH-01", "SAMPLE MERCHANDISER", "name", "SAMPLE MERCHANDISER", null, "EMP-MERCH-01");

// The codes the old objection was about. Each is real information an operator
// types — and each is still findable, which is what makes hiding them safe.
check("an HSN is hidden but still searchable",
  "6109", "T-SHIRTS", "name", "T-SHIRTS", null, "6109");
check("an account head code is hidden but still searchable",
  "AH001", "AH Sundry Debtors", "name", "AH Sundry Debtors", null, "AH001");

// Material, the 2026-08-28 report that used to need `identity="name-only"`.
// The default now does it, which is why that opt-in was removed.
check("Material needs no opt-in to hide its auto-code",
  "BUTTONPLAS", "BUTTON PLASTIC", "name", "BUTTON PLASTIC", null, "BUTTONPLAS");

// A code-led row is UNAFFECTED, and this is the distinction the whole change
// rests on: every complaint has been a CODE printed after a NAME. A NAME after
// a code was never reported — it was requested (2026-08-10).
check("code-led rows still show the name beside the number",
  "SO/26-27/0401", "ABASIC", "code", "SO/26-27/0401", "ABASIC", null);

// ---------------------------------------------------------------------------
// The redundancy guard. It no longer decides anything for a NAME-led row (those
// print no second value at all now), but it is still what stops a CODE-led row
// printing the same text twice — TA Plan passes order_number as both halves.
// These vectors stay because `redundantBeside` is still live on that branch and
// is exercised directly below.
// ---------------------------------------------------------------------------

// material-hsn-assign-screen.tsx:25 pre-composes `${code} — ${name}` into name
// to work around the dropped code. Without the containment guard this reads
// "6109 — T-SHIRTS   6109".
check("HSN does not repeat a pre-composed code",
  "6109", "6109 — T-SHIRTS", "name", "6109 — T-SHIRTS", null, "6109");

// default-account-head-screen.tsx:135 does the same with short_name.
check("Account Head does not repeat its short name",
  "SAL", "SAL — Salaries", "name", "SAL — Salaries", null, "SAL");

// customer-master-screen.tsx:1549 passes `name: name ?? short_name`, so on the
// fallback the two halves are identical.
check("Port on its short-name fallback shows one value",
  "TUT", "TUT", "name", "TUT", null, "TUT");

// ta-plan-screen.tsx:313 passes order_number as BOTH code and name.
check("TA Plan SC No, where code and name are one value",
  "SO-0003", "SO-0003", "name", "SO-0003", null, "SO-0003");

// Case-insensitively identical still counts as redundant.
check("case difference is still redundant",
  "tut", "TUT", "name", "TUT", null, "tut");

// Services that hardcode `code: null` (Contact, Process).
check("a null code adds no sublabel and no search text",
  null, "R. Kumar", "name", "R. Kumar", null, null);

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


// ---------------------------------------------------------------------------
// SOURCE SCAN - a picker may not hand-roll a CODE into a displayed sublabel.
//
// THE VECTORS ABOVE WOULD NOT HAVE CAUGHT THE REPORTED BUG ON THEIR OWN, and
// that is why this exists. `employee-picker.tsx` built its own rows and never
// called `pickerIdentityParts`, so the Merchandiser field printed
// `SAMPLE MERCHANDISER   EMP-MERCH-01` no matter what the shared rule said.
// Fixing the rule alone would have left it broken with every vector green - the
// "the check passing means nothing on its own" shape AGENTS.md records for the
// created_by sweep.
//
// A DESCRIPTIVE sublabel is fine and deliberately NOT flagged: bank_type,
// account_type, category, short_description are other FACTS about the record,
// not the record's own name repeated. Every complaint so far has been a code.
// ---------------------------------------------------------------------------
const SUB = "sublabel:";
const NEWLINE = String.fromCharCode(10);

// The two files that OWN the rule and legitimately assign a sublabel:
// picker-identity.ts decides it for a code-led row, record-picker.ts restores it
// on colliding rows. Skipping them is not an exemption, it is not scanning the
// implementation for uses of itself.
const OWNERS = ["picker-identity.ts", "record-picker.tsx"];

/** Is this line ASSIGNING a value to a displayed sublabel? */
function displaysASecondValue(line: string): boolean {
  const at = line.indexOf(SUB);
  if (at < 0) return false;
  // A type declaration is `sublabel?:` and never matches the string above.
  const value = line.slice(at + SUB.length).trim();
  // `sublabel: null` is the rule doing its job, not a violation.
  return value.length > 0 && !value.startsWith("null");
}

/**
 * Does an exemption marker sit on this line, or anywhere in the comment block
 * directly above it?
 *
 * Reaching BACKWARDS over the whole block rather than checking one line is the
 * same shape `nav-path: exempt` uses, and for the same reason: the reason a line
 * is exempt rarely fits beside it, so forcing it there produces either a
 * truncated reason or no exemption at all.
 */
function exempted(lines: string[], at: number): boolean {
  if (lines[at].includes("picker-code: exempt")) return true;
  for (let j = at - 1; j >= 0; j--) {
    const t = lines[j].trim();
    if (t === "") continue;
    if (!(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"))) return false;
    if (t.includes("picker-code: exempt")) return true;
  }
  return false;
}

for (const file of walkSources()) {
  if (OWNERS.some((o) => file.endsWith(o))) continue;
  const lines = readFileSync(file, "utf8").split(NEWLINE);
  lines
    .forEach((line, i) => {
      const t = line.trim();
      // Prose, not code. Several files describe this pattern while doing the
      // right thing, and flagging a comment trains people to ignore the check
      // (same reason check-nav-paths strips them).
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
      if (!displaysASecondValue(line)) return;
      if (exempted(lines, i)) return;
      failed++;
      console.error("FAIL  " + file + ":" + (i + 1) + " displays a second value beside the name");
      console.error("      " + t);
      console.error("      A picker shows the NAME and nothing else (client 2026-08-31,");
      console.error("      screenshot 2571, third report: 'no need to add that sub-name");
      console.error("      behind the value ... fix it globally'). Codes, types, categories");
      console.error("      and short descriptions all go in `search`: hidden, still typeable.");
      console.error("      A CODE-LED row is the one exception - label IS the code, so the");
      console.error("      name beside it is wanted. Mark it `picker-code: exempt -- <reason>`.");
    });
}

console.log(
  failed ? `\n${failed} check(s) FAILED` : "\nall picker-identity vectors pass",
);
process.exit(failed ? 1 : 0);
