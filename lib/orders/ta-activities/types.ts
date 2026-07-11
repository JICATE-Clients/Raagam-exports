import { z } from "zod";
import type { ConfigLookup } from "@/lib/masters/extras-types";

/** Embedded Type lookup (config_lookups kind 'ta_activity_type'). */
export type TaActivityType = Pick<ConfigLookup, "id" | "code" | "name">;

export interface TaActivity {
  id: string;
  short_name: string;
  name: string;
  type_id: string | null;
  /** Embedded Type row (from config_lookups) for display. */
  type: TaActivityType | null;
  has_sub_activities: boolean;
  consider_for_delivery_date: boolean;
  /** Legacy "Blocked" is the inverse of this flag. */
  is_active: boolean;
  // Retained (not on the legacy TA Activity form) — used by TA Plan / Dept Assign.
  department: string | null;
  sequence: number;
  default_offset_days: number;
  created_at: string;
  updated_at: string;
}

export const taActivityInput = z.object({
  short_name: z.string().min(1, "Short name required"),
  name: z.string().min(1, "Name required"),
  type_id: z.string().uuid().nullable().default(null),
  has_sub_activities: z.coerce.boolean().default(false),
  consider_for_delivery_date: z.coerce.boolean().default(false),
  is_active: z.coerce.boolean().default(true),
});
export type TaActivityInput = z.infer<typeof taActivityInput>;
