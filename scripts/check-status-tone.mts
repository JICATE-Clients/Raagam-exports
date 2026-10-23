/**
 * check:status-tone — the shared status → tone table (lib/ui/status-tone.ts)
 * answers correctly, and nothing outside it maps a status word by hand again.
 *
 * Two halves:
 *
 *   1. VECTORS. The table, the exact-match rule ("Not Approved" is never
 *      green), the prototype guard, the override order, and every module's
 *      documented exception — asserted through the module's OWN exported
 *      function, so a module that stops delegating fails here.
 *
 *   2. SCAN. A `case "approved": return "success"` or a `{ approved: "success" }`
 *      literal in app/, components/ or lib/ is a second copy of the table, and
 *      the 32 copies that existed on 2026-10-16 are why this file exists. A
 *      known status word may carry a literal tone only inside an object that
 *      the same file passes to `statusTone(…, NAME)` — a documented override —
 *      or in a file listed in EXEMPT with its reason.
 *
 * Verified by being made to FAIL first: a planted `{ approved: "info" }` map
 * and a `case "draft": return "warning"` switch each fail the scan, and
 * flipping `not_approved` to success fails the vectors.
 *
 * Run: npx tsx scripts/check-status-tone.mts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  STATUS_TONES,
  TASK_PROGRESS,
  activeTone,
  draftTone,
  isKnownStatus,
  normalizeStatus,
  statusTone,
} from "../lib/ui/status-tone.ts";
import { chequeStatusTone } from "../lib/finance/cheques/types.ts";
import { epcgStatusTone } from "../lib/logistics/epcg/types.ts";
import { entryStatusTone } from "../lib/orders/amendments/amendment-entry.ts";
import { cadStatusTone, cadQueueStatusTone } from "../lib/orders/cad/types.ts";
import { qcStatusTone } from "../lib/sales/quote-costings/types.ts";
import { budgetStatusTone } from "../lib/orders/budget/types.ts";
import { bomStatusTone } from "../lib/orders/bom-status.ts";
import { fabricPlanStatusTone } from "../lib/orders/fabric-plan/types.ts";
import { planApprovalTone } from "../lib/sales/plan-reports/types.ts";
import { styleStatusTone } from "../lib/orders/styles/types.ts";
import { GRANT_STATUS_TONE } from "../lib/orders/overrides/override-modules.ts";
import { GROUP_STATUS_TONE } from "../lib/sales/sample-grouping/types.ts";
import { TRIM_STATUS_TONE } from "../lib/orders/trim-ta/engine.ts";
import { FABRIC_TA_STATUS_TONE } from "../lib/orders/fabric-ta/engine.ts";

let failures = 0;
function eq(label: string, got: unknown, want: unknown) {
  if (got !== want) {
    failures++;
    console.log(`  FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

// ── 1. vectors ──────────────────────────────────────────────────────────────
const TONES = new Set(["success", "warning", "danger", "info", "neutral"]);
for (const [k, v] of Object.entries(STATUS_TONES)) {
  eq(`table key ${k} is normalised`, normalizeStatus(k), k);
  eq(`table value for ${k} is a tone`, TONES.has(v), true);
}

eq("draft", statusTone("draft"), "neutral");
eq("Pending MD Approval", statusTone("Pending MD Approval"), "warning");
eq("pending-md-approval", statusTone("pending-md-approval"), "warning");
eq("  CANCELLED ", statusTone("  CANCELLED "), "danger");
eq("In Progress", statusTone("In Progress"), "info");
eq("IN_PROGRESS", statusTone("IN_PROGRESS"), "info");
eq("approved", statusTone("approved"), "success");
// Exact, never substring: the one bug this rule exists to prevent.
eq("Not Approved", statusTone("Not Approved"), "danger");
eq("Partially Approved", statusTone("Partially Approved"), "warning");
eq("unapproved (unknown)", statusTone("unapproved"), "neutral");
eq("approved_by_md (unknown)", statusTone("approved_by_md"), "neutral");
eq("pre-approved (unknown)", statusTone("pre-approved"), "neutral");
eq("cancellation_requested (unknown)", statusTone("cancellation_requested"), "neutral");
eq("unknown word", statusTone("xyzzy"), "neutral");
eq("empty", statusTone(""), "neutral");
eq("null", statusTone(null), "neutral");
eq("undefined", statusTone(undefined), "neutral");
// Prototype keys must not leak through a plain-object lookup.
for (const k of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
  eq(`prototype key ${k}`, statusTone(k), "neutral");
  eq(`prototype key ${k} known`, isKnownStatus(k), false);
}
// Overrides win, and are looked up by the normalised key.
eq("override wins", statusTone("Approved", { approved: "info" }), "info");
eq("override misses fall through", statusTone("rejected", { approved: "info" }), "danger");
eq("TASK_PROGRESS pending", statusTone("PENDING", TASK_PROGRESS), "neutral");
eq("TASK_PROGRESS leaves others", statusTone("overdue", TASK_PROGRESS), "danger");
eq("activeTone(true)", activeTone(true), "success");
eq("activeTone(false)", activeTone(false), "neutral");
eq("activeTone(null)", activeTone(null), "neutral");
eq("draftTone(true)", draftTone(true), "neutral");
eq("draftTone(false)", draftTone(false), "success");

// Each module's documented exception, through its own exported function.
eq("cheque issued (override)", chequeStatusTone("issued"), "neutral");
eq("cheque cancelled", chequeStatusTone("cancelled"), "danger");
eq("epcg active (override)", epcgStatusTone("active"), "info");
eq("epcg fulfilled", epcgStatusTone("fulfilled"), "success");
eq("revision entry returned (override)", entryStatusTone("returned"), "danger");
eq("revision entry draft", entryStatusTone("draft"), "neutral");
eq("revision entry pending MD", entryStatusTone("pending_md_approval"), "warning");
eq("cad submitted (override)", cadStatusTone("submitted"), "success");
eq("cad queue measuring (override)", cadQueueStatusTone("measuring"), "danger");
eq("cad queue pending", cadQueueStatusTone("pending"), "warning");
eq("quote costing finalised (override)", qcStatusTone("finalised"), "info");
eq("budget submitted", budgetStatusTone("submitted"), "warning");
eq("budget rejected", budgetStatusTone("rejected"), "danger");
eq("bom unresolved", bomStatusTone("unresolved"), "danger");
eq("bom draft", bomStatusTone("draft"), "neutral");
eq("fabric plan replan", fabricPlanStatusTone("replan"), "danger");
eq("fabric plan no_bom", fabricPlanStatusTone("no_bom"), "neutral");
eq("plan open, revised", planApprovalTone("open", 1), "warning");
eq("plan open, first", planApprovalTone("open", 0), "neutral");
eq("plan returned", planApprovalTone("returned", 0), "warning");
eq("plan submitted", planApprovalTone("submitted", 2), "warning");
eq("style draft", styleStatusTone({ is_draft: true, blocked: true }), "neutral");
eq("style blocked", styleStatusTone({ is_draft: false, blocked: true }), "danger");
eq("style saved", styleStatusTone({ is_draft: false, blocked: false }), "success");
eq("grant expired (override)", GRANT_STATUS_TONE.expired, "neutral");
eq("grant revoked", GRANT_STATUS_TONE.revoked, "danger");
eq("group approved (override)", GROUP_STATUS_TONE.approved, "info");
eq("group completed", GROUP_STATUS_TONE.completed, "success");
eq("trim T&A pending", TRIM_STATUS_TONE.PENDING, "neutral");
eq("fabric T&A overdue", FABRIC_TA_STATUS_TONE.OVERDUE, "danger");

const vectorFailures = failures;

// ── 2. scan ─────────────────────────────────────────────────────────────────
const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** Files allowed to spell a known status word beside a literal tone. */
const EXEMPT: Record<string, string> = {
  "lib/ui/status-tone.ts": "the table itself",
  "components/ui/status-pill.tsx": "tone → colour and icon, not status → tone",
  "components/approvals/approval-timeline.tsx":
    "EVENT verbs (submit / approve / return / cancel), not document statuses — a cancel event is grey because it is history",
  "components/sales/sample-queue.tsx":
    "queue CARD states mirroring bom-queue's QUEUE_THEME (pending = work owed = red), a deliberate queue palette",
  "components/orders/bom-queue.tsx": "QUEUE_THEME, the Orders queue's own palette (see the file)",
  "components/dashboard/tone.ts": "dashboard tone → StatusTone adapter, not status words",
  // PENDING MIGRATION — each was open in a parallel session on 2026-10-16, so
  // the sweep left it alone. Move it to statusTone() and delete its line here.
  "app/(app)/orders/contract-review/contract-review-client.tsx":
    "PENDING MIGRATION — { pending: neutral, revision: warning }; pending is TASK_PROGRESS",
  "app/(app)/integration/integration-tabs.tsx": "PENDING MIGRATION — export status map",
  "app/(app)/integration/tally/[exportId]/page.tsx":
    "PENDING MIGRATION — same map as integration/tally/page.tsx (EXPORT_TONES there)",
};

const SKIP_DIRS = new Set(["node_modules", ".next", ".next-verify", ".git", "out", "dist"]);
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith(".next")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const TONE = "(success|warning|danger|info|neutral)";
const CASE_RE = new RegExp(`case\\s+"([A-Za-z_ -]+)"\\s*:\\s*(?:\\/\\/[^\\n]*\\n\\s*)*return\\s+"${TONE}"`, "g");
const PAIR_RE = new RegExp(`^\\s*"?([A-Za-z_][A-Za-z_ -]*)"?\\s*:\\s*"${TONE}"\\s*,?`, "gm");
// Greedy `[^{}]*` cannot backtrack (the class excludes the closing brace); a
// lazy `*?` followed by `\s*\}` went quadratic on the 19,000-line screens.
const ENTRY_RE = /\{([^{}]*)\}/g;

const findings: string[] = [];
for (const abs of ["app", "components", "lib"].flatMap((d) => walk(join(ROOT, d)))) {
  const rel = relative(ROOT, abs).split(sep).join("/");
  if (EXEMPT[rel]) continue;
  const raw = readFileSync(abs, "utf8");
  const rawLines = raw.split("\n");
  // `// status-tone: exempt -- <reason>` on the line, or up to 3 lines above.
  const exempt = (ln: number) =>
    rawLines.slice(Math.max(0, ln - 4), ln).some((l) => /status-tone: exempt --\s*\S/.test(l));
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
  const line = (i: number) => src.slice(0, i).split("\n").length;

  for (const m of src.matchAll(CASE_RE)) {
    if (isKnownStatus(m[1]) && !exempt(line(m.index!))) findings.push(`${rel}:${line(m.index!)}  case "${m[1]}": return "${m[2]}"`);
  }

  // Object literals: a known status word with a literal tone, unless the
  // object is a named override that this file hands to statusTone().
  const overrideNames = new Set(
    [...src.matchAll(/[sS]tatusTone\([^,()]+(?:\([^()]*\))?[^,()]*,\s*([A-Z_][A-Z0-9_]*)\s*\)/g)].map((m) => m[1]),
  );
  for (const m of src.matchAll(ENTRY_RE)) {
    const body = m[1];
    if (exempt(line(m.index!))) continue;
    const pairs = [...`\n${body.replace(/,\s*/g, ",\n")}`.matchAll(PAIR_RE)].filter((p) => isKnownStatus(p[1]));
    if (!pairs.length) continue;
    const before = src.slice(Math.max(0, m.index! - 160), m.index!);
    const named = before.match(/(?:const|let)\s+([A-Z_][A-Z0-9_]*)\b[^=]*=\s*$/);
    if (named && overrideNames.has(named[1])) continue;
    for (const p of pairs) findings.push(`${rel}:${line(m.index!)}  { ${p[1]}: "${p[2]}" }`);
  }
}

if (findings.length) {
  console.log(`\n${findings.length} hand-written status → tone mapping(s). Use statusTone() from lib/ui/status-tone.ts,`);
  console.log(`or a named override passed to statusTone(status, NAME) with its reason in a comment:\n`);
  for (const f of findings) console.log(`  ${f}`);
}

if (vectorFailures || findings.length) {
  console.log(`\ncheck:status-tone — FAILED (${vectorFailures} vector(s), ${findings.length} mapping(s))`);
  process.exit(1);
}
console.log(
  `check:status-tone — ok: ${Object.keys(STATUS_TONES).length} statuses, exact match only, every module delegates.`,
);
