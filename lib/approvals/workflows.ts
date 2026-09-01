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
  | "order_amendment"
  | "purchase_indent"
  | "purchase_order";

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
    href: "/orders/budget-approval",
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
    href: "/purchase/orders",
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
