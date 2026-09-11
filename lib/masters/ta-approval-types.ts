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
//
// `short_name`, `department` and `sequence` were REMOVED FROM THIS SCREEN'S
// FORM (2026-09-11 spec): the approval Name already identifies the row,
// every approval is Merchandising in practice, and ordering is computed
// dynamically from T&A lead times rather than a static number. The COLUMNS
// stay — `short_name` is still what `lib/orders/amendments/service.ts`
// matches `ILIKE 'PPSAMPLE'` against to bridge PP Sample into the production
// ladder (see that file and `ta-approval-master-screen.tsx`'s own header),
// so it cannot become nullable or drop out of the row. `taApprovalInput` is
// now only the fields the operator actually enters; `createTaApproval` /
// `updateTaApproval` in `ta-approval-actions.ts` derive `short_name` from
// `name` and hardcode `department`/`sequence` server-side.
//
// `requires_proof` left the form too (2026-09-11, same client pass). The
// COLUMN stays for the same reason: `lib/ta/approvals-worklist-actions.ts`
// (`markApprovalSent`) reads it server-side to refuse "Mark Sent" without an
// attached proof file — a real enforcement gate, not a display flag. Every
// seeded row is `true`; `createTaApproval` hardcodes new rows the same way,
// and `updateTaApproval` never touches it on an existing row.
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
  name: z.string().min(1, "Name is required"),
  apply_condition: z.enum(TA_APPROVAL_CONDITIONS),
  standard_days: z.coerce.number().int().min(0).default(0),
  is_active: z.boolean().default(true),
});
export type TaApprovalInput = z.infer<typeof taApprovalInput>;
