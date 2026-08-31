// Guards the `lookup-compat` FK-mismatch class.
//
//     node --experimental-strip-types scripts/check-lookup-compat.mts
//
// WHY THIS FILE EXISTS. `lib/masters/lookup-compat.ts` reshapes rows of a
// DEDICATED master into `ConfigLookup` shape so existing pickers keep compiling.
// A field fed that way reads ids from the master, while `LookupDialogPicker`
// WRITES `config_lookups` for every kind. So a shim is only safe where the
// column being filled actually references the dedicated table.
//
// Three of the shims have no such column anywhere in the schema — every
// `department_id`, `designation_id` and employee `category_id` is
// `references public.config_lookups(id)` (0124 · 0126 · 0238 · 0239 · 0240 ·
// 0243 · 0245 · 0252 · 0267). They fed Applicant, Customer, Notify and Consignee
// until 2026-08-31 and rejected every save on a picked designation or
// department.
//
// IT SURVIVED A MONTH BECAUSE THE FAILURE IS ASYMMETRIC. `LookupDialogPicker`'s
// inline "+ Add" creates a `config_lookups` row and returns THAT id, which is
// valid — so an operator who adds a designation succeeds, and only one who picks
// a pre-existing option fails. Nothing in the UI distinguishes the two, and no
// type check can see it: both sides are `ConfigLookup[]`.
//
// So the invariant is stated here instead: those three shims have no callers.
// The day a column is repointed at its dedicated master, delete its name from
// UNSAFE below — that removal is the record of the decision.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Shims whose target column still references `config_lookups` everywhere. */
const UNSAFE = [
  "departmentsAsLookups",
  "designationsAsLookups",
  "employeeCategoriesAsLookups",
];

/** Where the shims are declared — its own file may name them. */
const DECLARING_FILE = "lib/masters/lookup-compat.ts";

/**
 * A CALL, not a mention. `departmentsAsLookups(` with the paren, so a comment
 * recording the historical bug — which several files deliberately keep — is not
 * mistaken for a live caller. Comments are stripped first regardless, because
 * `page.tsx` documents the removed branch in prose that includes the call form.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export function unsafeCallsIn(src: string): string[] {
  const code = stripComments(src);
  return UNSAFE.filter((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(code));
}

// ---------------------------------------------------------------------------
// Vectors — the predicate itself, so a green sweep below means something.
// ---------------------------------------------------------------------------

let failed = 0;
function vec(label: string, src: string, want: string[]) {
  const got = unsafeCallsIn(src);
  const ok = got.length === want.length && want.every((w) => got.includes(w));
  if (ok) console.log(`ok    ${label}`);
  else {
    failed++;
    console.error(`FAIL  ${label} — got [${got}], want [${want}]`);
  }
}

vec("a live call is caught",
  `designations={designationsAsLookups(desigRows)}`, ["designationsAsLookups"]);
vec("the corrected form is clean",
  `designations={all.filter((l) => l.kind === "designation")}`, []);
vec("a block comment describing the old bug is NOT a caller",
  `/* it passed designations={designationsAsLookups(desigRows)} and broke */`, []);
vec("a line comment is NOT a caller",
  `// designations={designationsAsLookups(desigRows)}`, []);
vec("a safe shim is not flagged",
  `states={statesAsLookups(stateRows)}`, []);
vec("two live calls are both caught",
  `a={departmentsAsLookups(d)} b={designationsAsLookups(x)}`,
  ["departmentsAsLookups", "designationsAsLookups"]);

// ---------------------------------------------------------------------------
// The sweep.
// ---------------------------------------------------------------------------

const ROOTS = ["app", "lib", "components"];
const SKIP = new Set(["node_modules", ".next", ".git"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

let offenders = 0;
let scanned = 0;
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const rel = file.replace(/\\/g, "/");
    if (rel.endsWith(DECLARING_FILE)) continue;
    scanned++;
    const hits = unsafeCallsIn(readFileSync(file, "utf8"));
    if (hits.length) {
      offenders++;
      console.error(
        `FAIL  ${rel} calls ${hits.join(", ")} — that column references ` +
          `config_lookups, so picking an existing value will be rejected. ` +
          `Feed it \`all.filter((l) => l.kind === "…")\` instead.`,
      );
    }
  }
}
console.log(`ok    swept ${scanned} files, ${offenders} unsafe caller(s)`);

const bad = failed + offenders;
console.log(bad ? `\n${bad} check(s) FAILED` : "\nall lookup-compat vectors pass");
process.exit(bad ? 1 : 0);
