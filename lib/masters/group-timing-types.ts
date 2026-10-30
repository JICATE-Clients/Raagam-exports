import { z } from "zod";

// ============================================================================
// Timing Groups (0764). Client 2026-10-28: every employee category belongs to
// one of THREE fixed groups, and the group fixes the working day — Punch In,
// Punch Out and a grace allowance, nothing else. "Male Staff" and "Female
// Staff" are two categories and one group, because they keep the same hours.
//
// The three are a CHECK in the database, not a lookup table: the set is the
// client's rule, so a fourth group is a decision (and a migration), not a row.
// ============================================================================

export const TIMING_GROUPS = [
  { value: "staff", label: "Staff" },
  { value: "security", label: "Security" },
  { value: "production_staff", label: "Production Staff" },
] as const;
export type TimingGroup = (typeof TIMING_GROUPS)[number]["value"];

export function timingGroupLabel(v: string | null | undefined): string {
  return TIMING_GROUPS.find((g) => g.value === v)?.label ?? "—";
}

export interface GroupTiming {
  id: string;
  timing_group: TimingGroup;
  /** Postgres `time` — HH:MM:SS. */
  in_time: string;
  out_time: string;
  grace_minutes: number;
  effective_from: string;
  created_at: string;
  created_by: string | null;
  updated_at: string;
}

const hhmm = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, "Enter a time");

export const groupTimingInput = z
  .object({
    timing_group: z.enum(["staff", "security", "production_staff"]),
    in_time: hhmm,
    out_time: hhmm,
    grace_minutes: z.coerce
      .number()
      .int("Whole minutes")
      .min(0, "Grace can't be negative")
      .max(180, "Grace is at most 180 minutes")
      .default(0),
    effective_from: z.string().min(1, "Effective From is required"),
  })
  // Out earlier than In is allowed — it means the next morning (a night
  // shift). Out EQUAL to In is a 0- or 24-hour day, which is never meant.
  .refine((v) => v.in_time.slice(0, 5) !== v.out_time.slice(0, 5), {
    message: "Punch Out can't be the same as Punch In",
    path: ["out_time"],
  });
export type GroupTimingInput = z.infer<typeof groupTimingInput>;

/** "09:00:00" → minutes after midnight. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Out earlier than In = the shift ends the next morning. */
export function isOvernight(t: { in_time: string; out_time: string }): boolean {
  return timeToMinutes(t.out_time) < timeToMinutes(t.in_time);
}

/** Length of the working day in minutes, overnight-aware. */
export function shiftMinutes(t: { in_time: string; out_time: string }): number {
  const d = timeToMinutes(t.out_time) - timeToMinutes(t.in_time);
  return d > 0 ? d : d + 24 * 60;
}

/**
 * The hours in force for each group on `day` (YYYY-MM-DD): the latest row whose
 * `effective_from` is on or before it. A change of hours is a new dated row, so
 * a past day is always judged by the hours of that day.
 */
export function timingsOn(
  rows: GroupTiming[],
  day: string,
): Partial<Record<TimingGroup, GroupTiming>> {
  const out: Partial<Record<TimingGroup, GroupTiming>> = {};
  for (const r of rows) {
    if (r.effective_from.slice(0, 10) > day) continue;
    const cur = out[r.timing_group];
    if (!cur || r.effective_from > cur.effective_from) out[r.timing_group] = r;
  }
  return out;
}
