import { z } from "zod";

// ============================================================================
// Working Hours — flat master (0258). Legacy HR "Working Hour" form: Entry No
// auto · Date + daily time slots (all `time` values). No picker fields.
// ============================================================================

export interface WorkingHour {
  id: string;
  entry_no: number;
  date: string;
  morning_in: string | null;
  morning_break_from: string | null;
  morning_break_to: string | null;
  lunch_break_from: string | null;
  lunch_break_to: string | null;
  evening_break_from: string | null;
  evening_break_to: string | null;
  evening_out: string | null;
  ot_in: string | null;
  ot_out: string | null;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
}

const timeN = z.string().optional().nullable();

export const workingHourInput = z.object({
  date: z.string().min(1, "Date is required"),
  morning_in: timeN,
  morning_break_from: timeN,
  morning_break_to: timeN,
  lunch_break_from: timeN,
  lunch_break_to: timeN,
  evening_break_from: timeN,
  evening_break_to: timeN,
  evening_out: timeN,
  ot_in: timeN,
  ot_out: timeN,
  is_draft: z.boolean().default(false),
});
export type WorkingHourInput = z.infer<typeof workingHourInput>;
