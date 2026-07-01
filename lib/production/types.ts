import { z } from "zod";

export const PRODUCTION_STAGES = ["cutting", "sewing", "packing"] as const;
export type ProductionStage = (typeof PRODUCTION_STAGES)[number];

export const STAGE_LABELS: Record<ProductionStage, string> = {
  cutting: "Cutting",
  sewing: "Sewing",
  packing: "Packing",
};

export const ENTRY_STATUSES = ["recorded", "confirmed"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const LINE_TYPES = ["cutting", "sewing", "packing", "general"] as const;
export type LineType = (typeof LINE_TYPES)[number];

/** Map a stage to the T&A milestone name it should complete (best-effort). */
export const STAGE_MILESTONE: Record<ProductionStage, string> = {
  cutting: "Cutting",
  sewing: "Sewing",
  packing: "Finishing & Packing",
};

export interface ProductionLine {
  id: string;
  code: string;
  name: string;
  location_id: string | null;
  line_type: LineType;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProductionEntry {
  id: string;
  sales_order_id: string;
  stage: ProductionStage;
  line_id: string | null;
  entry_date: string;
  color: string | null;
  size: string | null;
  good_qty: number;
  reject_qty: number;
  is_rework: boolean;
  status: EntryStatus;
  note: string | null;
  recorded_by: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Per-stage confirmed totals for an order (drives the progress view). */
export interface StageProgress {
  stage: ProductionStage;
  good: number;
  reject: number;
}

// ---------- input schemas ----------
export const productionEntryInput = z.object({
  sales_order_id: z.string().uuid(),
  stage: z.enum(PRODUCTION_STAGES),
  line_id: z.string().uuid().optional().nullable(),
  entry_date: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  good_qty: z.coerce.number().int().nonnegative().default(0),
  reject_qty: z.coerce.number().int().nonnegative().default(0),
  is_rework: z.boolean().default(false),
  note: z.string().optional().nullable(),
});
export type ProductionEntryInput = z.infer<typeof productionEntryInput>;

export const productionLineInput = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  line_type: z.enum(LINE_TYPES).default("sewing"),
  location_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().default(true),
});
export type ProductionLineInput = z.infer<typeof productionLineInput>;

/** Sewing output is recorded by a supervisor then CONFIRMED by a manager. */
export function isConfirmable(entry: Pick<ProductionEntry, "status">): boolean {
  return entry.status === "recorded";
}

/** Sum confirmed good/reject per stage. */
export function summariseProgress(
  entries: Pick<ProductionEntry, "stage" | "good_qty" | "reject_qty" | "status">[],
): StageProgress[] {
  return PRODUCTION_STAGES.map((stage) => {
    const rows = entries.filter(
      (e) => e.stage === stage && e.status === "confirmed",
    );
    return {
      stage,
      good: rows.reduce((s, e) => s + e.good_qty, 0),
      reject: rows.reduce((s, e) => s + e.reject_qty, 0),
    };
  });
}
