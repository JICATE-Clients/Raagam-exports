import { z } from "zod";

// ============================================================================
// Work Timings — master-detail (0256). Legacy HR "Work Timing" form: header
// (Entry No auto · Date · Location → locations · Effective From) + a Shift line
// grid (Shift Category → config_lookups 'shift_category' · No Of Shifts ·
// Applicable For All Categories) + is_draft.
// ============================================================================

export interface WorkTimingLine {
  id: string;
  work_timing_id: string;
  sno: number;
  shift_category_id: string | null;
  no_of_shifts: number | null;
  applicable_for_all_categories: boolean;
}

export interface WorkTiming {
  id: string;
  entry_no: number;
  date: string;
  location_id: string | null;
  effective_from: string;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
  // embedded for display
  location?: { id: string; name: string } | null;
  lines: WorkTimingLine[];
}

const uuidN = z.string().uuid().nullable().default(null);

export const workTimingLineInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  shift_category_id: uuidN,
  no_of_shifts: z.coerce.number().int().nonnegative().nullable().default(null),
  applicable_for_all_categories: z.boolean().default(false),
});

export const workTimingInput = z.object({
  date: z.string().min(1, "Date is required"),
  location_id: uuidN,
  effective_from: z.string().min(1, "Effective From is required"),
  is_draft: z.boolean().default(false),
  lines: z.array(workTimingLineInput).default([]),
});
export type WorkTimingInput = z.infer<typeof workTimingInput>;
