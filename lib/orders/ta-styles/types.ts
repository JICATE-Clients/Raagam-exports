import { z } from "zod";
import type { StatusTone } from "@/components/ui/status-pill";

/** Embedded activity name (from ta_activities) for grid display. */
export type TaActivityRef = { id: string; short_name: string | null; name: string | null };

export interface TaStyleActivity {
  id: string;
  style_id: string;
  sno: number;
  activity_id: string | null;
  from_activity_id: string | null;
  days_required: number;
  created_at: string;
}

export interface TaStyle {
  id: string;
  code: string | null;
  is_draft: boolean;
  blocked: boolean;
  customer_id: string | null;
  description: string | null;
  lead_days: number;
  start_days: number;
  target_days: number;
  no_of_days: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;

  customer: { id: string; code: string | null; name: string } | null;
  activities: TaStyleActivity[];
}

const uuidN = z.string().uuid().nullable().default(null);
const intN = z.coerce.number().int().default(0);

export const taStyleActivityInput = z.object({
  activity_id: uuidN,
  from_activity_id: uuidN,
  days_required: intN,
});

export const taStyleInput = z.object({
  is_draft: z.coerce.boolean().default(false),
  blocked: z.coerce.boolean().default(false),
  customer_id: uuidN,
  description: z.string().min(1, "Description is required"),
  lead_days: intN,
  start_days: intN,
  activities: z.array(taStyleActivityInput).default([]),
});
export type TaStyleInput = z.infer<typeof taStyleInput>;

/** Status pill: Draft (unsaved workflow) / Blocked / Active. */
export function taStyleStatusTone(s: Pick<TaStyle, "is_draft" | "blocked">): StatusTone {
  if (s.is_draft) return "warning";
  if (s.blocked) return "danger";
  return "success";
}
export function taStyleStatusLabel(s: Pick<TaStyle, "is_draft" | "blocked">): string {
  if (s.is_draft) return "Draft";
  if (s.blocked) return "Blocked";
  return "Active";
}
