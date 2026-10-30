import { z } from "zod";

// ============================================================================
// Work Timing per Employee Category (0774). User 2026-10-30: Work Timing is
// split into Staff and Worker, and every category created under either gets
// its own Punch In / Punch Out / grace. Replaces 0769's three fixed groups as
// the source of a person's working day.
//
// The time helpers (timeToMinutes, isOvernight, shiftMinutes) stay in
// group-timing-types.ts and are re-exported here, so the rule for "Out earlier
// than In = next morning" is written once.
// ============================================================================

export { timeToMinutes, isOvernight, shiftMinutes } from "./group-timing-types";

/** Which master a person lives in — the two halves of Work Timing. */
export const PERSON_KINDS = [
  { value: "staff", label: "Staff" },
  { value: "worker", label: "Worker" },
] as const;
export type PersonKind = (typeof PERSON_KINDS)[number]["value"];

export function kindLabel(v: string | null | undefined): string {
  return PERSON_KINDS.find((k) => k.value === v)?.label ?? "—";
}

export interface CategoryTiming {
  id: string;
  category_id: string;
  /** Postgres `time` — HH:MM:SS. */
  in_time: string;
  out_time: string;
  grace_minutes: number;
  effective_from: string;
  created_at: string;
  created_by: string | null;
  updated_at: string;
}

const hhmm = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Enter a time");

export const categoryTimingInput = z
  .object({
    category_id: z.string().uuid("Pick a category"),
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
export type CategoryTimingInput = z.infer<typeof categoryTimingInput>;

/**
 * The hours in force for ONE category on `day` (YYYY-MM-DD): the latest of its
 * rows whose `effective_from` is on or before it. A change of hours is a new
 * dated row, so a past day is always judged by the hours of that day.
 */
export function timingOn(
  rows: CategoryTiming[],
  categoryId: string | null,
  day: string,
): CategoryTiming | null {
  if (!categoryId) return null;
  let cur: CategoryTiming | null = null;
  for (const r of rows) {
    if (r.category_id !== categoryId || r.effective_from.slice(0, 10) > day) continue;
    if (!cur || r.effective_from > cur.effective_from) cur = r;
  }
  return cur;
}

/** The next revision of a category's hours after `day`, if one is scheduled. */
export function nextTiming(
  rows: CategoryTiming[],
  categoryId: string | null,
  day: string,
): CategoryTiming | null {
  if (!categoryId) return null;
  let next: CategoryTiming | null = null;
  for (const r of rows) {
    if (r.category_id !== categoryId || r.effective_from.slice(0, 10) <= day) continue;
    if (!next || r.effective_from < next.effective_from) next = r;
  }
  return next;
}
