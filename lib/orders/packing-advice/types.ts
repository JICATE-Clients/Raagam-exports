import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

// ============================================================================
// Orders ▸ Order Execution ▸ Packing List Advice — rebuilt 2026-09-18 (0579)
// to doc/order/packing list.md.
//
// ONE order (RE No), ONE destination, and a grid of carton ranges. Style,
// colour and destination are all read FROM the order, so the order sits on the
// header — 0130's per-line order made that impossible and is gone.
// Reuses the 'orders' permission.
// ============================================================================

/** The spec's two packing methods. Stored keys are the spec's own enum. */
export const ASSORTMENT_TYPES = ["solid_size", "ratio_mixed"] as const;
export type AssortmentType = (typeof ASSORTMENT_TYPES)[number];

export const ASSORTMENT_TYPE_LABELS: Record<AssortmentType, string> = {
  solid_size: "Solid Size",
  ratio_mixed: "Ratio / Mixed",
};

export const isAssortmentType = (v: unknown): v is AssortmentType =>
  typeof v === "string" && (ASSORTMENT_TYPES as readonly string[]).includes(v);

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
  /** BY VALUE — the order's own key for a style, as every order child uses. */
  style_ref_no: string;
  /** The colour / shade, BY VALUE — one of the style's combos. */
  combo: string;
  from_carton_no: number;
  to_carton_no: number;
  /** Generated: to − from + 1. */
  total_cartons: number;
  assortment_type: AssortmentType;
  pcs_per_carton: number;
  /** Generated: total_cartons × pcs_per_carton. */
  line_total_pcs: number;
  /** One carton's size. CBM is derived (`cbm.ts`), never stored. */
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  /** One carton's weights, KG. NULL = not weighed yet, never 0. */
  gross_weight: number | null;
  net_weight: number | null;
}

export interface PackingAdvice {
  id: string;
  code: string | null;
  advice_date: string;
  customer_id: string;
  sales_order_id: string;
  country_id: string;
  location_id: string;
  remarks: string | null;
  status: PlaStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // embedded for display
  customer?: { id: string; name: string } | null;
  sales_order?: { id: string; order_number: string | null } | null;
  country?: { id: string; name: string } | null;
  lines: PackingAdviceLine[];
}

const text = z.string().trim();
/** Blank → null, never 0: an unmeasured carton is not a zero-size one. */
const numN = z.coerce.number().nullable().default(null);

export const packingLineInput = z.object({
  style_ref_no: text.min(1, "Style is required"),
  combo: text.min(1, "Colour is required"),
  from_carton_no: z.coerce.number().int("Ctn From must be a whole number").min(1, "Ctn From starts at 1"),
  to_carton_no: z.coerce.number().int("Ctn To must be a whole number").min(1, "Ctn To starts at 1"),
  assortment_type: z.enum(ASSORTMENT_TYPES, { message: "Assortment Type is required" }),
  pcs_per_carton: z.coerce.number().int("Pcs / Ctn must be a whole number").positive("Pcs / Ctn must be more than 0"),
  length_cm: numN,
  width_cm: numN,
  height_cm: numN,
  gross_weight: numN,
  net_weight: numN,
});
export type PackingLineInput = z.infer<typeof packingLineInput>;

export const packingAdviceInput = z.object({
  status: z.enum(PLA_STATUSES).default("draft"),
  advice_date: z.string().min(1, "Date is required"),
  customer_id: z.string().uuid("Customer is required"),
  sales_order_id: z.string().uuid("RE No is required"),
  country_id: z.string().uuid("Destination is required"),
  remarks: z.string().trim().nullable().default(null),
  lines: z.array(packingLineInput).min(1, "Add at least one carton line"),
});
export type PackingAdviceInput = z.infer<typeof packingAdviceInput>;
