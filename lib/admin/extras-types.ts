import { z } from "zod";

// ============================================================================
// Assets (0216)
// ============================================================================
export const ASSET_STATUSES = ["active", "assigned", "retired", "disposed"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  active: "Active",
  assigned: "Assigned",
  retired: "Retired",
  disposed: "Disposed",
};
export interface Asset {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  asset_group: string | null;
  location_id: string | null;
  status: AssetStatus;
  purchase_date: string | null;
  value: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface AssetAssignment {
  id: string;
  asset_id: string;
  assignee_name: string;
  department: string | null;
  assigned_date: string | null;
  returned_date: string | null;
  status: "assigned" | "returned";
  notes: string | null;
  created_by: string | null;
  created_at: string;
}
export const assetInput = z.object({
  name: z.string().min(1),
  category: z.string().optional().nullable(),
  asset_group: z.string().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  purchase_date: z.string().optional().nullable(),
  value: z.coerce.number().nonnegative().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type AssetInput = z.infer<typeof assetInput>;
export const assetAssignmentInput = z.object({
  assignee_name: z.string().min(1),
  department: z.string().optional().nullable(),
  assigned_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type AssetAssignmentInput = z.infer<typeof assetAssignmentInput>;

// ============================================================================
// Couriers (0217)
// ============================================================================
export interface Courier {
  id: string;
  code: string | null;
  name: string;
  contact_person: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export const courierInput = z.object({
  name: z.string().min(1),
  contact_person: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
});
export type CourierInput = z.infer<typeof courierInput>;

export const COURIER_DESPATCH_STATUSES = ["draft", "despatched", "delivered", "cancelled"] as const;
export type CourierDespatchStatus = (typeof COURIER_DESPATCH_STATUSES)[number];
export const COURIER_DESPATCH_STATUS_LABELS: Record<CourierDespatchStatus, string> = {
  draft: "Draft",
  despatched: "Despatched",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
export interface CourierDespatch {
  id: string;
  code: string | null;
  courier_id: string | null;
  reference: string | null;
  despatch_date: string | null;
  destination: string | null;
  contents: string | null;
  invoice_no: string | null;
  invoice_amount: number | null;
  pod_reference: string | null;
  pod_date: string | null;
  status: CourierDespatchStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export const courierDespatchInput = z.object({
  courier_id: z.string().uuid().optional().nullable(),
  reference: z.string().optional().nullable(),
  despatch_date: z.string().optional().nullable(),
  destination: z.string().optional().nullable(),
  contents: z.string().optional().nullable(),
  invoice_no: z.string().optional().nullable(),
  invoice_amount: z.coerce.number().nonnegative().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type CourierDespatchInput = z.infer<typeof courierDespatchInput>;
