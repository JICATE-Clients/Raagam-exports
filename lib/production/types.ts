import { z } from "zod";

// ORDER IS THE FLOOR FLOW, not alphabetical — `upstreamStage()` below reads
// "the stage before this one in the array" as the physical upstream
// department, so Checking/Ironing had to be inserted here at the right index
// (0539: they already exist as T&A activities between Sewing and Packing) and
// not just appended.
export const PRODUCTION_STAGES = [
  "cutting",
  "sewing",
  "checking",
  "ironing",
  "packing",
] as const;
export type ProductionStage = (typeof PRODUCTION_STAGES)[number];

export const STAGE_LABELS: Record<ProductionStage, string> = {
  cutting: "Cutting",
  sewing: "Sewing",
  checking: "Checking",
  ironing: "Ironing",
  packing: "Packing",
};

/** The stage immediately before this one on the floor, or null for Cutting. */
export function upstreamStage(stage: ProductionStage): ProductionStage | null {
  const i = PRODUCTION_STAGES.indexOf(stage);
  return i > 0 ? PRODUCTION_STAGES[i - 1] : null;
}

export const ENTRY_STATUSES = ["recorded", "confirmed"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const LINE_TYPES = ["cutting", "sewing", "packing", "general"] as const;
export type LineType = (typeof LINE_TYPES)[number];

export const SHIFT_CODES = ["SHIFT_1", "SHIFT_2"] as const;
export type ShiftCode = (typeof SHIFT_CODES)[number];

/**
 * Map a stage to the T&A milestone name it should complete (best-effort,
 * name-matched — `lib/production/actions.ts confirmEntry()`). `ta_milestones`
 * is the OLDER, still-live TA Plan model (`lib/orders/actions.ts
 * getTaMilestones`, read by `lib/dashboard/service.ts`'s on-time metrics) —
 * a separate table from the amendment-based `garment_order_amendment_
 * ta_activities` this feature's bypass is derived from. Both exist; this map
 * only concerns the older one.
 */
export const STAGE_MILESTONE: Record<ProductionStage, string> = {
  cutting: "Cutting",
  sewing: "Sewing",
  checking: "Checking",
  ironing: "Ironing",
  packing: "Finishing & Packing",
};

/**
 * `ta_activities.short_name` (0035) → the floor stage it corresponds to, for
 * every place that derives a bypass/WIP figure from a T&A row: `lib/ta/
 * worklist.ts`'s `getWorklist()`, `lib/ta/worklist-actions.ts`'s
 * `getTaActivityWip` (Order Entry's own T&A tab), and anything else that
 * needs to go from "which T&A activity" to "which production_entries.stage".
 * Only the 5 floor stages have an entry; every other T&A activity (Fabric
 * Plan, Knitting, Dyeing, Inspection, Shipment, …) is not a floor stage.
 */
export const ACTIVITY_SHORT_NAME_TO_STAGE: Record<string, ProductionStage> = {
  CUT: "cutting",
  SEW: "sewing",
  CHECK: "checking",
  IRON: "ironing",
  PACK: "packing",
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
  /** The garment order amendment this output belongs to (0548). */
  amendment_id: string | null;
  /** Legacy pre-amendment FK (0011) — kept for rows a backfill couldn't resolve. */
  sales_order_id: string | null;
  stage: ProductionStage;
  line_id: string | null;
  shift_code: ShiftCode;
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
  amendment_id: z.string().uuid(),
  stage: z.enum(PRODUCTION_STAGES),
  line_id: z.string().uuid().optional().nullable(),
  shift_code: z.enum(SHIFT_CODES).default("SHIFT_1"),
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
