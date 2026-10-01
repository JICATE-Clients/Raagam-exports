/**
 * Vectors for `lib/orders/work-flow/types.ts` — Order Entry ▸ T&A ▸ Work Flow
 * (0607, doc/order/orderentry-workflow-plan.md).
 *
 * Every vector is chosen where two plausible implementations DISAGREE
 * (check-ta-schedule.mts's standard): a span that crosses a Sunday, a row
 * finished late vs on time, an owner list that is empty vs one that holds a
 * since-retagged owner.
 *
 *     2026-10-12 is a MONDAY  (the spec's own worked example, QA-WP-01)
 *     2026-10-17 is a Saturday, 2026-10-18 a SUNDAY
 *
 * ## THE SQL MIRROR IS CHECKED, NOT TRUSTED
 *
 * The milestone list lives twice — `WORK_FLOW_MILESTONES` here and
 * `work_flow_milestone_defaults()` in the 0607 migration, which is what seeds
 * each order's rows. Section 4 parses the migration and asserts they agree, so
 * changing a default on one side only fails this script instead of shipping a
 * screen that previews one target while the database stores another.
 *
 * Runs under `tsx` (the `@/lib` aliases). `npm run check:work-flow`.
 */
import { readFileSync } from "node:fs";
import {
  WORK_FLOW_MILESTONES,
  WORK_FLOW_CODES,
  workFlowDay0,
  workFlowOwnerOptions,
  workFlowTarget,
  workFlowView,
  type WorkFlowEmployee,
} from "../lib/orders/work-flow/types";
import { dayOfWeek } from "../lib/calendar";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed++;
    console.error(`FAIL  ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

// ---------------------------------------------------------------------------
// 0. The fixture's own premise.
// ---------------------------------------------------------------------------
check("2026-10-12 really is a Monday", dayOfWeek("2026-10-12"), 1);
check("2026-10-18 really is a Sunday", dayOfWeek("2026-10-18"), 0);

// ---------------------------------------------------------------------------
// 1. Targets — QA-WP-01, and the Sunday the spec's example never crosses.
// ---------------------------------------------------------------------------
const day0 = "2026-10-12";
check(
  "QA-WP-01: received 12-10-2026 → targets 13, 14, 15, 15, 16, 16 (Pattern Sent / Approval removed, 0679)",
  WORK_FLOW_MILESTONES.map((m) => workFlowTarget(day0, m.days)),
  ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-15", "2026-10-16", "2026-10-16"],
);
check("a Saturday Day 0 + 1 skips Sunday → Monday", workFlowTarget("2026-10-17", 1), "2026-10-19");
check("Thursday + 3 crosses Sunday → Tuesday, not Sunday", workFlowTarget("2026-10-15", 3), "2026-10-19");
check("0 days → Day 0 itself", workFlowTarget(day0, 0), day0);
check("no Day 0 → no target", workFlowTarget(null, 2), null);
check("negative days → no target", workFlowTarget(day0, -1), null);

// ---------------------------------------------------------------------------
// 2. Day 0 — received date, else the order date, and it says which.
// ---------------------------------------------------------------------------
check("received date wins", workFlowDay0("2026-10-12", "2026-10-01"), { date: "2026-10-12", source: "received" });
check("blank received → order date, labelled", workFlowDay0(null, "2026-10-01"), { date: "2026-10-01", source: "order" });

// ---------------------------------------------------------------------------
// 3. Display state — QA-WP-02 / QA-WP-03.
// ---------------------------------------------------------------------------
const today = "2026-10-17";
check(
  "QA-WP-02: FABRIC_BOM target 15-10, open on 17-10 → Overdue 2d, danger",
  workFlowView({ status: "pending", target_date: "2026-10-15", actual_date: null }, today),
  { state: "overdue", daysLate: 2, label: "Overdue · 2d", tone: "danger" },
);
check(
  "in progress past target is STILL overdue (started ≠ on time)",
  workFlowView({ status: "in_progress", target_date: "2026-10-15", actual_date: null }, today).state,
  "overdue",
);
check(
  "due today is not overdue",
  workFlowView({ status: "pending", target_date: today, actual_date: null }, today).state,
  "pending",
);
check(
  "QA-WP-03: CAD done 14-10 against target 14-10 → Done, success",
  workFlowView({ status: "done", target_date: "2026-10-14", actual_date: "2026-10-14" }, today),
  { state: "done", daysLate: 0, label: "Done", tone: "success" },
);
check(
  "done after target → Done late, warning — finished, not an alarm",
  workFlowView({ status: "done", target_date: "2026-10-14", actual_date: "2026-10-16" }, today),
  { state: "done_late", daysLate: 2, label: "Done · 2d late", tone: "warning" },
);
check(
  "backfilled done with no date cannot be judged late → plain Done",
  workFlowView({ status: "done", target_date: "2026-10-14", actual_date: null }, today).state,
  "done",
);
check(
  "a done row is never overdue however old its target",
  workFlowView({ status: "done", target_date: "2026-01-01", actual_date: "2026-01-01" }, today).state,
  "done",
);

// ---------------------------------------------------------------------------
// 4. The SQL mirror — 0607's work_flow_milestone_defaults() must equal the list.
// ---------------------------------------------------------------------------
// 0628 re-declared the list (Pattern Sent / Pattern Approval) and 0679 took
// them out again; the LATEST definition is the one the database runs, so that
// is the file parsed.
const sql = readFileSync(new URL("../supabase/migrations/0679_work_flow_drop_pattern_milestones.sql", import.meta.url), "utf8");
const block = sql.match(/work_flow_milestone_defaults\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/)?.[1] ?? "";
const sqlRows = [...block.matchAll(/\('([A-Z_]+)',\s*(\d+),\s*(\d+)\)/g)].map((m) => ({
  code: m[1],
  sn: Number(m[2]),
  days: Number(m[3]),
}));
check(
  "SQL defaults = WORK_FLOW_MILESTONES (code, sn, days)",
  sqlRows,
  WORK_FLOW_MILESTONES.map((m) => ({ code: m.code, sn: m.sn, days: m.days })),
);
check("codes list and milestone list agree", WORK_FLOW_MILESTONES.map((m) => m.code), [...WORK_FLOW_CODES]);
check(
  "only Budget Approval is kept off the alert sweep",
  WORK_FLOW_MILESTONES.filter((m) => !m.alerts).map((m) => m.code),
  ["BUDGET_APPROVAL"],
);

// ---------------------------------------------------------------------------
// 5. Owner options — EVERY staff member since 2026-10-01 (user: "remove the
//    condition, list all staff master data directly"); held owner survives.
// ---------------------------------------------------------------------------
const emp = (id: string, designation: string | null, department: string | null): WorkFlowEmployee => ({
  id, code: id, name: id.toUpperCase(), inactive: false, designation, department,
});
const staff = [
  emp("merch", "MERCHANDISER", null),
  emp("cadguy", null, "CAD"),
  emp("packer", null, "PACKING"),
  emp("untagged", null, null),
];
const everyone = ["merch", "cadguy", "packer", "untagged"];
check("CAD row offers every staff member, tagged or not",
  workFlowOwnerOptions(staff, "CAD_COMPLETION", null).items.map((e) => e.id), everyone);
check("Budget Approval offers everyone too — no 'Nobody tagged' dead end",
  workFlowOwnerOptions(staff, "BUDGET_APPROVAL", null).items.map((e) => e.id), everyone);
check("...with no hint while there is anyone to offer",
  workFlowOwnerOptions(staff, "BUDGET_APPROVAL", null).shortHint, null);
check("empty master → says so",
  workFlowOwnerOptions([], "BUDGETING", null).shortHint, "No staff entered");
check("a held id the master no longer has is not invented as an option",
  workFlowOwnerOptions(staff.slice(0, 2), "CAD_COMPLETION", "packer").items.map((e) => e.id),
  ["merch", "cadguy"]);

console.log(failed === 0 ? "\nOK — every Work Flow vector holds." : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
