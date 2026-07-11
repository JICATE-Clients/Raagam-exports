import { z } from "zod";

// ============================================================================
// TA User Rights (0269) — per-user permission matrix over TA activities.
// One row per (user, activity); activity_id NULL = the "All Activities" row.
// Legacy columns View/Add/Modify/Delete → can_view/can_add/can_modify/can_delete.
// ============================================================================

export interface TaUserRight {
  id: string;
  user_id: string;
  activity_id: string | null; // null = "All Activities"
  can_view: boolean;
  can_add: boolean;
  can_modify: boolean;
  can_delete: boolean;
  created_at: string;
  updated_at: string;
}

const uuidN = z.string().uuid().nullable().default(null);

export const taUserRightRowInput = z.object({
  activity_id: uuidN,
  can_view: z.coerce.boolean().default(false),
  can_add: z.coerce.boolean().default(false),
  can_modify: z.coerce.boolean().default(false),
  can_delete: z.coerce.boolean().default(false),
});
export type TaUserRightRowInput = z.infer<typeof taUserRightRowInput>;

export const taUserRightsInput = z.object({
  user_id: z.string().uuid(),
  rows: z.array(taUserRightRowInput).default([]),
});
export type TaUserRightsInput = z.infer<typeof taUserRightsInput>;
