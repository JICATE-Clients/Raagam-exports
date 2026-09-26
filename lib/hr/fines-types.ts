import { z } from "zod";
import type { StatusTone } from "@/lib/ui/tone";

/**
 * HR STAFF FINES & SALARY DEDUCTIONS (0629, doc/order/punishment fine.md).
 *
 * The database is the authority on every rule here — the lock, the amount a
 * calculated mode produces, who may approve. This file holds the vocabulary the
 * screen and the actions share, plus a PREVIEW of the calculated amount that is
 * only ever displayed: `hr_fine_guard` recomputes and stores the real figure.
 */

export const FINE_STATUSES = ["draft", "pending", "approved", "rejected", "abandoned"] as const;
export type FineStatus = (typeof FINE_STATUSES)[number];

export const FINE_STATUS_LABELS: Record<FineStatus, string> = {
  draft: "Draft",
  pending: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  abandoned: "Abandoned",
};

export const FINE_STATUS_TONES: Record<FineStatus, StatusTone> = {
  draft: "neutral",
  pending: "warning",
  approved: "success",
  rejected: "danger",
  abandoned: "neutral",
};

/** Direct = a flat amount; the other two derive it from the monthly salary. */
export const FINE_MODES = ["direct", "days", "percent"] as const;
export type FineMode = (typeof FINE_MODES)[number];

export const FINE_MODE_LABELS: Record<FineMode, string> = {
  direct: "Direct amount",
  days: "Days of pay",
  percent: "% of gross",
};

export const FINE_EVENT_LABELS: Record<string, string> = {
  initial_entry: "Initial entry",
  draft_edit: "Draft edited",
  manager_review: "Sent for manager review",
  approval: "Approved",
  rejection_revert: "Rejected — reverted",
  abandon_revert: "Abandoned — reverted",
  draft_deleted: "Draft deleted",
};

export interface HrFine {
  id: string;
  code: string | null;
  staff_id: string;
  staff_name: string | null;
  staff_code: string | null;
  incident_ref: string;
  incident_date: string;
  deduction_month: string;
  deduction_mode: FineMode;
  days_of_pay: number | null;
  pct_of_gross: number | null;
  basis_salary: number | null;
  fine_amount: number;
  status: FineStatus;
  is_submitted: boolean;
  remarks: string;
  decision_remark: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approver_name: string | null;
  approved_at: string | null;
  decided_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface FineEvent {
  id: string;
  change_type: string;
  from_status: string | null;
  to_status: string | null;
  fine_amount: number | null;
  actor_id: string | null;
  actor_name: string | null;
  remark: string | null;
  created_at: string;
}

export interface StaffOption {
  id: string;
  code: string | null;
  name: string;
  monthly_salary: number;
}

/**
 * The draft as the screen sends it. `fine_amount` is only read for `direct`;
 * for the calculated modes the database derives it and ignores what was sent.
 * `remarks` is trimmed-then-required, the same test as the table's CHECK.
 */
export const fineDraftInput = z
  .object({
    staff_id: z.string().uuid("Pick the staff member"),
    incident_ref: z.string().trim().min(1, "Incident reference is required"),
    incident_date: z.string().min(1, "Incident date is required"),
    deduction_month: z.string().regex(/^\d{4}-\d{2}$/, "Pick the deduction month"),
    deduction_mode: z.enum(FINE_MODES),
    fine_amount: z.coerce.number().optional().nullable(),
    days_of_pay: z.coerce.number().optional().nullable(),
    pct_of_gross: z.coerce.number().optional().nullable(),
    remarks: z.string().trim().min(1, "Remarks are mandatory — say why the fine is being raised"),
  })
  .superRefine((v, ctx) => {
    if (v.deduction_mode === "direct" && !(Number(v.fine_amount) > 0)) {
      ctx.addIssue({ code: "custom", path: ["fine_amount"], message: "The fine amount must be greater than zero" });
    }
    if (v.deduction_mode === "days" && !(Number(v.days_of_pay) > 0)) {
      ctx.addIssue({ code: "custom", path: ["days_of_pay"], message: "Days of pay must be greater than zero" });
    }
    if (v.deduction_mode === "percent") {
      const p = Number(v.pct_of_gross);
      if (!(p > 0 && p <= 100)) {
        ctx.addIssue({ code: "custom", path: ["pct_of_gross"], message: "Percentage must be between 0 and 100" });
      }
    }
  });
export type FineDraftInput = z.infer<typeof fineDraftInput>;

/** Days in the month of a `YYYY-MM` string. */
function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/**
 * THE PREVIEW — mirrors `hr_fine_guard` exactly (salary ÷ days-in-month × days;
 * salary × pct ÷ 100; rounded to paise). Displayed, never stored.
 */
export function previewFineAmount(args: {
  mode: FineMode;
  salary: number;
  month: string;
  amount?: number | null;
  days?: number | null;
  pct?: number | null;
}): number | null {
  const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  if (args.mode === "direct") return args.amount && args.amount > 0 ? round(args.amount) : null;
  if (!(args.salary > 0)) return null;
  if (args.mode === "days") {
    if (!(Number(args.days) > 0) || !/^\d{4}-\d{2}$/.test(args.month)) return null;
    return round((args.salary / daysInMonth(args.month)) * Number(args.days));
  }
  if (!(Number(args.pct) > 0)) return null;
  return round((args.salary * Number(args.pct)) / 100);
}
