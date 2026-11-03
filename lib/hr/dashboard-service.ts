import "server-only";
import { readPunches } from "@/lib/hr/punch-read";
import { createClient } from "@/lib/supabase/server";
import { listCategoryTimings } from "@/lib/masters/category-timing-service";
import type { CategoryTiming, PersonKind } from "@/lib/masters/category-timing-types";
import { listDevices, type DeviceRow } from "./punch-service";
import { computeGroupDays, fetchFrom, istDay as istDayOf, type GroupDay, type Person, type PersonDay, type RawPunch } from "./timing-calc";

// created-by: exempt -- a dashboard read model, not a listing of records.

export interface TrendRow {
  day: string;
  kind: PersonKind;
  /** null = no department. Absent when only 0774's per-kind trend answered. */
  department_id?: string | null;
  enrolled: number;
  present: number;
  late: number;
}

export interface FeedPunch {
  at: number;
  name: string | null;
  bio: string;
  kind: PersonKind | null;
  departmentId: string | null;
  /** In · Out · Back — by its position in that person's day. */
  label: "In" | "Out" | "Back";
}

export interface HrDashboard {
  /** The clock, for the devices and "Updated" — always the real now. */
  now: number;
  /** The shift day on view (IST, YYYY-MM-DD) — today unless a date was picked. */
  day: string;
  /** True for today: live figures, auto-refresh. False: a closed past day. */
  live: boolean;
  /** The instant every figure is judged at — `now` today, the day's close for a past day. */
  asOf: number;
  groups: GroupDay[];
  timings: CategoryTiming[];
  trend: TrendRow[];
  devices: DeviceRow[];
  feed: FeedPunch[];
  /** Ids that punched today but match no active staff or worker. */
  unlinkedIds: number;
  /** People on the reader with no Employee Category set. */
  noCategory: number;
  /** False while 0776 is not applied: the week can't be split by department. */
  trendByDept: boolean;
  /** Approved Time Off covering today, one per person (by device id). */
  timeOff: TimeOffToday[];
  /** The "Needs attention" list — patterns over the last week, not today's counts. */
  attention: Attention;
  /** Everyone active, on the reader or not — celebrations and workforce mix. */
  roster: RosterPerson[];
  /** Time Off requests still waiting for a decision, oldest first. */
  pendingTimeOff: PendingTimeOff[];
  /** Approval steps waiting on the person viewing (every module, not only HR). */
  waitingOnMe: number;
  /** Open work across the HR modules — the unit in view, not narrowed by the filter. */
  pipeline: HrPipeline;
}

export interface RosterPerson {
  /** "staff:<id>" / "worker:<id>". */
  key: string;
  kind: PersonKind;
  name: string;
  code: string | null;
  departmentId: string | null;
  departmentName: string | null;
  designation: string | null;
  gender: string | null;
  dob: string | null;
  joined: string | null;
}

export interface PendingTimeOff {
  id: string;
  personKey: string;
  name: string;
  kind: "leave" | "permission";
  type: string;
  from: string;
  to: string;
  days: number;
  createdAt: string;
}

export interface HrPipeline {
  openJobs: number;
  candidates: number;
  joining: number;
  exits: number;
  memos: number;
  cases: number;
}

/** One person in a "Needs attention" line. */
export interface AttentionPerson {
  /** "staff:<id>" / "worker:<id>" — what Issue memo pre-fills. */
  key: string | null;
  bio: string;
  name: string;
  code: string | null;
  kind: PersonKind;
  departmentId: string | null;
  departmentName: string | null;
  /** Late: days late. Absent: working days running. Missed out: 1. */
  count: number;
  /** Late: average minutes late. Missed out: their In (epoch ms). */
  detail: number;
}

export interface Attention {
  /** Late on 3 or more of the last 7 shift days (today included). */
  late: AttentionPerson[];
  /** Absent 2 or more working days running, up to today, with no approved leave / on duty. */
  absent: AttentionPerson[];
  /** Punched In on the last shift day and never Out. */
  missedOut: AttentionPerson[];
  /** The shift day "missed out" is about (YYYY-MM-DD). */
  missedOutDay: string;
  /** Devices switched on that have been silent for 30 minutes or more. */
  silentDevices: DeviceRow[];
}

/** How many late days in the week make a pattern; how many absent days in a row. */
export const LATE_PATTERN = 3;
export const ABSENT_RUN = 2;
const SILENT_MS = 30 * 60_000;

/**
 * What an approved Time Off request makes of a person today (0770): Leave
 * (leave and compensatory off), On Duty (a leave type coded OD or named "On
 * Duty" — away on company work, not absent) or Permission (short time off).
 */
export type TimeOffKind = "leave" | "on_duty" | "permission";
export interface TimeOffToday {
  bio: string;
  kind: TimeOffKind;
  /** The leave type's name, e.g. CASUAL LEAVE. */
  type: string;
  /** full · first_half · second_half · hourly */
  part: string;
}

/** One department in the dashboard's filter, for the Staff / Worker in view. */
export interface DeptOption {
  /** "" = people with no department. */
  id: string;
  name: string;
  people: number;
}

/** What the dashboard is narrowed to — from the URL, so a refresh keeps it. */
export interface HrDashboardFilter {
  kind: PersonKind;
  /** Department ids; empty = every department. "" = no department. */
  depts: string[];
}

/** The punches the feed shows after filtering. */
const FEED_ROWS = 25;

/**
 * NARROW THE DASHBOARD to one side (Staff or Worker) and, optionally, some of
 * its departments (user 2026-10-31: "the whole dashboard should be 2 for staff
 * and worker and i can be able to filter depts everywhere"). Every figure the
 * view draws comes from `groups`, `trend` and `feed`, so narrowing those
 * three narrows every card at once — no card filters on its own.
 *
 * The department list is scoped to the side in view (AGENTS.md "Cascading
 * filters"): Staff lists only departments that have staff on the reader, and a
 * picked department the side doesn't have is dropped rather than kept.
 */
function keepAttention(a: Attention, keep: (p: AttentionPerson) => boolean): Attention {
  return { ...a, late: a.late.filter(keep), absent: a.absent.filter(keep), missedOut: a.missedOut.filter(keep) };
}

export function filterHrDashboard(
  data: HrDashboard,
  filter: HrDashboardFilter,
): { data: HrDashboard; depts: DeptOption[]; picked: string[] } {
  const side = data.groups.find((g) => g.group === filter.kind);
  const counts = new Map<string, DeptOption>();
  for (const d of side?.people ?? []) {
    const id = d.person.departmentId ?? "";
    const o = counts.get(id) ?? { id, name: d.person.departmentName ?? "No department", people: 0 };
    o.people++;
    counts.set(id, o);
  }
  const depts = [...counts.values()].sort(
    (a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || a.name.localeCompare(b.name),
  );
  const picked = filter.depts.filter((id) => counts.has(id));
  const keep = (dept: string | null | undefined) => !picked.length || picked.includes(dept ?? "");

  const groups = data.groups
    .filter((g) => g.group === filter.kind)
    .map((g) => {
      const people = g.people.filter((d) => keep(d.person.departmentId));
      // A category's head-count follows the filter; one with nobody left in
      // view drops off the card's back.
      const per = new Map<string | null, number>();
      for (const d of people) per.set(d.person.categoryId, (per.get(d.person.categoryId) ?? 0) + 1);
      const shifts = g.shifts
        .map((x) => ({ ...x, people: per.get(x.categoryId) ?? 0 }))
        .filter((x) => x.people > 0 || !picked.length);
      return { ...g, people, shifts };
    });

  return {
    data: {
      ...data,
      groups,
      trend: data.trend.filter(
        (t) => t.kind === filter.kind && (!picked.length || !data.trendByDept || keep(t.department_id)),
      ),
      timeOff: (() => {
        const bios = new Set(groups.flatMap((g) => g.people.map((d) => d.person.bio)));
        return data.timeOff.filter((t) => bios.has(t.bio));
      })(),
      feed: data.feed.filter((f) => f.kind === filter.kind && keep(f.departmentId)).slice(0, FEED_ROWS),
      attention: keepAttention(data.attention, (p) => p.kind === filter.kind && keep(p.departmentId)),
      ...(() => {
        const roster = data.roster.filter((p) => p.kind === filter.kind && keep(p.departmentId));
        const keys = new Set(roster.map((p) => p.key));
        return { roster, pendingTimeOff: data.pendingTimeOff.filter((t) => keys.has(t.personKey)) };
      })(),
    },
    depts,
    picked,
  };
}

type PersonRow = {
  id: string;
  name: string;
  code: string | null;
  biometric_id: string | null;
  category_id: string | null;
  category: { name: string } | null;
  department_id: string | null;
  department: { name: string | null; short_name: string } | null;
};

/**
 * A week of punches outgrows one PostgREST read (~1,800 people × 4 punches a
 * day), so it is read in pages — side by side, through `readPunches`, not one
 * after another (client 2026-11-02: the HR module loading slowly). `toIso`
 * bounds the read when only a slice is wanted.
 */
async function punchesSince(fromIso: string, toIso?: string): Promise<RawPunch[]> {
  const s = await createClient();
  try {
    const { rows } = await readPunches<RawPunch & { id: number }>(s, "id, user_id, punch_time", fromIso, toIso);
    return rows;
  } catch (error) {
    console.error("[hr-dashboard] punches failed", error);
    return [];
  }
}

async function enrolledPeople(): Promise<{ people: Person[]; noCategory: number; bioOf: Map<string, string> }> {
  const s = await createClient();
  // `departments!department_id`: workers also carry `prod_dept_id` (0553), so a bare
  // `departments(...)` embed there is PGRST201-ambiguous (AGENTS.md).
  const sel =
    "id, name, code, biometric_id, category_id, category:employee_categories!category_id(name), department_id, department:departments!department_id(name, short_name)";
  const [staff, workers] = await Promise.all([
    s.from("staff").select(sel).eq("is_active", true).not("biometric_id", "is", null),
    s.from("workers").select(sel).eq("is_active", true).not("biometric_id", "is", null),
  ]);
  if (staff.error) console.error("[hr-dashboard] staff failed", staff.error);
  if (workers.error) console.error("[hr-dashboard] workers failed", workers.error);

  const people: Person[] = [];
  let noCategory = 0;
  const seen = new Set<string>();
  const rows = [
    ...((staff.data ?? []) as unknown as PersonRow[]).map((r) => ({ r, kind: "staff" as const })),
    ...((workers.data ?? []) as unknown as PersonRow[]).map((r) => ({ r, kind: "worker" as const })),
  ];
  const bioOf = new Map<string, string>();
  for (const { r, kind } of rows) {
    const bio = String(r.biometric_id ?? "").trim();
    if (!bio || seen.has(bio)) continue; // a shared id is an enrolment mistake; first claim wins here
    seen.add(bio);
    bioOf.set(`${kind}:${r.id}`, bio);
    if (!r.category_id) noCategory++;
    people.push({
      bio,
      key: `${kind}:${r.id}`,
      name: r.name,
      code: r.code,
      kind,
      categoryId: r.category_id,
      categoryName: r.category?.name ?? null,
      departmentId: r.department_id,
      departmentName: r.department ? r.department.name || r.department.short_name : null,
    });
  }
  return { people, noCategory, bioOf };
}

/**
 * The week, per Staff / Worker and department (0776). Until 0776 is applied
 * the per-kind trend (0774) answers instead, and `byDept` says the week can't
 * follow a department filter.
 */
/** Today in IST, YYYY-MM-DD. */
function istDay(now: number): string {
  return new Date(now + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * Approved Time Off whose dates cover today. Only APPROVED counts — a pending
 * request is not yet leave. If a person has two, On Duty wins over Leave and
 * Leave over Permission (the stronger reason they are not at the gate).
 */
/*
 * ONE READ OF THE WEEK'S APPROVED TIME OFF, STARTED WITH THE OTHERS (client
 * 2026-11-03: "everything loading so slow"). Today's time off and the week's
 * excused days were two reads of the same table, and both queued behind the
 * people read because they map ids to device ids — the mapping needs the
 * people, the READ does not. Now it starts in the first wave and is mapped by
 * `timeOffToday` / `excusedDays` once the people are in.
 */
type TimeOffRow = {
  staff_id: string | null;
  worker_id: string | null;
  request_category: string;
  day_part: string;
  start_date: string;
  end_date: string;
  leave_type: { code: string; name: string } | null;
};
async function approvedTimeOff(from: string, to: string): Promise<TimeOffRow[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("timeoff_requests")
    .select("staff_id, worker_id, request_category, day_part, start_date, end_date, leave_type:timeoff_leave_types!leave_type_id(code, name)")
    .eq("status", "approved")
    .lte("start_date", to)
    .gte("end_date", from);
  if (error) {
    console.error("[hr-dashboard] time off failed", error);
    return [];
  }
  return (data ?? []) as unknown as TimeOffRow[];
}

function timeOffToday(rows: TimeOffRow[], now: number, bioOf: Map<string, string>): TimeOffToday[] {
  const day = istDay(now);
  const data = rows.filter((r) => r.start_date <= day && r.end_date >= day);
  const rank: Record<TimeOffKind, number> = { on_duty: 3, leave: 2, permission: 1 };
  const out = new Map<string, TimeOffToday>();
  for (const r of data) {
    const bio = r.staff_id ? bioOf.get(`staff:${r.staff_id}`) : r.worker_id ? bioOf.get(`worker:${r.worker_id}`) : undefined;
    if (!bio) continue; // not on the reader, so not on this dashboard
    const code = (r.leave_type?.code ?? "").trim().toUpperCase();
    const name = (r.leave_type?.name ?? "").trim().toUpperCase();
    const kind: TimeOffKind =
      code === "OD" || name.includes("ON DUTY") ? "on_duty" : r.request_category === "short_time_off" ? "permission" : "leave";
    const prev = out.get(bio);
    if (!prev || rank[kind] > rank[prev.kind]) out.set(bio, { bio, kind, type: r.leave_type?.name ?? "", part: r.day_part });
  }
  return [...out.values()];
}

/**
 * Approved Leave / On Duty days per person over [from, to] — what excuses an
 * absence. Permission (short time off) never excuses a whole day.
 */
function excusedDays(rows: TimeOffRow[], from: string, to: string, bioOf: Map<string, string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.request_category === "short_time_off") continue;
    const bio = r.staff_id ? bioOf.get(`staff:${r.staff_id}`) : r.worker_id ? bioOf.get(`worker:${r.worker_id}`) : undefined;
    if (!bio) continue;
    const set = out.get(bio) ?? new Set<string>();
    for (let d = r.start_date > from ? r.start_date : from; d <= r.end_date && d <= to; d = addDay(d, 1)) set.add(d);
    out.set(bio, set);
  }
  return out;
}

function addDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

const WEEK = 7;
const DAY_MS = 24 * 3600_000;
/** A day counts as a working day for a side when at least this share of it punched in. */
const WORKING_DAY_SHARE = 0.2;
const PRESENT_STATUSES = new Set(["inside", "stepped_out", "left", "left_early"]);

/**
 * NEEDS ATTENTION (client 2026-11-02, in place of the punches-per-hour chart):
 * patterns HR can act on, worked out from the same punches and the same rules
 * as everything else here — each past shift day through `computeGroupDays`
 * with that day fixed.
 *
 * Sundays and holidays are not in any master the dashboard reads, so a day
 * only counts toward an absence run when the factory was evidently working:
 * at least a fifth of that side punched in. A day nobody came is nobody's
 * absence.
 */
/** Each of the week's seven shift days, per person — oldest first, the last one today. */
type Week = { days: string[]; perDay: Map<string, PersonDay>[] };

function weekOf(people: Person[], punches: RawPunch[], timings: CategoryTiming[], now: number, today: GroupDay[]): Week {
  const todayDay = istDayOf(now);
  // Oldest first: days[0] = 6 days ago … days[6] = today.
  const days = Array.from({ length: WEEK }, (_, i) => addDay(todayDay, i - (WEEK - 1)));
  const perDay: Map<string, PersonDay>[] = days.map((d, i) => {
    const groups = i === WEEK - 1 ? today : computeGroupDays(people, punches, timings, now, d);
    return new Map(groups.flatMap((g) => g.people.map((p) => [p.person.bio, p] as const)));
  });
  return { days, perDay };
}

/*
 * THE WEEK CHART, FROM THE WEEK ALREADY WORKED OUT (client 2026-11-03:
 * "everything loading so slow"). It was `hr_attendance_trend_by_dept`, an RPC
 * that re-judged seven days of punches in SQL — the slowest read on the page,
 * 1.8–3.2 s measured — while "Needs attention" judged the very same seven days
 * here from the punches already in hand. Same people, same category hours,
 * same rules (computeGroupDays), so the chart and the cards cannot disagree,
 * and a picked day of any age has its whole week.
 */
function trendOf(people: Person[], week: Week): TrendRow[] {
  const out = new Map<string, TrendRow>();
  week.days.forEach((day, i) => {
    for (const p of people) {
      const k = `${day}|${p.kind}|${p.departmentId ?? ""}`;
      const row = out.get(k) ?? { day, kind: p.kind, department_id: p.departmentId, enrolled: 0, present: 0, late: 0 };
      const d = week.perDay[i].get(p.bio);
      row.enrolled++;
      if (d && PRESENT_STATUSES.has(d.status)) {
        row.present++;
        if (d.lateMin > 0) row.late++;
      }
      out.set(k, row);
    }
  });
  return [...out.values()];
}

function attentionOf(
  people: Person[],
  week: Week,
  excused: Map<string, Set<string>>,
  devices: DeviceRow[],
  /** The real clock — a device is silent NOW, whatever day is on view. */
  clock: number,
): Attention {
  const { days, perDay } = week;
  const working = perDay.map((m) => {
    const ok = new Set<PersonKind>();
    for (const kind of ["staff", "worker"] as const) {
      const mine = people.filter((p) => p.kind === kind);
      const came = mine.filter((p) => PRESENT_STATUSES.has(m.get(p.bio)?.status ?? "")).length;
      if (mine.length && came / mine.length >= WORKING_DAY_SHARE) ok.add(kind);
    }
    return ok;
  });

  const base = (p: Person) => ({
    key: p.key ?? null,
    bio: p.bio,
    name: p.name,
    code: p.code,
    kind: p.kind,
    departmentId: p.departmentId,
    departmentName: p.departmentName,
  });

  const late: AttentionPerson[] = [];
  const absent: AttentionPerson[] = [];
  const missedOut: AttentionPerson[] = [];
  for (const p of people) {
    const week = perDay.map((m) => m.get(p.bio)).filter((d): d is PersonDay => !!d);
    const lates = week.filter((d) => PRESENT_STATUSES.has(d.status) && d.lateMin > 0);
    if (lates.length >= LATE_PATTERN) {
      late.push({ ...base(p), count: lates.length, detail: Math.round(lates.reduce((t, d) => t + d.lateMin, 0) / lates.length) });
    }

    // Absent run: back from today over working days. Today counts only once
    // its Punch In + grace has passed ("absent", not "not in yet").
    let run = 0;
    for (let i = WEEK - 1; i >= 0; i--) {
      const d = perDay[i].get(p.bio);
      if (i === WEEK - 1 && d?.status === "not_in") continue;
      if (i !== WEEK - 1 && !working[i].has(p.kind)) continue;
      if (d?.status === "absent" && !excused.get(p.bio)?.has(days[i])) run++;
      else break;
    }
    if (run >= ABSENT_RUN) absent.push({ ...base(p), count: run, detail: 0 });

    const y = perDay[WEEK - 2].get(p.bio);
    if (y && (y.status === "inside" || y.status === "stepped_out") && y.firstAt != null) {
      missedOut.push({ ...base(p), count: 1, detail: y.firstAt });
    }
  }
  late.sort((a, b) => b.count - a.count || b.detail - a.detail || a.name.localeCompare(b.name));
  absent.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  missedOut.sort((a, b) => a.name.localeCompare(b.name));

  const silentDevices = devices.filter(
    (d) => d.is_active && d.enabled && !!d.last_seen && clock - Date.parse(d.last_seen) >= SILENT_MS,
  );
  return { late, absent, missedOut, missedOutDay: days[WEEK - 2], silentDevices };
}
/*
 * ANY DAY, NOT ONLY TODAY (user 2026-11-03: "near the department add a date
 * button, so that if I want to see previous dates also we can see them").
 * `day` before today is read the way `computeGroupDays`' `atDay` reads a past
 * shift — as it stood when that day's window closed — so a person with an odd
 * punch count shows In with no Out, and nobody is "Not in yet". Everything
 * day-bound follows it: the punches (bounded so a later day cannot leak in),
 * the week behind it, its approved time off, the week chart. What is about
 * NOW stays now: devices, approvals waiting, pending requests, the pipeline.
 * A date after today, or none, is today — live.
 */
export async function getHrDashboard(clock: number, day?: string): Promise<HrDashboard> {
  const realDay = istDayOf(clock);
  const atDay = day && /^\d{4}-\d{2}-\d{2}$/.test(day) && day < realDay ? day : undefined;
  // The instant each figure is judged at: the viewed day's last moment, IST.
  const now = atDay ? Date.parse(`${atDay}T23:59:59.999+05:30`) : clock;
  // Today's window, widened to the week "Needs attention" looks back over:
  // from midnight IST six days ago, so each of those shift days is whole
  // (short of a shift that clocks in before 4 AM).
  const todayDay = istDayOf(now);
  const weekFrom = Date.parse(`${addDay(todayDay, -(WEEK - 1))}T00:00:00Z`) - 330 * 60_000;
  // A past day's window can run past its midnight (a night shift), never a whole day.
  const until = atDay ? new Date(now + DAY_MS).toISOString() : undefined;

  // EVERYTHING THAT DOES NOT NEED THE PEOPLE STARTS NOW (client 2026-11-02:
  // HR "loading time is lil bit long"). Only time off needs `bioOf`, yet the
  // week of punches, trend, devices, roster, approvals and pipeline all queued
  // behind the people read. The punches start from the week's first midnight:
  // a current shift starts today or yesterday, so `fetchFrom` is later — and
  // if a timing ever starts earlier, the gap is read below rather than lost.
  const early = Promise.all([
    punchesSince(new Date(weekFrom).toISOString(), until),
    approvedTimeOff(addDay(todayDay, -(WEEK - 1)), todayDay),
    listDevices(),
    rosterOf(),
    pendingTimeOffOf(),
    waitingOnMeCount(),
    pipelineOf(),
  ]);
  const [timings, { people, noCategory, bioOf }] = await Promise.all([listCategoryTimings(), enrolledPeople()]);
  const shiftFrom = fetchFrom([...new Set(people.map((p) => p.categoryId))], timings, now);
  const [[weekPunches, offRows, devices, roster, pendingTimeOff, waitingOnMe, pipeline], gap] =
    await Promise.all([
      early,
      shiftFrom < weekFrom
        ? punchesSince(new Date(shiftFrom).toISOString(), new Date(weekFrom).toISOString())
        : Promise.resolve([] as RawPunch[]),
    ]);
  const punches = gap.length ? [...gap, ...weekPunches] : weekPunches;

  const timeOff = timeOffToday(offRows, now, bioOf);
  const excused = excusedDays(offRows, addDay(todayDay, -(WEEK - 1)), todayDay, bioOf);
  const groups = computeGroupDays(people, punches, timings, now, atDay);
  const week = weekOf(people, punches, timings, now, groups);
  const attention = attentionOf(people, week, excused, devices, clock);

  // The feed labels each punch by its place in that person's day, from the
  // same debounced list the statuses came from — so the feed and the tiles
  // can never disagree about whether someone is in.
  const feed: FeedPunch[] = [];
  const known = new Set<string>();
  for (const g of groups) {
    for (const d of g.people) {
      known.add(d.person.bio);
      d.punches.forEach((at, i) =>
        feed.push({
          at,
          name: d.person.name,
          bio: d.person.bio,
          kind: g.group,
          departmentId: d.person.departmentId,
          label: i === 0 ? "In" : i % 2 === 1 ? "Out" : "Back",
        }),
      );
    }
  }
  const unlinked = new Set(punches.map((p) => p.user_id.trim()).filter((id) => !known.has(id)));
  feed.sort((a, b) => b.at - a.at);

  return {
    now: clock,
    day: todayDay,
    live: !atDay,
    asOf: now,
    groups,
    timings,
    trend: trendOf(people, week),
    trendByDept: true,
    devices,
    feed: feed.slice(0, 600),
    unlinkedIds: unlinked.size,
    noCategory,
    timeOff,
    attention,
    roster,
    pendingTimeOff,
    waitingOnMe,
    pipeline,
  };
}

type One<T> = T | T[] | null;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/** Every active staff and worker — on the punch reader or not. */
async function rosterOf(): Promise<RosterPerson[]> {
  const s = await createClient();
  const sel =
    "id, name, code, gender, date_of_birth, joined_date, department_id, department:departments!department_id(name), designation:designations!designation_id(name)";
  const [staff, workers] = await Promise.all([
    s.from("staff").select(sel).eq("is_active", true),
    s.from("workers").select(sel).eq("is_active", true),
  ]);
  if (staff.error) console.error("[hr-dashboard] roster staff failed", staff.error);
  if (workers.error) console.error("[hr-dashboard] roster workers failed", workers.error);
  type Row = {
    id: string;
    name: string;
    code: string | null;
    gender: string | null;
    date_of_birth: string | null;
    joined_date: string | null;
    department_id: string | null;
    department: One<{ name: string }>;
    designation: One<{ name: string }>;
  };
  const shape = (kind: PersonKind) => (r: Row): RosterPerson => ({
    key: `${kind}:${r.id}`,
    kind,
    name: r.name,
    code: r.code,
    departmentId: r.department_id,
    departmentName: one(r.department)?.name ?? null,
    designation: one(r.designation)?.name ?? null,
    gender: r.gender,
    dob: r.date_of_birth,
    joined: r.joined_date,
  });
  return [
    ...((staff.data ?? []) as unknown as Row[]).map(shape("staff")),
    ...((workers.data ?? []) as unknown as Row[]).map(shape("worker")),
  ];
}

async function pendingTimeOffOf(): Promise<PendingTimeOff[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("timeoff_requests")
    .select(
      "id, staff_id, worker_id, request_category, start_date, end_date, total_days, created_at, " +
        "staff:staff!staff_id(name), worker:workers!worker_id(name), type:timeoff_leave_types!leave_type_id(name)",
    )
    .eq("status", "pending")
    .order("created_at")
    .limit(200);
  if (error) {
    console.error("[hr-dashboard] pending time off failed", error);
    return [];
  }
  type Row = {
    id: string;
    staff_id: string | null;
    worker_id: string | null;
    request_category: string;
    start_date: string;
    end_date: string;
    total_days: number | null;
    created_at: string;
    staff: One<{ name: string }>;
    worker: One<{ name: string }>;
    type: One<{ name: string }>;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    personKey: r.staff_id ? `staff:${r.staff_id}` : `worker:${r.worker_id}`,
    name: one(r.staff)?.name ?? one(r.worker)?.name ?? "—",
    kind: r.request_category === "short_time_off" ? "permission" : "leave",
    type: one(r.type)?.name ?? (r.request_category === "short_time_off" ? "Permission" : "Leave"),
    from: r.start_date,
    to: r.end_date,
    days: Number(r.total_days ?? 0),
    createdAt: r.created_at,
  }));
}

/** The engine's inbox may refuse a login without approvals access — that only means 0. */
async function waitingOnMeCount(): Promise<number> {
  const s = await createClient();
  const { data, error } = await s.rpc("approval_my_queue", { p_workflow_key: null, p_tenant_id: null, p_limit: 500, p_offset: 0 });
  return error ? 0 : ((data ?? []) as unknown[]).length;
}

async function pipelineOf(): Promise<HrPipeline> {
  const s = await createClient();
  const n = async (table: string, col: string, values: string[]): Promise<number> => {
    const { count, error } = await s.from(table).select("id", { count: "exact", head: true }).in(col, values);
    return error ? 0 : (count ?? 0);
  };
  const [openJobs, candidates, joining, exits, memos, cases] = await Promise.all([
    n("rc_jobs", "status", ["open"]),
    n("rc_candidates", "status", ["new", "shortlisted", "interview", "pending_approval", "approved", "offered"]),
    n("lc_onboardings", "status", ["in_progress"]),
    n("lc_exits", "status", ["pending_approval", "open"]),
    n("cd_memos", "status", ["issued", "disputed"]),
    n("cd_cases", "status", ["active", "pending_approval"]),
  ]);
  return { openJobs, candidates, joining, exits, memos, cases };
}
