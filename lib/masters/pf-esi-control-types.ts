import { z } from "zod";

// ============================================================================
// PF ESI Control — HR master (0261). Legacy EDP2 "PF ESI Control" form: a dated
// rate-version record — Entry No (auto) · Date · Effective From · Employee
// (PF % · ESI %) · Employer (PF % · ESI %). Flat, no children.
// ============================================================================

export interface PfEsiControl {
  id: string;
  entry_no: number;
  entry_date: string;
  effective_from: string;
  emp_pf_pct: number;
  emp_esi_pct: number;
  empr_pf_pct: number;
  empr_esi_pct: number;
  created_at: string;
  updated_at: string;
}

const pct = z.coerce.number().min(0).max(100).default(0);

export const pfEsiControlInput = z.object({
  entry_date: z.string().min(1, "Date is required"),
  effective_from: z.string().min(1, "Effective From is required"),
  emp_pf_pct: pct,
  emp_esi_pct: pct,
  empr_pf_pct: pct,
  empr_esi_pct: pct,
});
export type PfEsiControlInput = z.infer<typeof pfEsiControlInput>;
