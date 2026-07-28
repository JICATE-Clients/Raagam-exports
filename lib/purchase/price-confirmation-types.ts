import { z } from "zod";

export const PC_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
export type PcStatus = (typeof PC_STATUSES)[number];

export const PC_STATUS_LABELS: Record<PcStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

export const APPLICABILITY_TYPES = ["T", "E", "U"] as const;
export type ApplicabilityType = (typeof APPLICABILITY_TYPES)[number];

export const APPLICABILITY_LABELS: Record<ApplicabilityType, string> = {
  T: "This Order Only",
  E: "Effective Upto Date",
  U: "Until Further Notice",
};

export interface PriceConfirmation {
  id: string;
  code: string | null;
  vendor_id: string;
  po_type: string | null;
  status: PcStatus;
  applicability: ApplicabilityType | null;
  effective_until: string | null;
  notes: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PriceConfirmationItem {
  id: string;
  price_confirmation_id: string;
  item_id: string | null;
  item_class: string | null;
  category: string | null;
  description: string | null;
  budget_rate: number;
  quoted_rate: number;
  confirmed_rate: number;
  is_approved: boolean;
  previous_confirmed_rate: number | null;
  development_charges: number;
  remarks: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export const priceConfirmationInput = z.object({
  vendor_id: z.string().uuid(),
  po_type: z.string().optional().nullable(),
  applicability: z.enum(APPLICABILITY_TYPES).optional().nullable(),
  effective_until: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type PriceConfirmationInput = z.infer<typeof priceConfirmationInput>;

export const priceConfirmationItemInput = z.object({
  price_confirmation_id: z.string().uuid(),
  item_id: z.string().uuid().optional().nullable(),
  item_class: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  budget_rate: z.coerce.number().nonnegative().default(0),
  quoted_rate: z.coerce.number().nonnegative().default(0),
  confirmed_rate: z.coerce.number().nonnegative().default(0),
  is_approved: z.boolean().default(false),
  previous_confirmed_rate: z.coerce.number().optional().nullable(),
  development_charges: z.coerce.number().nonnegative().default(0),
  remarks: z.string().optional().nullable(),
  sort_order: z.coerce.number().int().default(0),
});
export type PriceConfirmationItemInput = z.infer<typeof priceConfirmationItemInput>;
