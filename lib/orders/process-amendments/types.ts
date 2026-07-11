import { z } from "zod";

// ============================================================================
// Garment Process Amendment (0127) — header + two identical style grids on the
// "Component Process" and "Garment Process" tabs.
// ============================================================================

export const GPA_TABS = ["component", "garment"] as const;
export type GpaTab = (typeof GPA_TABS)[number];

export interface GpaLine {
  id: string;
  doc_id: string;
  tab: GpaTab;
  sno: number;
  style_id: string | null;
}

export interface GarmentProcessAmendment {
  id: string;
  code: string | null;
  amend_date: string;
  customer_id: string | null;
  sales_order_id: string | null;
  amend_sno: number | null;
  order_no: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // embedded for display
  customer?: { id: string; name: string } | null;
  sales_order?: { id: string; order_number: string | null } | null;
  lines: GpaLine[];
}

const uuidN = z.string().uuid().nullable().default(null);
const nullableText = z.string().optional().nullable();

export const gpaLineInput = z.object({
  tab: z.enum(GPA_TABS),
  sno: z.coerce.number().int().nonnegative().default(0),
  style_id: uuidN,
});

export const gpaInput = z.object({
  amend_date: z.string().min(1, "Date is required"),
  customer_id: uuidN,
  sales_order_id: uuidN,
  amend_sno: z.coerce.number().int().nullable().default(null),
  order_no: nullableText,
  lines: z.array(gpaLineInput).default([]),
});
export type GpaInput = z.infer<typeof gpaInput>;
