/**
 * THE WORKFLOWS RAAGAM APPROVES — a UI convenience, NEVER a gate.
 *
 * `approval_flows.workflow_key` is TEXT in the database and nothing constrains
 * it. That is the skill's own decision and it is worth not undoing: the system
 * it was extracted from gated workflow types behind a Postgres enum, so every
 * new workflow cost a migration plus a hand-synced TypeScript union, and the
 * two drifted.
 *
 * So this list exists for exactly one reason: the flow builder needs something
 * to put in a dropdown, and a free-text box there is how `oder_budget` gets
 * saved and matches nothing forever. Adding a workflow means adding a line here
 * AND calling `startApproval` from that screen — but a key absent from this list
 * still works end to end if someone inserts a flow by hand. Nothing reads this
 * to decide whether a run may start.
 *
 * ## SUBJECT TABLE IS PART OF THE DECLARATION, DELIBERATELY
 *
 * `approval_runs.subject_table` is text with no FK — it has to be, because the
 * column points at four different tables. That makes a typo unfalsifiable at
 * the database level: `garment_order_amendment` (singular) inserts happily and
 * the run is then attached to a table that does not exist. Naming the table
 * beside the key here means the calling screen passes `WORKFLOWS.order_amendment`
 * rather than two loose strings, and the typo becomes a compile error.
 */

export type WorkflowKey =
  | "order_budget"
  | "iwo_budget"
  | "order_amendment"
  | "purchase_indent"
  | "purchase_order"
  | "hr_fine"
  | "sample_costing"
  | "sample_revision"
  | "sample_fabric_plan"
  | "sample_accessories_plan"
  | "sample_pd_request"
  | "timeoff_request"
  | "timeoff_encashment"
  | "lc_termination"
  | "lc_settlement"
  | "rc_hire"
  | "pf_review"
  | "pf_promotion";

export type WorkflowDecl = {
  key: WorkflowKey;
  /** The table `approval_runs.subject_id` points into. */
  subjectTable: string;
  /** What the operator calls it — the builder's dropdown, the inbox's chip. */
  label: string;
  /** Where a queue row opens. `:id` is replaced with the subject id. */
  href: string;
};

export const WORKFLOWS: Record<WorkflowKey, WorkflowDecl> = {
  order_budget: {
    key: "order_budget",
    subjectTable: "order_budgets",
    label: "Order Budget",
    // `?open=` opens the budget's approval sheet (budget-approval/page.tsx).
    href: "/orders/budget-approval?open=:id",
  },
  /* 0595 — an Internal Work Order's budget. The queue row opens the IWO Budget
     screen on that budget (`useOpenIntent` there accepts a budget id). */
  iwo_budget: {
    key: "iwo_budget",
    subjectTable: "iwo_budgets",
    label: "IWO Budget",
    href: "/orders/iwo-budgets?open=:id",
  },
  order_amendment: {
    key: "order_amendment",
    subjectTable: "garment_order_amendments",
    label: "Order Amendment",
    href: "/orders/approve-amendments",
  },
  purchase_indent: {
    key: "purchase_indent",
    subjectTable: "purchase_indents",
    label: "Purchase Indent",
    href: "/purchase/indents/approval",
  },
  purchase_order: {
    key: "purchase_order",
    subjectTable: "purchase_orders",
    label: "Purchase Order",
    /* 0764 — started by Raise PO (above budget / unbudgeted) and the PO screen's
       Submit; decided in `purchase_order_apply_decision`. The row opens that PO. */
    href: "/purchase/orders/:id",
  },
  /* 0629 — a staff fine / salary deduction (doc/order/punishment fine.md). The
     run is started INSIDE `hr_fine_submit` (SQL), in the same transaction as
     the lock, so this entry is here for the builder dropdown, the inbox chip
     and the row link — not for a `startApproval` call. */
  hr_fine: {
    key: "hr_fine",
    subjectTable: "hr_staff_fine_deductions",
    label: "Staff Fine",
    href: "/hr/fines?open=:id",
  },
  /* 0688 — a Sample Costing whose quoted price earns under the 20 % margin
     floor (doc/sample/sample-costing-specification.md §5.2). Started by
     `submitSampleCosting`; one that clears the floor never reaches here. The
     row opens the costing (`useOpenIntent` in sample-costing-screen.tsx). */
  sample_costing: {
    key: "sample_costing",
    subjectTable: "cost_sheets",
    label: "Sample Costing",
    href: "/sales/sample-costing?open=:id",
  },
  /* 0716 — a Sample Revision (doc/sample/sample revion.md): a locked sample's
     change, with V0 and the proposed costing compared. Started by
     `submitSampleRevision`; decided in `sample_revision_apply_decision`. The
     row opens the revision's own page. */
  sample_revision: {
    key: "sample_revision",
    subjectTable: "sample_revisions",
    label: "Sample Revision",
    href: "/sales/sample-revision/:id",
  },
  /* 0718 — a sample Fabric Plan (client brief 2026-10-13 §2): approved before
     its yarn is bought or its fabric processed, then locked. Started by
     `submitSampleFabricPlan`; decided in `sample_fabric_plan_apply_decision`.
     The subject is the PLAN (iwo_fabric_boms). The row opens Sample ▸ Plan
     Approval on it (user 2026-10-13: a separate approval screen, "like order
     entry") — the plan's report beside Approve / Request Rework. */
  sample_fabric_plan: {
    key: "sample_fabric_plan",
    subjectTable: "iwo_fabric_boms",
    label: "Sample Fabric Plan",
    href: "/sales/plan-approval?open=fabric::id",
  },
  /* 0720 — the Accessories Plan's twin: approved before its trims are bought.
     Started by `submitSampleAccessoriesPlan`; decided in
     `sample_accessories_plan_apply_decision`. */
  sample_accessories_plan: {
    key: "sample_accessories_plan",
    subjectTable: "iwo_material_boms",
    label: "Sample Accessories Plan",
    href: "/sales/plan-approval?open=accessories::id",
  },
  /* 0719 — a Product Development request to the Sample Department (brief §3,
     spec §7.1). Approve = Acknowledged, Reject = Not Acknowledged. Started by
     `sendPdRequest` (per SMP — 0724 reversed 0723's per-SWO); the row opens the request on the Sample Department's
     queue (Sample ▸ Acknowledge PD Request, client spec 2026-10-14). Sample
     Entry's `?pd=` redirect stays for links already sent. */
  sample_pd_request: {
    key: "sample_pd_request",
    subjectTable: "sample_pd_requests",
    label: "Sample PD Request",
    href: "/sales/pd-acknowledge?open=:id",
  },
  /* 0770 — HR ▸ Time Off (the MyJKKN port): a leave, a permission or a
     comp-off booking, and a leave encashment. Both runs are started INSIDE SQL
     (`timeoff_apply`, `timeoff_request_encashment`) in the same transaction as
     the insert, like the staff fine. The row opens the request on Time Off ▸
     Approvals, which shows every kind of time-off item in one queue. */
  timeoff_request: {
    key: "timeoff_request",
    subjectTable: "timeoff_requests",
    label: "Leave / Permission",
    href: "/hr/time-off/approvals?open=:id",
  },
  timeoff_encashment: {
    key: "timeoff_encashment",
    subjectTable: "timeoff_encashments",
    label: "Leave Encashment",
    href: "/hr/time-off/encashment?open=:id",
  },
  // HR ▸ Team Lifecycle (0771). Both runs are started inside the SECURITY
  // DEFINER function that writes the subject (`lc_open_exit` for a
  // termination, `lc_submit_settlement`), in the same transaction.
  lc_termination: {
    key: "lc_termination",
    subjectTable: "lc_exits",
    label: "Termination",
    href: "/hr/team/exits?open=:id",
  },
  lc_settlement: {
    key: "lc_settlement",
    subjectTable: "lc_settlements",
    label: "Full & Final Settlement",
    href: "/hr/team/settlements?open=:id",
  },
  rc_hire: {
    key: "rc_hire",
    subjectTable: "rc_candidates",
    label: "Hiring",
    href: "/hr/recruitment/candidates?open=:id",
  },
  // HR ▸ Performance & Growth (0773). Both runs are started inside the
  // SECURITY DEFINER function that writes the subject (`pf_save_supervisor`
  // on submit, `pf_raise_promotion`), in the same transaction.
  pf_review: {
    key: "pf_review",
    subjectTable: "pf_reviews",
    label: "Appraisal",
    href: "/hr/performance/appraisals?open=:id",
  },
  pf_promotion: {
    key: "pf_promotion",
    subjectTable: "pf_promotions",
    label: "Promotion",
    href: "/hr/performance/promotions?open=:id",
  },
};

export const WORKFLOW_LIST: WorkflowDecl[] = Object.values(WORKFLOWS);

/**
 * What to call a workflow key that is not in the list above.
 *
 * IT PRINTS THE KEY RATHER THAN "Unknown". A run whose key nothing recognises is
 * either a flow built by hand or a screen this list has not caught up with, and
 * in both cases the raw key is the one piece of information that lets somebody
 * find it. "Unknown workflow" in an inbox row is a dead end.
 */
export function workflowLabel(key: string): string {
  return WORKFLOWS[key as WorkflowKey]?.label ?? key;
}
