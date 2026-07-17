import { z } from "zod";

// ============================================================================
// Default Account Heads — singleton config mapping default GL account heads
// for standard transaction types (discount, freight, insurance, etc.).
// All fields are nullable FK uuid references to account_heads.
// ============================================================================

export interface DefaultAccountHead {
  id: string;
  discount_ac_id: string | null;
  freight_ac_id: string | null;
  insurance_ac_id: string | null;
  agency_commission_ac_id: string | null;
  round_off_ac_id: string | null;
  exchange_gain_ac_id: string | null;
  exchange_loss_ac_id: string | null;
  qty_diff_ac_id: string | null;
  rate_diff_ac_id: string | null;
  created_at: string;
  updated_at: string;
}

const uuidN = z.string().uuid().nullable().default(null);

export const defaultAccountHeadInput = z.object({
  discount_ac_id: uuidN,
  freight_ac_id: uuidN,
  insurance_ac_id: uuidN,
  agency_commission_ac_id: uuidN,
  round_off_ac_id: uuidN,
  exchange_gain_ac_id: uuidN,
  exchange_loss_ac_id: uuidN,
  qty_diff_ac_id: uuidN,
  rate_diff_ac_id: uuidN,
});
export type DefaultAccountHeadInput = z.infer<typeof defaultAccountHeadInput>;
