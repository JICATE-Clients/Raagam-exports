import { z } from "zod";

// ============================================================================
// Account Heads — Associates master (0250). Legacy EDP2 "Account Head" form
// (ledger account heads): Short Name · Blocked · Name (required) · Group Under
// [If Debits · If Credits] · Cost head. A flat (single-row) master — no grid.
//
// Picker FKs: debit_group_id / credit_group_id → account_groups (0244);
// cost_head_id → cost_heads (0119).
// ============================================================================

export interface AccountHead {
  id: string;
  short_name: string | null;
  name: string;
  blocked: boolean;
  debit_group_id: string | null;
  credit_group_id: string | null;
  cost_head_id: string | null;
  created_at: string;
  updated_at: string;
}

const nullableText = z.string().optional().nullable();
const uuidN = z.string().uuid().nullable().default(null);

export const accountHeadInput = z.object({
  short_name: nullableText,
  name: z.string().min(1, "Name is required"),
  blocked: z.boolean().default(false),
  debit_group_id: uuidN,
  credit_group_id: uuidN,
  cost_head_id: uuidN,
});
export type AccountHeadInput = z.infer<typeof accountHeadInput>;
