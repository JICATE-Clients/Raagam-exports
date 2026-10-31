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

import { timeToMinutes } from "./group-timing-types";
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
  /** Breaks (0775), each a From–To pair or both null. Optional: absent until the migration is applied. */
  tea1_start?: string | null;
  tea1_end?: string | null;
  lunch_start?: string | null;
  lunch_end?: string | null;
  tea2_start?: string | null;
  tea2_end?: string | null;
  effective_from: string;
  created_at: string;
  created_by: string | null;
  updated_at: string;
}

const hhmm = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Enter a time");
/** A break end: blank = no such break. */
const optTime = z
  .string()
  .nullish()
  .transform((s) => (s ? s : null))
  .refine((s) => s === null || /^\d{2}:\d{2}(:\d{2})?$/.test(s), "Enter a time");

/**
 * The three breaks of a working day, in the order they fall (user 2026-10-31:
 * "punch in, tea break 1, lunch, tea break 2, punch out").
 */
export const BREAKS = [
  { key: "tea1", label: "Tea Break 1", start: "tea1_start", end: "tea1_end" },
  { key: "lunch", label: "Lunch", start: "lunch_start", end: "lunch_end" },
  { key: "tea2", label: "Tea Break 2", start: "tea2_start", end: "tea2_end" },
] as const;
export type BreakField = (typeof BREAKS)[number]["start" | "end"];
type BreakTimes = Partial<Record<BreakField, string | null>>;

/** Minutes since Punch In, a night shift's after-midnight times wrapping forward. */
function sinceIn(inTime: string, t: string): number {
  const d = timeToMinutes(t) - timeToMinutes(inTime);
  return d >= 0 ? d : d + 24 * 60;
}

/** Total break minutes in a timing (only breaks with both ends). */
export function breakMinutes(t: BreakTimes & { in_time: string }): number {
  let total = 0;
  for (const b of BREAKS) {
    const s = t[b.start];
    const e = t[b.end];
    if (s && e) total += sinceIn(t.in_time, e) - sinceIn(t.in_time, s);
  }
  return total;
}

/**
 * Why a day's breaks don't fit, or null. Each break is both ends or neither,
 * ends after it starts, sits inside Punch In → Punch Out, and comes after the
 * one before it — night shifts included, everything measured from Punch In.
 */
export function breakProblem(t: BreakTimes & { in_time: string; out_time: string }): string | null {
  if (!t.in_time || !t.out_time) return null;
  const span = sinceIn(t.in_time, t.out_time) || 24 * 60;
  let after = 0;
  let prev = "Punch In";
  for (const b of BREAKS) {
    const s = t[b.start];
    const e = t[b.end];
    if (!s && !e) continue;
    if (!s || !e) return `${b.label}: enter both From and To, or leave both blank`;
    const from = sinceIn(t.in_time, s);
    const to = sinceIn(t.in_time, e);
    if (from === 0 || from < after) return `${b.label} must start after ${prev}`;
    if (to <= from) return `${b.label} must end after it starts`;
    if (to > span) return `${b.label} must end by Punch Out`;
    after = to;
    prev = b.label;
  }
  return null;
}

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
    tea1_start: optTime,
    tea1_end: optTime,
    lunch_start: optTime,
    lunch_end: optTime,
    tea2_start: optTime,
    tea2_end: optTime,
    effective_from: z.string().min(1, "Effective From is required"),
  })
  // Out earlier than In is allowed — it means the next morning (a night
  // shift). Out EQUAL to In is a 0- or 24-hour day, which is never meant.
  .refine((v) => v.in_time.slice(0, 5) !== v.out_time.slice(0, 5), {
    message: "Punch Out can't be the same as Punch In",
    path: ["out_time"],
  })
  .superRefine((v, ctx) => {
    const p = breakProblem(v);
    if (p) ctx.addIssue({ code: "custom", message: p, path: ["tea1_start"] });
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
