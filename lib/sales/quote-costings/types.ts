import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

// ============================================================================
// Sales ▸ Marketing ▸ Quote Preparation (costing sheet) — 0270 `quote_costings`.
// A flat garment costing: cost buckets (Fabric/Trims/CMT/Garment Process/Other
// Expenses) roll up to Gross → Waste% → Total → Margin% → FOB. Icon fields:
// Enquiry No → opportunities, Customer → buyers, Style No → garment_styles,
// Currency → currencies. Reuses the 'sales' permission.
// ============================================================================

export const QC_STATUSES = ["draft", "finalised"] as const;
export type QcStatus = (typeof QC_STATUSES)[number];

export const QC_STATUS_LABELS: Record<QcStatus, string> = {
  draft: "Draft",
  finalised: "Finalised",
};

export function qcStatusTone(status: QcStatus): StatusTone {
  return status === "finalised" ? "success" : "neutral";
}

export interface QuoteCosting {
  id: string;
  code: string | null;
  status: QcStatus;
  costing_date: string;
  opportunity_id: string | null;
  customer_id: string | null;
  style_id: string | null;
  currency_code: string | null;
  weight: number;
  fabric_cost: number;
  trims_cost: number;
  cmt_cost: number;
  garment_process_cost: number;
  other_expenses: number;
  gross_cost: number;
  garment_waste_pct: number;
  garment_waste_amt: number;
  total_cost: number;
  margin_pct: number;
  fob_value: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // embedded for display
  opportunity?: { id: string; code: string | null } | null;
  customer?: { id: string; code: string | null; name: string } | null;
  style?: { id: string; code: string | null; style_name: string | null } | null;
}

/**
 * The single source of truth for the costing roll-up — used by the client for
 * live preview AND re-run server-side on save so the stored totals can't drift
 * from the buckets. Margin is applied on cost: FOB = Total × (1 + margin%).
 */
export function computeRollup(input: {
  fabric_cost: number;
  trims_cost: number;
  cmt_cost: number;
  garment_process_cost: number;
  other_expenses: number;
  garment_waste_pct: number;
  margin_pct: number;
}): { gross_cost: number; garment_waste_amt: number; total_cost: number; fob_value: number } {
  const num = (v: number) => (Number.isFinite(v) ? v : 0);
  const gross_cost =
    num(input.fabric_cost) +
    num(input.trims_cost) +
    num(input.cmt_cost) +
    num(input.garment_process_cost) +
    num(input.other_expenses);
  const garment_waste_amt = gross_cost * (num(input.garment_waste_pct) / 100);
  const total_cost = gross_cost + garment_waste_amt;
  const fob_value = total_cost * (1 + num(input.margin_pct) / 100);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return {
    gross_cost: r2(gross_cost),
    garment_waste_amt: r2(garment_waste_amt),
    total_cost: r2(total_cost),
    fob_value: r2(fob_value),
  };
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);
const num = z.coerce.number().default(0);

export const quoteCostingInput = z.object({
  status: z.enum(QC_STATUSES).default("draft"),
  costing_date: z.string().min(1, "Costing date is required"),
  opportunity_id: uuidN,
  customer_id: uuidN,
  style_id: uuidN,
  currency_code: nullableText,
  weight: num,
  fabric_cost: num,
  trims_cost: num,
  cmt_cost: num,
  garment_process_cost: num,
  other_expenses: num,
  garment_waste_pct: num,
  margin_pct: num,
  notes: nullableText,
});
export type QuoteCostingInput = z.infer<typeof quoteCostingInput>;
