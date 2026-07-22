import { z } from "zod";

// ============================================================================
// Garment Accepted Qty Levels — master-detail.
// Header: garment_accepted_qty_levels (auto code, entry_date, effective_from)
// Detail: garment_accepted_qty_level_details (sno, range_type, from_qty, to_qty,
//         no_of_pieces, major_allowed, minor_allowed, critical_allowed, allowed)
//
// range_type: U=Under, B=Between, A=Above
// ============================================================================

export const RANGE_TYPES = ["U", "B", "A"] as const;
export type RangeType = (typeof RANGE_TYPES)[number];

export const RANGE_TYPE_LABELS: Record<RangeType, string> = {
  U: "Under",
  B: "Between",
  A: "Above",
};

export interface GarmentAcceptedQtyLevelDetail {
  id: string;
  header_id: string;
  sno: number;
  range_type: RangeType | null;
  from_qty: number | null;
  to_qty: number | null;
  no_of_pieces: number | null;
  major_allowed: number | null;
  minor_allowed: number | null;
  critical_allowed: number | null;
  allowed: number | null;
}

export interface GarmentAcceptedQtyLevel {
  id: string;
  code: string;
  entry_date: string;
  effective_from: string;
  created_at: string;
  updated_at: string;
  details: GarmentAcceptedQtyLevelDetail[];
}

export const garmentAcceptedQtyLevelDetailInput = z.object({
  sno: z.number().int().positive(),
  range_type: z.enum(RANGE_TYPES).nullable().default(null),
  from_qty: z.coerce.number().min(0).nullable().default(null),
  to_qty: z.coerce.number().min(0).nullable().default(null),
  no_of_pieces: z.coerce.number().int().min(0).nullable().default(null),
  major_allowed: z.coerce.number().int().min(0).nullable().default(null),
  minor_allowed: z.coerce.number().int().min(0).nullable().default(null),
  critical_allowed: z.coerce.number().int().min(0).nullable().default(null),
  allowed: z.coerce.number().int().min(0).nullable().default(null),
});

export const garmentAcceptedQtyLevelInput = z.object({
  entry_date: z.string().min(1, "Entry date is required"),
  effective_from: z.string().min(1, "Effective from is required"),
  details: z
    .array(garmentAcceptedQtyLevelDetailInput)
    .min(1, "At least one detail row is required"),
});

export type GarmentAcceptedQtyLevelInput = z.infer<typeof garmentAcceptedQtyLevelInput>;
export type GarmentAcceptedQtyLevelDetailInput = z.infer<typeof garmentAcceptedQtyLevelDetailInput>;
