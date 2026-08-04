import { z } from "zod";
import type { RejectionAllowanceType } from "./rejection-rule";

// ============================================================================
// Garment Rejection Rules — System master-detail (0264). Legacy EDP2 "Garment
// rejection rule" form: header (auto Entry No · Effective From · Rule · Inactive)
// + a Details child grid (S No · Range · From · To · Rejection Allowance).
// ============================================================================

export interface GarmentRejectionRuleLine {
  id: string;
  rule_id: string;
  sno: number;
  /** Free-text caption for the band ("1 TO 15"). NEVER parsed — from/to decide. */
  range_label: string | null;
  /** Inclusive bounds of the ORDER QUANTITY this tier covers. `to_value` null
   *  means unbounded, which is how "101 and above" is entered. */
  from_value: number | null;
  to_value: number | null;
  rejection_allowance: number | null;
  /** What the allowance MEANS — extra pieces, or a share of the order (0389).
   *  Without it a rule mixing "+3 pieces" and "+8%" could not be computed from
   *  at all, which is why the tiers sat unused from 0264 until 2026-08-04. */
  allowance_type: RejectionAllowanceType;
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
  // Defaulted rather than required: `lib/data-io` parses imports with this same
  // schema and an older sheet has no such column. It matches the DB default, so
  // an import lands the commoner of the two rather than failing.
  allowance_type: z.enum(["flat", "percent"]).default("percent"),
});

export const garmentRejectionRuleInput = z.object({
  effective_from: z.string().min(1, "Effective From is required"),
  rule: z.string().min(1, "Rule is required"),
  inactive: z.boolean().default(false),
  lines: z.array(garmentRejectionRuleLineInput).default([]),
});
export type GarmentRejectionRuleInput = z.infer<typeof garmentRejectionRuleInput>;
