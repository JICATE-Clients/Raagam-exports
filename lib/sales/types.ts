import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

export const OPPORTUNITY_STAGES = [
  "enquiry",
  "costing",
  "quoted",
  "won",
  "lost",
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const FABRIC_TYPES = ["woven", "circular", "flat_knit"] as const;
export const FABRIC_SUBTYPES = ["solid", "yarn_dyed", "melange"] as const;

/** Sample types (shared by samples + the Define Styles "Sample Type" column). */
export const SAMPLE_TYPES = ["proto", "fit", "sms", "pp", "top"] as const;
export type SampleType = (typeof SAMPLE_TYPES)[number];

export const SAMPLE_STATUSES = [
  "requested",
  "in_progress",
  "sent",
  "approved",
  "rejected",
] as const;
export type SampleStatus = (typeof SAMPLE_STATUSES)[number];

export const COST_SHEET_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "superseded",
] as const;
export type CostSheetStatus = (typeof COST_SHEET_STATUSES)[number];

export const COST_CATEGORIES = [
  "material",
  "labour",
  "overhead",
  "other",
] as const;

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "rejected"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
};

export function quoteStatusTone(status: QuoteStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "sent":
      return "info";
    case "accepted":
      return "success";
    case "rejected":
      return "danger";
  }
}

export interface Opportunity {
  id: string;
  code: string | null;
  buyer_id: string;
  title: string;
  season: string | null;
  stage: OpportunityStage;
  target_fob: number | null;
  currency_code: string | null;
  owner_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Style {
  id: string;
  opportunity_id: string;
  style_code: string | null;
  name: string;
  fabric_type: (typeof FABRIC_TYPES)[number] | null;
  fabric_subtype: (typeof FABRIC_SUBTYPES)[number] | null;
  description: string | null;
  image_url: string | null;
  // Define Styles (legacy "By Enquiry No.") extras — see migration 0268.
  action: string | null;
  sample_type: SampleType | null;
  composition: string | null;
  sample_qty: number | null;
  unit_id: string | null;
  specs: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CostSheet {
  id: string;
  opportunity_id: string;
  style_id: string | null;
  version: number;
  status: CostSheetStatus;
  currency_code: string | null;
  target_fob: number | null;
  computed_fob: number;
  margin_pct: number | null;
  notes: string | null;
  parent_cost_sheet_id: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CostSheetItem {
  id: string;
  cost_sheet_id: string;
  category: (typeof COST_CATEGORIES)[number];
  description: string;
  quantity: number;
  uom_id: string | null;
  unit_cost: number;
  amount: number;
  sort_order: number;
}

export interface Quote {
  id: string;
  code: string | null;
  opportunity_id: string;
  cost_sheet_id: string | null;
  buyer_id: string;
  fob_price: number;
  currency_code: string | null;
  quantity: number | null;
  incoterm: string | null;
  include_sample: boolean;
  status: QuoteStatus;
  valid_until: string | null;
  sent_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Sample {
  id: string;
  code: string | null;
  opportunity_id: string;
  style_id: string | null;
  quote_id: string | null;
  type: SampleType;
  status: SampleStatus;
  // Legacy "By Sample No." fields — see migration 0272.
  sample_qty: number | null;
  unit_id: string | null;
  delivery_date: string | null;
  customer_reference: string | null;
  dispatched_at: string | null;
  courier_ref: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const sampleInput = z.object({
  opportunity_id: z.string().uuid(),
  style_id: z.string().uuid().optional().nullable(),
  quote_id: z.string().uuid().optional().nullable(),
  type: z.enum(SAMPLE_TYPES),
  status: z.enum(SAMPLE_STATUSES).default("requested"),
  sample_qty: z.coerce.number().nonnegative().optional().nullable(),
  unit_id: z.string().uuid().optional().nullable(),
  delivery_date: z.string().optional().nullable(),
  customer_reference: z.string().optional().nullable(),
  courier_ref: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type SampleInput = z.infer<typeof sampleInput>;

// ---------- input schemas ----------
export const opportunityInput = z.object({
  buyer_id: z.string().uuid(),
  title: z.string().min(1),
  season: z.string().optional().nullable(),
  stage: z.enum(OPPORTUNITY_STAGES).default("enquiry"),
  target_fob: z.coerce.number().nonnegative().optional().nullable(),
  currency_code: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type OpportunityInput = z.infer<typeof opportunityInput>;

/**
 * Bulk "Create opportunities — By Customer": pick many buyers, create one
 * opportunity each. Title/currency are derived per-buyer server-side; `season`
 * (optional) is applied to every created opportunity.
 */
export const bulkOpportunityInput = z.object({
  buyer_ids: z.array(z.string().uuid()).min(1),
  season: z.string().optional().nullable(),
});
export type BulkOpportunityInput = z.infer<typeof bulkOpportunityInput>;

export const styleInput = z.object({
  opportunity_id: z.string().uuid(),
  style_code: z.string().optional().nullable(),
  name: z.string().min(1),
  fabric_type: z.enum(FABRIC_TYPES).optional().nullable(),
  fabric_subtype: z.enum(FABRIC_SUBTYPES).optional().nullable(),
  description: z.string().optional().nullable(),
  image_url: z.string().optional().nullable(),
  // Define Styles extras
  action: z.string().optional().nullable(),
  sample_type: z.enum(SAMPLE_TYPES).optional().nullable(),
  composition: z.string().optional().nullable(),
  sample_qty: z.coerce.number().nonnegative().optional().nullable(),
  unit_id: z.string().uuid().optional().nullable(),
});
export type StyleInput = z.infer<typeof styleInput>;

/** Sales-side "Product Development Request — By Sample No." form. Writes into
 *  Planning's `pd_requests` (via admin client); extra fields added in 0270. */
export const pdRequestFormInput = z.object({
  opportunity_id: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  style_id: z.string().uuid().optional().nullable(),
  sample_type: z.enum(SAMPLE_TYPES).optional().nullable(),
  sample_qty: z.coerce.number().nonnegative().optional().nullable(),
  unit_id: z.string().uuid().optional().nullable(),
  delivery_date: z.string().optional().nullable(),
  customer_reference: z.string().optional().nullable(),
});
export type PdRequestFormInput = z.infer<typeof pdRequestFormInput>;

export const costSheetItemInput = z.object({
  category: z.enum(COST_CATEGORIES).default("material"),
  description: z.string().min(1),
  quantity: z.coerce.number().nonnegative().default(0),
  uom_id: z.string().uuid().optional().nullable(),
  unit_cost: z.coerce.number().nonnegative().default(0),
  sort_order: z.coerce.number().int().default(0),
});
export type CostSheetItemInput = z.infer<typeof costSheetItemInput>;

export const costSheetInput = z.object({
  opportunity_id: z.string().uuid(),
  style_id: z.string().uuid().optional().nullable(),
  currency_code: z.string().optional().nullable(),
  target_fob: z.coerce.number().nonnegative().optional().nullable(),
  margin_pct: z.coerce.number().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(costSheetItemInput).default([]),
});
export type CostSheetInput = z.infer<typeof costSheetInput>;

export const quoteInput = z.object({
  opportunity_id: z.string().uuid(),
  cost_sheet_id: z.string().uuid().optional().nullable(),
  buyer_id: z.string().uuid(),
  fob_price: z.coerce.number().nonnegative(),
  currency_code: z.string().optional().nullable(),
  quantity: z.coerce.number().nonnegative().optional().nullable(),
  incoterm: z.string().default("FOB"),
  include_sample: z.boolean().default(false),
  valid_until: z.string().optional().nullable(),
});
export type QuoteInput = z.infer<typeof quoteInput>;

/** FOB = sum of cost-sheet item amounts (amount = quantity * unit_cost). */
export function computeFob(
  items: Pick<CostSheetItemInput, "quantity" | "unit_cost">[],
): number {
  return items.reduce((sum, i) => sum + i.quantity * i.unit_cost, 0);
}
