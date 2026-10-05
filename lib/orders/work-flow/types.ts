/**
 * Order Entry ▸ T&A ▸ Work Flow — the six pre-production OFFICE milestones
 * (doc/order/orderentry workflow feature.md; plan in
 * doc/order/orderentry-workflow-plan.md; table + triggers in 0607).
 *
 * Client-safe and pure, so the panel, the server service, the sweep and
 * `scripts/check-work-flow.mts` all read ONE definition.
 *
 * ## WHAT THIS FILE DOES NOT DO: DECIDE COMPLETION
 *
 * `status` and `actual_date` are written by database triggers on the modules
 * themselves (order saved, CAD submitted, BOM out of draft, budget submitted /
 * approved) and by nothing else — `authenticated` holds no UPDATE grant on those
 * columns. This file only READS them and adds the one thing SQL does not store:
 * whether an unfinished row is late TODAY.
 */

import type { StatusTone } from "@/lib/ui/tone";
import { addWorkingDays, isRefusal } from "@/lib/ta/schedule";
import { daysBetween } from "@/lib/calendar";

// ============================================================================
// THE SIX (0607's six; 0628 added Pattern Sent / Pattern Approval, 0679
// removed them again — user 2026-10-01: "remove these two approvals from the
// T&A tab")
// ============================================================================

export const WORK_FLOW_CODES = [
  "ORDER_ENTRY",
  "CAD_COMPLETION",
  "MATERIAL_BOM",
  "FABRIC_BOM",
  "BUDGETING",
  "BUDGET_APPROVAL",
] as const;
export type WorkFlowCode = (typeof WORK_FLOW_CODES)[number];

export type WorkFlowMilestoneDef = {
  code: WorkFlowCode;
  sn: number;
  label: string;
  /** Default working days after Day 0. MUST equal `work_flow_milestone_defaults()` (0679; was 0628, 0607). */
  days: number;
  /** What finishing it means, in the operator's words — the row's sub-line. */
  doneWhen: string;
  /**
   * Who may own it: an employee whose Designation OR Department name is one of
   * these (case-insensitive) — the `merchandiserOptions` rule, per milestone.
   */
  ownerTags: readonly string[];
  /** The tag list as the empty-hint says it. */
  ownerTagsLabel: string;
  /**
   * Does the SWEEP alert on this row? BUDGET_APPROVAL does not: its owner is
   * the approver, and the user decided (2026-09-20, approval SLA) that nagging
   * approvers produces rubber-stamping. The approval engine's SLA already
   * escalates that step; a second alert from here would undo that decision
   * through a side door. The row still goes red on screen.
   */
  /** Where the work is done — the alert links here. */
  href: string;
  alerts: boolean;
};

export const WORK_FLOW_MILESTONES: readonly WorkFlowMilestoneDef[] = [
  {
    code: "ORDER_ENTRY",
    sn: 1,
    label: "Order Entry",
    days: 1,
    doneWhen: "Order saved (not as a draft)",
    ownerTags: ["MERCHANDISER", "MERCHANDISING"],
    ownerTagsLabel: "Merchandiser / Merchandising",
    alerts: true,
    href: "/orders/garment-orders",
  },
  {
    code: "CAD_COMPLETION",
    sn: 2,
    label: "CAD Completion",
    days: 2,
    doneWhen: "CAD sheet submitted",
    ownerTags: ["CAD", "SAMPLING"],
    ownerTagsLabel: "CAD / Sampling",
    alerts: true,
    href: "/orders/cad",
  },
  {
    code: "MATERIAL_BOM",
    sn: 3,
    label: "Accessories Plan",
    days: 3,
    doneWhen: "Accessories Plan saved (not as a draft)",
    ownerTags: ["MERCHANDISER", "MERCHANDISING"],
    ownerTagsLabel: "Merchandiser / Merchandising",
    alerts: true,
    href: "/orders/material-bom",
  },
  {
    code: "FABRIC_BOM",
    sn: 4,
    label: "Fabric Plan",
    days: 3,
    doneWhen: "Fabric Plan saved (not as a draft)",
    ownerTags: ["MERCHANDISER", "MERCHANDISING", "TECHNICAL"],
    ownerTagsLabel: "Merchandiser / Merchandising / Technical",
    alerts: true,
    href: "/orders/fabric-bom",
  },
  {
    code: "BUDGETING",
    sn: 5,
    label: "Budgeting",
    days: 4,
    doneWhen: "Budget submitted for approval",
    ownerTags: ["COSTING", "MERCHANDISER", "MERCHANDISING"],
    ownerTagsLabel: "Costing / Merchandiser",
    alerts: true,
    href: "/orders/budgets",
  },
  {
    code: "BUDGET_APPROVAL",
    sn: 6,
    label: "Budget Approval",
    days: 4,
    doneWhen: "Budget approved",
    ownerTags: ["MANAGING DIRECTOR", "MANAGEMENT"],
    ownerTagsLabel: "Managing Director / Management",
    alerts: false,
    href: "/approvals",
  },
];

const BY_CODE = new Map(WORK_FLOW_MILESTONES.map((m) => [m.code, m]));
export function workFlowDef(code: string): WorkFlowMilestoneDef | undefined {
  return BY_CODE.get(code as WorkFlowCode);
}

/**
 * Escalate to management once an unfinished row is this many CALENDAR days
 * past its target — the spec's "overdue exceeds 48 hours". Calendar, not
 * working days, for the reason `ESCALATE_AFTER_DAYS` in lib/ta/worklist.ts
 * gives. Its own constant rather than that one (3): office tasks are one-day
 * tasks, so a smaller margin is proportionate.
 */
export const WORK_FLOW_ESCALATE_AFTER_DAYS = 2;

// ============================================================================
// ROWS
// ============================================================================

export type WorkFlowStatus = "pending" | "in_progress" | "done";

/** One stored milestone, as the service returns it. */
export type WorkFlowRow = {
  id: string;
  code: WorkFlowCode;
  sn: number;
  days: number;
  target_date: string | null;
  actual_date: string | null;
  status: WorkFlowStatus;
  actual_source: "auto" | "backfill" | null;
  owner_id: string | null;
  owner_name: string | null;
  remarks: string | null;
};

/** What the panel shows for Day 0, and which field supplied it. */
export type WorkFlowDay0 = {
  date: string | null;
  source: "received" | "order";
};

/** `received_date ?? amend_date` — 0607's `work_flow_day0`, the same rule. */
export function workFlowDay0(receivedDate: string | null, orderDate: string | null): WorkFlowDay0 {
  return receivedDate ? { date: receivedDate, source: "received" } : { date: orderDate, source: "order" };
}

/**
 * The target a Days edit WILL produce, shown before the save lands — the same
 * working-day walk 0607's `work_flow_add_working_days` does (Sunday off, no
 * holidays on either side: both halves or neither).
 */
export function workFlowTarget(day0: string | null, days: number): string | null {
  if (!day0 || !Number.isInteger(days) || days < 0) return null;
  const at = addWorkingDays(day0, days);
  return isRefusal(at) ? null : at;
}

// ============================================================================
// DISPLAY STATE — the one thing SQL does not store
// ============================================================================

export type WorkFlowDisplayState = "pending" | "in_progress" | "overdue" | "done" | "done_late";

export type WorkFlowView = {
  state: WorkFlowDisplayState;
  /** Calendar days past target: while open, as of today; once done, at completion. 0 when on time. */
  daysLate: number;
  label: string;
  tone: StatusTone;
};

/**
 * Pending / In progress / Overdue / Done / Done late.
 *
 * OVERDUE = not done and today is past the target — never stored (0607's header).
 *
 * A row finished after its target stays GREEN-ish rather than red: it is
 * finished, and the late part is history, so it is `warning` ("Done · 2d late")
 * — visible for the KPI conversation, not an alarm demanding action. A
 * backfilled `done` with no date cannot be judged late and reads plain Done.
 */
export function workFlowView(row: Pick<WorkFlowRow, "status" | "target_date" | "actual_date">, today: string): WorkFlowView {
  const { status, target_date: target, actual_date: actual } = row;
  if (status === "done") {
    const late = target && actual ? Math.max(0, daysBetween(target, actual)) : 0;
    return late > 0
      ? { state: "done_late", daysLate: late, label: `Done · ${late}d late`, tone: "warning" }
      : { state: "done", daysLate: 0, label: "Done", tone: "success" };
  }
  const late = target ? daysBetween(target, today) : 0;
  if (late > 0) return { state: "overdue", daysLate: late, label: `Overdue · ${late}d`, tone: "danger" };
  return status === "in_progress"
    ? { state: "in_progress", daysLate: 0, label: "In progress", tone: "info" }
    : { state: "pending", daysLate: 0, label: "Pending", tone: "neutral" };
}

// ============================================================================
// OWNER OPTIONS — merchandiserOptions' rule, per milestone
// ============================================================================

export type WorkFlowEmployee = {
  id: string;
  code: string | null;
  name: string;
  inactive: boolean | null;
  designation: string | null;
  department: string | null;
};

export type WorkFlowOwnerOptions<T> = { items: T[]; hint: string | null; shortHint: string | null };

/**
 * Staff who may own this milestone — since 2026-10-01, ALL of them (user:
 * "list all staff master data directly"). It used to be the staff whose
 * Designation or Department matched `ownerTags`, empty-and-explain otherwise;
 * that reasoning (a CAD milestone owned by a packer) was the user's to
 * overrule, and was. The held owner always survives ("Disabled rows").
 */
export function workFlowOwnerOptions<T extends WorkFlowEmployee>(
  employees: readonly T[],
  code: WorkFlowCode,
  currentValue: string | null,
): WorkFlowOwnerOptions<T> {
  /* NO DESIGNATION / DEPARTMENT FILTER (user 2026-10-01: "remove the
     condition, list all staff master data directly"). Every HR ▸ Staff member
     is offered; the picker itself hides a switched-off one (`inactive`), and the
     held owner survives below. `ownerTags` stays on each milestone as a note of
     who USUALLY owns it — nothing reads it to filter any more. */
  void code;
  const items = [...employees];

  let hint: string | null = null;
  let shortHint: string | null = null;
  if (items.length === 0) {
    hint = "No staff have been entered yet. Add them on HR & Payroll ▸ People ▸ Staff.";
    shortHint = "No staff entered";
  }

  if (!currentValue || items.some((r) => r.id === currentValue)) return { items, hint, shortHint };
  const held = employees.find((r) => r.id === currentValue);
  return held ? { items: [...items, held], hint, shortHint: null } : { items, hint, shortHint };
}
