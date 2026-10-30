import {
  timeToMinutes,
  timingsOn,
  type GroupTiming,
  type TimingGroup,
} from "@/lib/masters/group-timing-types";

// ============================================================================
// Today's attendance from raw punches, per timing group (0769). Pure — no
// clock, no database — so it is testable and the dashboard and any later
// screen read one rule.
//
// THE SHIFT DAY is the rule `hr_attendance_trend()` (0769) also follows: a
// group's day D runs 24 h from (D + Punch In − 4 h), IST. Staff at 09:00 owns
// 05:00 → 05:00; Security at 20:00 owns 16:00 → 16:00, so the 08:00 punch next
// morning ENDS day D instead of starting D+1. Change one, change both.
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
  group: TimingGroup;
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

export interface GroupDay {
  group: TimingGroup;
  /** The shift day (YYYY-MM-DD) being shown. */
  day: string;
  timing: GroupTiming | null;
  inAt: number | null;
  outAt: number | null;
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

/** Start of shift day `day` for a group with these hours (calendar day without). */
function windowStart(day: string, t: GroupTiming | null): number {
  return t ? istAt(day, timeToMinutes(t.in_time)) - LEAD_MS : istAt(day, 0);
}

/**
 * Which shift day a group is in at `now`, with its hours. Before today's window
 * opens (03:00 for a 09:00 Staff day) the current day is still yesterday's.
 */
export function currentShift(
  group: TimingGroup,
  timings: GroupTiming[],
  now: number,
): { day: string; timing: GroupTiming | null; start: number } {
  const today = istDay(now);
  const t = timingsOn(timings, today)[group] ?? null;
  if (now >= windowStart(today, t)) return { day: today, timing: t, start: windowStart(today, t) };
  const y = addDays(today, -1);
  const ty = timingsOn(timings, y)[group] ?? null;
  return { day: y, timing: ty, start: windowStart(y, ty) };
}

/** The earliest instant any group's current day starts — what to fetch from. */
export function fetchFrom(timings: GroupTiming[], now: number): number {
  return Math.min(
    ...(["staff", "security", "production_staff"] as const).map(
      (g) => currentShift(g, timings, now).start,
    ),
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
  timings: GroupTiming[],
  now: number,
): GroupDay[] {
  const byBio = new Map<string, number[]>();
  for (const p of punches) {
    const k = p.user_id.trim();
    const list = byBio.get(k) ?? [];
    list.push(Date.parse(p.punch_time));
    byBio.set(k, list);
  }

  return (["staff", "security", "production_staff"] as const).map((group) => {
    const { day, timing, start } = currentShift(group, timings, now);
    const end = start + DAY_MS;
    const inAt = timing ? istAt(day, timeToMinutes(timing.in_time)) : null;
    let outAt = timing ? istAt(day, timeToMinutes(timing.out_time)) : null;
    if (inAt != null && outAt != null && outAt <= inAt) outAt += DAY_MS; // night shift
    const grace = (timing?.grace_minutes ?? 0) * 60_000;

    const rows: PersonDay[] = people
      .filter((p) => p.group === group)
      .map((person) => {
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
      });

    return { group, day, timing, inAt, outAt, people: rows };
  });
}
