import { z } from "zod";

// ============================================================================
// Levies — tax/levy master (0221). Legacy EDP2 "Levy" form: header with a Type
// that drives which rate components apply, each carrying a rate + an account
// head (→ chart of accounts). Intra-State uses CGST+SGST; Inter-State uses IGST.
// ============================================================================

// NOTE: provisional — the legacy Type dropdown may list more than these two.
// Extend this constant (no DB check constraint) once confirmed.
export const LEVY_TYPES = ["GST Intra State", "GST Inter State"] as const;
export type LevyType = (typeof LEVY_TYPES)[number];

export const CESS_MODES = ["percent", "amount"] as const;
export type CessMode = (typeof CESS_MODES)[number];

/** Which rate components a Type activates (the rest are shown disabled). */
export function activeComponents(type: string): {
  cgst: boolean;
  sgst: boolean;
  igst: boolean;
} {
  const inter = type === "GST Inter State";
  return { cgst: !inter, sgst: !inter, igst: inter };
}

export interface Levy {
  id: string;
  entry_no: number;
  levy_date: string;
  type: string;
  effective_from: string;
  cgst_pct: number;
  cgst_ac_head: string | null;
  sgst_pct: number;
  sgst_ac_head: string | null;
  igst_pct: number;
  igst_ac_head: string | null;
  cess_mode: CessMode;
  cess_value: number;
  cess_ac_head: string | null;
  description: string | null;
  blocked: boolean;
  created_at: string;
  updated_at: string;
}

const acHead = z.string().uuid().nullable().default(null);
const pct = z.coerce.number().min(0).max(100).default(0);

export const levyInput = z.object({
  levy_date: z.string().min(1, "Date is required"),
  type: z.enum(LEVY_TYPES),
  effective_from: z.string().min(1, "Effective From is required"),
  cgst_pct: pct,
  cgst_ac_head: acHead,
  sgst_pct: pct,
  sgst_ac_head: acHead,
  igst_pct: pct,
  igst_ac_head: acHead,
  cess_mode: z.enum(CESS_MODES).default("percent"),
  cess_value: z.coerce.number().min(0).default(0),
  cess_ac_head: acHead,
  description: z.string().optional().nullable(),
  blocked: z.boolean().default(false),
});
export type LevyInput = z.infer<typeof levyInput>;
