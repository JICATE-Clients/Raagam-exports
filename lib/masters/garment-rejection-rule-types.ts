import { z } from "zod";

// ============================================================================
// Garment Rejection Rules — System master-detail (0264). Legacy EDP2 "Garment
// rejection rule" form: header (auto Entry No · Effective From · Rule · Inactive)
// + a Details child grid (S No · Range · From · To · Rejection Allowance).
// ============================================================================

export interface GarmentRejectionRuleLine {
  id: string;
  rule_id: string;
  sno: number;
  range_label: string | null;
  from_value: number | null;
  to_value: number | null;
  rejection_allowance: number | null;
}

export interface GarmentRejectionRule {
  id: string;
  entry_no: number;
  effective_from: string;
  rule: string | null;
  inactive: boolean;
  created_at: string;
  updated_at: string;
  lines: GarmentRejectionRuleLine[];
}

const nullableText = z.string().optional().nullable();
const nullableNum = z.coerce.number().nullable().default(null);

export const garmentRejectionRuleLineInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  range_label: nullableText,
  from_value: nullableNum,
  to_value: nullableNum,
  rejection_allowance: nullableNum,
});

export const garmentRejectionRuleInput = z.object({
  effective_from: z.string().min(1, "Effective From is required"),
  rule: z.string().min(1, "Rule is required"),
  inactive: z.boolean().default(false),
  lines: z.array(garmentRejectionRuleLineInput).default([]),
});
export type GarmentRejectionRuleInput = z.infer<typeof garmentRejectionRuleInput>;
