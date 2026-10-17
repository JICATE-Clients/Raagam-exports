import { z } from "zod";
import { capsName } from "@/lib/validation/formats";

// ============================================================================
// CMT Processes (0735) — the garment floor's own operations, grouped by the five
// production stages (Cutting ▸ Size Stickering, Sewing ▸ Singer …). A master of
// its own under Master Data ▸ Materials, NOT a kind of Process: a Process is a
// sub-contract process (user 2026-10-17, "CMT is separate process not inside
// process"). Sample Costing ▸ CMT operations picks from here, narrowed to the
// stage picked beside it; Embellishments stay on the Process master.
// ============================================================================

/** The five stages, in the floor's order — the order every stage list is drawn in. */
export const CMT_STAGES = ["cutting", "sewing", "checking", "ironing", "packing"] as const;
export type CmtStage = (typeof CMT_STAGES)[number];
export const CMT_STAGE_LABEL: Record<CmtStage, string> = {
  cutting: "Cutting",
  sewing: "Sewing",
  checking: "Checking",
  ironing: "Ironing",
  packing: "Packing",
};

export interface CmtProcess {
  id: string;
  name: string;
  cmt_stage: CmtStage;
  /** ₹ per piece, optional — pre-fills a costing line's blank rate, never binds it. */
  standard_rate: number | null;
  inactive: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string;
}

export const cmtProcessInput = z.object({
  name: capsName(),
  cmt_stage: z.enum(CMT_STAGES, { message: "Pick the production stage" }),
  standard_rate: z.coerce.number().nonnegative("Standard rate cannot be negative").nullable().optional(),
  inactive: z.boolean().optional(),
});
export type CmtProcessInput = z.infer<typeof cmtProcessInput>;
