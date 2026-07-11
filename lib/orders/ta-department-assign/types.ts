import { z } from "zod";

// ============================================================================
// TA Department Assign (0267) — header + activity grid. Assigns TA activities
// to a Department at a Location, flagging which the department owns.
// ============================================================================

export interface TaDeptAssignLine {
  id: string;
  assign_id: string;
  sno: number;
  activity_id: string | null;
  is_owner: boolean;
  // embedded for display
  activity?: { id: string; short_name: string; name: string } | null;
}

export interface TaDepartmentAssign {
  id: string;
  code: string | null;
  entered_date: string;
  location_id: string | null;
  department_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // embedded for display
  location?: { id: string; code: string | null; name: string } | null;
  department?: { id: string; code: string | null; name: string } | null;
  lines: TaDeptAssignLine[];
}

const uuidN = z.string().uuid().nullable().default(null);

export const taDeptAssignLineInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  activity_id: uuidN,
  is_owner: z.coerce.boolean().default(false),
});

export const taDeptAssignInput = z.object({
  entered_date: z.string().min(1, "Date is required"),
  location_id: uuidN,
  department_id: uuidN,
  lines: z.array(taDeptAssignLineInput).default([]),
});
export type TaDeptAssignInput = z.infer<typeof taDeptAssignInput>;
