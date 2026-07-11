import type { StatusTone } from "@/components/ui/status-pill";

/** Approval decision states for a Garment Order Amendment (migration 0129). */
export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export function approvalStatusTone(s: ApprovalStatus): StatusTone {
  switch (s) {
    case "approved":
      return "success";
    case "rejected":
      return "danger";
    case "pending":
    default:
      return "warning";
  }
}

export function approvalStatusLabel(s: ApprovalStatus): string {
  switch (s) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "pending":
    default:
      return "Pending";
  }
}

/**
 * One row of the "Approve Amendment" queue — the Garment Order Amendment header
 * columns the legacy grid shows, plus the embedded lookups it displays. Kept
 * decoupled from lib/orders/amendments/types.ts (concurrently owned) so this
 * screen defines only what it reads.
 */
export interface ApprovalQueueRow {
  id: string;
  code: string | null; // "Amendment No" (GOA-0001)
  amend_date: string; // "Amended Dt"
  po_no: string | null; // "Order No"
  delivery_date: string | null; // "Delivery Dt"
  ship_mode: string | null;
  currency_code: string | null;
  pay_mode: string | null;
  reason_text: string | null; // "Reason"
  approval_status: ApprovalStatus;
  approved_at: string | null;
  approval_reason: string | null;

  sales_order: { id: string; order_number: string | null; ship_date: string | null; order_qty: number | null } | null;
  buyer: { id: string; code: string | null; name: string } | null;
  ship_type: { name: string | null } | null;
  approver: { id: string; full_name: string | null } | null;
  creator: { full_name: string | null } | null;
}
