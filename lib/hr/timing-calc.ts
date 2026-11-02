import {
  nextTiming,
  timeToMinutes,
  timingOn,
  type CategoryTiming,
  type PersonKind,
} from "@/lib/masters/category-timing-types";

// ============================================================================
// Today's attendance from raw punches, Staff and Worker, each person judged by
// THEIR employee category's hours (0774). Pure — no clock, no database — so it
// is testable and the dashboard and any later screen read one rule.
//
// THE SHIFT DAY is the rule `hr_attendance_trend_by_kind()` (0774) also
// follows: a category's day D runs 24 h from (D + Punch In − 4 h), IST. A 09:00
// day owns 05:00 → 05:00; a 20:00 night shift owns 16:00 → 16:00, so the 08:00
// punch next morning ENDS day D instead of starting D+1. A person with no
// category, or a category with no hours, is on the calendar day and is never
// late. Change one, change both.
//
// Only Punch In and Punch Out are fixed. Punches in between alternate
// out / back-in and are reported as MOVEMENTS, never judged against a time.
// ============================================================================

const IST_OFFSET_MS = 330 * 60_000;
const LEAD_MS = 4 * 3600_000;
const DAY_MS = 24 * 3600_000;
/** A second scan within this gap is the same punch (a double tap at the reader). */
const DEBOUNCE_MS = 2 * 60_000;

export interface Person {
  bio: string;
  name: string;
  code: string | null;
  kind: PersonKind;
  categoryId: string | null;
  /** The category's name, or null when the person has none. */
  categoryName: string | null;
  departmentId: string | null;
  /** The department's name, or null when the person has none. */
  departmentName: string | null;
}

export interface RawPunch {
  user_id: string;
  punch_time: string;
}

export type DayStatus =
  | "not_in" // no punch yet, still inside Punch In + grace
  | "absent" // no punch, past Punch In + grace
  | "inside" // on the premises now
  | "stepped_out" // went out during the day, not back yet
  | "left" // gone home on time
  | "left_early"; // gone home before Punch Out (no grace on the way out)

export interface PersonDay {
  person: Person;
  status: DayStatus;
  firstAt: number | null;
  lastAt: number | null;
  /** Minutes after Punch In + grace; 0 when on time. */
  lateMin: number;
  /** Minutes before Punch Out; 0 unless left early. */
  earlyMin: number;
  /** Out-and-back trips between In and the final Out. */
  movements: { outAt: number; backAt: number | null }[];
  punches: number[];
}

/** One category's hours as the dashboard shows them under Staff or Worker. */
export interface ShiftInfo {
  /** null = the people with no category at all. */
  categoryId: string | null;
  name: string;
  /** The shift day (YYYY-MM-DD) in force for this category now. */
  day: string;
  timing: CategoryTiming | null;
  /** The next dated revision after `day`, if one is scheduled. */
  upcoming: CategoryTiming | null;
  people: number;
}

export interface GroupDay {
  group: PersonKind;
  /** Every category with someone in it, in name order (no-category last). */
  shifts: ShiftInfo[];
  people: PersonDay[];
}

/** YYYY-MM-DD of an instant, in IST. */
export function istDay(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant of `day` at `minutes` after IST midnight. */
function istAt(day: string, minutes: number): number {
  return Date.parse(`${day}T00:00:00Z`) - IST_OFFSET_MS + minutes * 60_000;
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Start of shift day `day` for a category with these hours (calendar day without). */
function windowStart(day: string, t: CategoryTiming | null): number {
  return t ? istAt(day, timeToMinutes(t.in_time)) - LEAD_MS : istAt(day, 0);
}

/**
 * Which shift day a category is in at `now`, with its hours. Before today's
 * window opens (05:00 for a 09:00 day) the current day is still yesterday's.
 */
export function currentShift(
  categoryId: string | null,
  timings: CategoryTiming[],
  now: number,
): { day: string; timing: CategoryTiming | null; start: number } {
  const today = istDay(now);
  const t = timingOn(timings, categoryId, today);
  if (now >= windowStart(today, t)) return { day: today, timing: t, start: windowStart(today, t) };
  const y = addDays(today, -1);
  const ty = timingOn(timings, categoryId, y);
  return { day: y, timing: ty, start: windowStart(y, ty) };
}

/** The earliest instant any of these categories' current day starts — what to fetch from. */
export function fetchFrom(categoryIds: (string | null)[], timings: CategoryTiming[], now: number): number {
  return Math.min(
    currentShift(null, timings, now).start,
    ...categoryIds.map((c) => currentShift(c, timings, now).start),
  );
}

function debounce(times: number[]): number[] {
  const out: number[] = [];
  for (const t of times) {
    if (!out.length || t - out[out.length - 1] >= DEBOUNCE_MS) out.push(t);
  }
  return out;
}

export function computeGroupDays(
  people: Person[],
  punches: RawPunch[],
  timings: CategoryTiming[],
  now: number,
): GroupDay[] {
  const byBio = new Map<string, number[]>();
  for (const p of punches) {
    const k = p.user_id.trim();
    const list = byBio.get(k) ?? [];
    list.push(Date.parse(p.punch_time));
    byBio.set(k, list);
  }

  // One shift per category, worked out once and shared by everyone in it.
  type Shift = {
    day: string;
    timing: CategoryTiming | null;
    start: number;
    end: number;
    inAt: number | null;
    outAt: number | null;
    grace: number;
  };
  const shifts = new Map<string, Shift>();
  const shiftFor = (categoryId: string | null): Shift => {
    const key = categoryId ?? "";
    const hit = shifts.get(key);
    if (hit) return hit;
    const { day, timing, start } = currentShift(categoryId, timings, now);
    const inAt = timing ? istAt(day, timeToMinutes(timing.in_time)) : null;
    let outAt = timing ? istAt(day, timeToMinutes(timing.out_time)) : null;
    if (inAt != null && outAt != null && outAt <= inAt) outAt += DAY_MS; // night shift
    const sh = { day, timing, start, end: start + DAY_MS, inAt, outAt, grace: (timing?.grace_minutes ?? 0) * 60_000 };
    shifts.set(key, sh);
    return sh;
  };

  function dayOf(person: Person): PersonDay {
    const { start, end, inAt, outAt, grace } = shiftFor(person.categoryId);
    const ts = debounce(
      (byBio.get(person.bio) ?? []).filter((t) => t >= start && t < end && t <= now).sort((a, b) => a - b),
    );
    if (!ts.length) {
      const status: DayStatus = inAt != null && now > inAt + grace ? "absent" : "not_in";
      return { person, status, firstAt: null, lastAt: null, lateMin: 0, earlyMin: 0, movements: [], punches: [] };
    }
    const first = ts[0];
    const last = ts[ts.length - 1];
    const lateMin = inAt != null && first > inAt + grace ? Math.round((first - inAt) / 60_000) : 0;

    let status: DayStatus;
    let earlyMin = 0;
    let goneHome = false;
    if (ts.length % 2 === 1) {
      status = "inside";
    } else if (outAt == null || last >= outAt) {
      // GRACE IS FOR PUNCH IN ONLY (client 2026-10-28). Leaving even a
      // minute before Punch Out is an early exit; grace never shortens
      // the end of the day.
      status = "left";
      goneHome = true;
    } else if (now >= outAt) {
      // Out before time and never came back before Punch Out: left early.
      status = "left_early";
      earlyMin = Math.round((outAt - last) / 60_000);
      goneHome = true;
    } else {
      status = "stepped_out";
    }

    // Between the first In and (if they have gone home) the final Out,
    // punches pair up as out → back.
    const middle = ts.slice(1, goneHome ? -1 : undefined);
    const movements: PersonDay["movements"] = [];
    for (let i = 0; i < middle.length; i += 2) {
      movements.push({ outAt: middle[i], backAt: middle[i + 1] ?? null });
    }
    return { person, status, firstAt: first, lastAt: last, lateMin, earlyMin, movements, punches: ts };
  }

  return (["staff", "worker"] as const).map((group) => {
    const mine = people.filter((p) => p.kind === group);
    const counts = new Map<string, { categoryId: string | null; name: string; people: number }>();
    for (const p of mine) {
      const key = p.categoryId ?? "";
      const c = counts.get(key) ?? { categoryId: p.categoryId, name: p.categoryName ?? "No category", people: 0 };
      c.people++;
      counts.set(key, c);
    }
    const info: ShiftInfo[] = [...counts.values()]
      .sort((x, y) => (x.categoryId ? 0 : 1) - (y.categoryId ? 0 : 1) || x.name.localeCompare(y.name))
      .map((c) => {
        const sh = shiftFor(c.categoryId);
        return { ...c, day: sh.day, timing: sh.timing, upcoming: nextTiming(timings, c.categoryId, sh.day) };
      });
    return { group, shifts: info, people: mine.map(dayOf) };
  });
}
