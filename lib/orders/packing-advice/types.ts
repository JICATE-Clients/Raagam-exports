import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

// ============================================================================
// Garment Orders ▸ Packing List Advice (0033 header/lines, extended to the
// legacy screen in 0130). A header (Customer / Consignee / Warehouse + Carton
// numbering) plus a "Packing List" detail grid where the order (SC No) is chosen
// PER LINE. Icon fields: Customer → buyers, Consignee → consignees, Warehouse →
// config_lookups (kind warehouse), SC No → sales_orders, Country → countries,
// Unit → uoms. Reuses the 'orders' permission.
// ============================================================================

// "Carton SlNo.By" ▼ — the legacy dropdown (exact option list unconfirmed; the
// screenshot shows "Packing List" selected). Logged in doc/masters-open-questions.md.
export const CARTON_SLNO_BY = ["Packing List", "Assortment", "Manual"] as const;

// "Assort Type" ▼ on each line — the screenshot shows "Solid Pack - Solid…"
// (full list not legible). Logged as an open question.
export const ASSORT_TYPES = ["Solid Pack", "Assorted Pack", "Ratio Pack"] as const;

export const PLA_STATUSES = ["draft", "finalised", "cancelled"] as const;
export type PlaStatus = (typeof PLA_STATUSES)[number];

export const PLA_STATUS_LABELS: Record<PlaStatus, string> = {
  draft: "Draft",
  finalised: "Finalised",
  cancelled: "Cancelled",
};

export function plaStatusTone(status: PlaStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "finalised":
      return "success";
    case "cancelled":
      return "danger";
  }
}

export interface PackingAdviceLine {
  id: string;
  advice_id: string;
  sort_order: number;
  ctn_from: string | null;
  ctn_to: string | null;
  ctns: number;
  sc_no_id: string | null;
  po_no: string | null;
  country_id: string | null;
  ref_no: string | null;
  assort_type: string | null;
  customer_order_no: string | null;
  multiple_pack: boolean;
  qty_per_ctn: number;
  total_qty: number;
  unit_id: string | null;
  measurement: string | null;
  // embedded for display
  sc_no?: { id: string; order_number: string | null } | null;
}

export interface PackingAdvice {
  id: string;
  code: string | null;
  advice_date: string;
  reference: string | null;
  carton_slno_by: string | null;
  customer_id: string | null;
  consignee_id: string | null;
  ctns_total: number;
  qty_total: number;
  warehouse_id: string | null;
  warehouse_address: string | null;
  status: PlaStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // embedded for display / edit
  customer?: { id: string; code: string | null; name: string } | null;
  consignee?: { id: string; code: string | null; name: string } | null;
  lines: PackingAdviceLine[];
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);
const num = z.coerce.number().default(0);

export const packingLineInput = z.object({
  sort_order: z.coerce.number().int().nonnegative().default(0),
  ctn_from: nullableText,
  ctn_to: nullableText,
  ctns: num,
  sc_no_id: uuidN,
  po_no: nullableText,
  country_id: uuidN,
  ref_no: nullableText,
  assort_type: nullableText,
  customer_order_no: nullableText,
  multiple_pack: z.boolean().default(false),
  qty_per_ctn: num,
  total_qty: num,
  unit_id: uuidN,
  measurement: nullableText,
});
export type PackingLineInput = z.infer<typeof packingLineInput>;

export const packingAdviceInput = z.object({
  status: z.enum(PLA_STATUSES).default("draft"),
  advice_date: z.string().min(1, "Date is required"),
  reference: nullableText,
  carton_slno_by: nullableText,
  customer_id: uuidN,
  consignee_id: uuidN,
  ctns_total: num,
  qty_total: num,
  warehouse_id: uuidN,
  warehouse_address: nullableText,
  lines: z.array(packingLineInput).default([]),
});
export type PackingAdviceInput = z.infer<typeof packingAdviceInput>;
