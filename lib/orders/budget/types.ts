import { z } from "zod";
import { BUDGET_SOURCES } from "./totals";
import { capsTextNullable } from "@/lib/validation/formats";

// ============================================================================
// Orders ▸ Budgeting (step 5) and Approval (step 6), over ONE table (0428).
//
// A budget groups several garment orders, costs them from their Fabric and
// Material BOMs, and is then approved. Approval is a transition on `status`, not
// a second document — two records would let the approved figures drift from the
// budget they approved.
//
// `amount` and every total are DERIVED, by `./totals.ts`. See 0428 on why: three
// numbers stating two facts disagree the first time one is edited without the
// other, and the sales total REFUSES when an order cannot be valued, which a
// numeric column cannot hold.
// ============================================================================

export const BUDGET_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export function budgetStatusText(s: BudgetStatus): string {
  switch (s) {
    case "draft":
      return "Draft";
    case "submitted":
      return "Awaiting approval";
    case "approved":
      return "Approved";
    default:
      return "Rejected";
  }
}

export function budgetStatusTone(s: BudgetStatus): "neutral" | "warning" | "success" | "danger" {
  switch (s) {
    // NEUTRAL — `lib/ui/tone.ts`: neutral is "no claim", and a draft makes none.
    case "draft":
      return "neutral";
    case "submitted":
      return "warning";
    case "approved":
      return "success";
    default:
      return "danger";
  }
}

/**
 * Can this budget move to that status?
 *
 * ONE FUNCTION, THREE READERS — the editor's footer, the approval queue's
 * buttons, and both server actions. A transition table that lived only in the
 * UI would let a stale tab approve a budget that had already been rejected, and
 * one that lived only in the action would leave the screen offering buttons that
 * always fail.
 *
 * `submitted -> submitted` is refused rather than being a harmless no-op: it is
 * what a double-click produces, and letting it through would re-stamp
 * `submitted_at` and move the budget to the back of the queue.
 */
export function canTransition(from: BudgetStatus, to: BudgetStatus): boolean {
  switch (from) {
    case "draft":
      return to === "submitted";
    case "submitted":
      return to === "approved" || to === "rejected";
    // A REJECTED BUDGET GOES BACK TO DRAFT to be reworked. An APPROVED one does
    // not go anywhere: it is the document purchase is acting on, and reopening
    // it would move a ceiling under a PO that had already been placed. Raising a
    // second budget is the way to revise, which is also why an order in two
    // APPROVED budgets is refused (0428).
    case "rejected":
      return to === "draft";
    default:
      return false;
  }
}

export interface BudgetOrder {
  id: string;
  budget_id: string;
  garment_order_id: string;
  sno: number;
  /** The order's value when the budget was saved. NULL means it could not be
   *  valued — `sales_refusal` says why. Never a partial sum. */
  sales_value: number | null;
  sales_refusal: string | null;
  garment_order?: {
    id: string;
    code: string | null;
    po_no: string | null;
    delivery_date: string | null;
    customer: { id: string; name: string } | null;
    sales_order: { order_number: string | null } | null;
  } | null;
}

export interface BudgetLine {
  id: string;
  budget_id: string;
  sno: number;
  source: string;
  /** Which order this cost belongs to. NULL = the whole group — right for a
   *  shared overhead, wrong for fabric. */
  garment_order_id: string | null;
  item_id: string | null;
  description: string | null;
  qty: number | null;
  uom_id: string | null;
  rate: number | null;
  notes: string | null;
}

export interface OrderBudget {
  id: string;
  code: string | null;
  budget_date: string;
  description: string | null;
  status: BudgetStatus;
  submitted_at: string | null;
  submitted_by: string | null;
  decided_at: string | null;
  decided_by: string | null;
  decision_remark: string | null;
  currency_code: string | null;
  exchange_rate: number;
  remark: string | null;
  location_id: string | null;
  created_at: string;
  updated_at: string;
  orders: BudgetOrder[];
  lines: BudgetLine[];
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);
const numN = z.coerce.number().nullable().default(null);

export const budgetOrderInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  garment_order_id: z.string().uuid(),
  sales_value: numN,
  sales_refusal: nullableText,
});

export const budgetLineInput = z
  .object({
    sno: z.coerce.number().int().nonnegative().default(0),
    source: z.enum(BUDGET_SOURCES),
    garment_order_id: uuidN,
    item_id: uuidN,
    description: capsTextNullable(),
    qty: numN,
    uom_id: uuidN,
    rate: numN,
    notes: capsTextNullable(),
  })
  /**
   * The line rules, in the SCHEMA — `lib/data-io` parses imports with these same
   * schemas and writes straight to Postgres, so a rule enforced only in the
   * action misses every spreadsheet import.
   *
   * The messages are `lineAmount`'s, word for word. Two spellings of one refusal
   * is how an operator comes to believe there are two different problems.
   */
  .superRefine((v, ctx) => {
    if (v.qty == null || v.qty <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["qty"],
        message: "Enter a quantity — use 1 for a lump sum",
      });
    }
    if (v.rate == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rate"], message: "Enter a rate" });
    } else if (v.rate < 0) {
      // NOT a tidy-up of the sign. A negative expense subtracts from the COST
      // total, which is the figure a purchase ceiling is checked against.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rate"],
        message: "A rate cannot be negative — use Other income instead",
      });
    }
  });

export const orderBudgetInput = z.object({
  budget_date: z.string().min(1, "Date is required"),
  description: capsTextNullable(),
  currency_code: nullableText,
  exchange_rate: z.coerce.number().positive("Exchange rate must be more than 0").default(1),
  remark: nullableText,
  /** AT LEAST ONE ORDER. A budget with none is a cost sheet for nothing — and
   *  `budgetTotals` refuses its sales figure anyway, so saving one would create a
   *  document that can never leave draft. */
  orders: z.array(budgetOrderInput).min(1, "Add at least one garment order"),
  lines: z.array(budgetLineInput).default([]),
});

export type OrderBudgetInput = z.infer<typeof orderBudgetInput>;
export type BudgetLineInputT = z.infer<typeof budgetLineInput>;
export type BudgetOrderInputT = z.infer<typeof budgetOrderInput>;

/** A garment order a budget may pick up, with what it will sell for. */
export type BudgetableOrder = {
  id: string;
  sc_no: string | null;
  order_code: string | null;
  po_no: string | null;
  customer_name: string | null;
  delivery_date: string | null;
  /** From `orderValue()` — null when it refuses. */
  sales_value: number | null;
  sales_refusal: string | null;
  /** Which budget already covers it, if any. Advisory: two DRAFT budgets over
   *  one order is someone comparing two groupings, and only APPROVAL is refused
   *  (0428). */
  in_budget: { id: string; code: string | null; status: BudgetStatus } | null;
  /** The BOM figures this order can contribute, so the operator can see there is
   *  something to pull before opening the budget. */
  fabric_cost_lines: number;
  material_cost_lines: number;
};

/** A row of the approval queue (step 6). */
export type BudgetApprovalRow = {
  id: string;
  code: string | null;
  budget_date: string;
  description: string | null;
  status: BudgetStatus;
  order_count: number;
  line_count: number;
  submitted_at: string | null;
  decided_at: string | null;
  decision_remark: string | null;
  created_at: string;
  created_by: string | null;
};
