import { z } from "zod";

// ============================================================================
// TA Approvals — the global Approvals Dictionary (doc/approval.md §2),
// promoted to a real Master Data screen (0542, client 2026-09-07: "this
// approvals ... need built in master module").
//
// The table (`ta_approvals`) predates this screen — it was seeded directly by
// migration on the unmerged `ta-approvals-engine` branch, with no admin UI at
// all. This file is the schema half of giving it one; nothing about the
// table's SHAPE changes for the screen's sake beyond `department` (0542) and
// the `short_name` uniqueness the screen's own dup-check now has something
// real to answer to.
// ============================================================================

export const TA_APPROVAL_CONDITIONS = ["AFTER_ORDER_DATE", "BEFORE_SHIPMENT_DATE"] as const;
export type TaApprovalCondition = (typeof TA_APPROVAL_CONDITIONS)[number];

export interface TaApproval {
  id: string;
  short_name: string;
  name: string;
  department: string;
  apply_condition: TaApprovalCondition;
  standard_days: number;
  sequence: number;
  requires_proof: boolean;
  is_active: boolean;
  created_at: string;
}

export const taApprovalInput = z.object({
  short_name: z.string().min(1, "Short name is required"),
  name: z.string().min(1, "Name is required"),
  department: z.string().min(1, "Department is required").default("MERCHANDISING"),
  apply_condition: z.enum(TA_APPROVAL_CONDITIONS),
  standard_days: z.coerce.number().int().min(0).default(0),
  sequence: z.coerce.number().int().min(0).default(0),
  requires_proof: z.boolean().default(true),
  is_active: z.boolean().default(true),
});
export type TaApprovalInput = z.infer<typeof taApprovalInput>;
