import { z } from "zod";

// ============================================================================
// Leave Types — HR master (0259). Legacy EDP2 "Leave Type" form: ID (code) ·
// Loss Of Pay · Inactive · Description · Encash Possible (Yes/No) · For (Both/
// Male/Female) · No of Days (yearly). Flat header master.
// ============================================================================

export const LEAVE_APPLIES_TO = ["Both", "Male", "Female"] as const;
export type LeaveAppliesTo = (typeof LEAVE_APPLIES_TO)[number];

export interface LeaveType {
  id: string;
  code: string | null; // "ID"
  description: string | null;
  loss_of_pay: boolean;
  encash_possible: boolean;
  applies_to: LeaveAppliesTo | null;
  no_of_days: number;
  inactive: boolean;
  created_at: string;
  updated_at: string;
}

export const leaveTypeInput = z.object({
  code: z.string().min(1, "ID is required"),
  description: z.string().optional().nullable(),
  loss_of_pay: z.boolean().default(false),
  encash_possible: z.boolean().default(false),
  applies_to: z.enum(LEAVE_APPLIES_TO).nullable().default(null),
  no_of_days: z.coerce.number().min(0).default(0),
  inactive: z.boolean().default(false),
});
export type LeaveTypeInput = z.infer<typeof leaveTypeInput>;
