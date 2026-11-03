import { z } from "zod";
import { capsName, capsTextNullable } from "@/lib/validation/formats";

// ============================================================================
// Department Return (0795) — unused / excess material a department gives back
// to the store, always against an ISSUED Material Requisition Slip.
// ============================================================================
export const DEPARTMENT_RETURN_STATUSES = ["draft", "posted", "cancelled"] as const;
export type DepartmentReturnStatus = (typeof DEPARTMENT_RETURN_STATUSES)[number];
export const DEPARTMENT_RETURN_STATUS_LABELS: Record<DepartmentReturnStatus, string> = {
  draft: "Draft",
  posted: "Posted",
  cancelled: "Cancelled",
};

export interface DepartmentReturn {
  id: string;
  code: string | null;
  material_requisition_id: string;
  store_id: string;
  department: string;
  return_date: string;
  reason: string;
  notes: string | null;
  status: DepartmentReturnStatus;
  posted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DepartmentReturnLine {
  id: string;
  return_id: string;
  mrs_line_id: string;
  item_id: string;
  return_qty: number;
  bin_id: string | null;
  lot_no: string | null;
  sort_order: number;
  /** Joined for display (a posted return whose MRS is no longer offered still reads). */
  item_name?: string | null;
  bin_code?: string | null;
}

/** One line of an issued MRS, with what may still come back on it. */
export interface ReturnableMrsLine {
  mrs_line_id: string;
  item_id: string;
  item_name: string;
  item_code: string | null;
  issued_qty: number;
  /** Returns already POSTED against this line (drafts do not count — the DB re-checks at post). */
  returned_qty: number;
  returnable_qty: number;
}

/** An issued MRS the operator can return against. */
export interface ReturnableMrs {
  id: string;
  code: string | null;
  store_id: string;
  store_name: string | null;
  department: string;
  required_date: string | null;
  lines: ReturnableMrsLine[];
}

export const departmentReturnLineInput = z.object({
  mrs_line_id: z.string().uuid(),
  return_qty: z.coerce.number().positive("Return qty must be more than 0"),
  bin_id: z.string().uuid().optional().nullable(),
  lot_no: capsTextNullable(),
});
export type DepartmentReturnLineInput = z.input<typeof departmentReturnLineInput>;

export const departmentReturnInput = z.object({
  material_requisition_id: z.string().uuid("Pick an issued requisition"),
  return_date: z.string().min(1, "Return date is required"),
  reason: capsName("Reason is required"),
  notes: capsTextNullable(),
  lines: z.array(departmentReturnLineInput).min(1, "Enter a return qty on at least one line"),
});
export type DepartmentReturnInput = z.input<typeof departmentReturnInput>;
