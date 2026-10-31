import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listCategoryTimings } from "@/lib/masters/category-timing-service";
import type { CategoryTiming, PersonKind } from "@/lib/masters/category-timing-types";
import { listDevices, type DeviceRow } from "./punch-service";
import { computeGroupDays, fetchFrom, type GroupDay, type Person, type RawPunch } from "./timing-calc";

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
  now: number;
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
}

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
 * A day of punches can outgrow one PostgREST read (~1,800 people × 4 punches),
 * so read it in pages instead of trusting one `.limit()` to cover it.
 */
async function punchesSince(fromIso: string): Promise<RawPunch[]> {
  const s = await createClient();
  const out: RawPunch[] = [];
  const PAGE = 1000;
  for (let page = 0; page < 20; page++) {
    const { data, error } = await s
      .from("punches")
      .select("user_id, punch_time")
      .gte("punch_time", fromIso)
      .order("punch_time", { ascending: true })
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) {
      console.error("[hr-dashboard] punches failed", error);
      break;
    }
    out.push(...((data ?? []) as RawPunch[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
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
async function timeOffToday(now: number, bioOf: Map<string, string>): Promise<TimeOffToday[]> {
  const s = await createClient();
  const day = istDay(now);
  const { data, error } = await s
    .from("timeoff_requests")
    .select("staff_id, worker_id, request_category, day_part, leave_type:timeoff_leave_types!leave_type_id(code, name)")
    .eq("status", "approved")
    .lte("start_date", day)
    .gte("end_date", day);
  if (error) {
    console.error("[hr-dashboard] time off failed", error);
    return [];
  }
  type Row = {
    staff_id: string | null;
    worker_id: string | null;
    request_category: string;
    day_part: string;
    leave_type: { code: string; name: string } | null;
  };
  const rank: Record<TimeOffKind, number> = { on_duty: 3, leave: 2, permission: 1 };
  const out = new Map<string, TimeOffToday>();
  for (const r of (data ?? []) as unknown as Row[]) {
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

async function trend(): Promise<{ rows: TrendRow[]; byDept: boolean }> {
  const s = await createClient();
  const byDept = await s.rpc("hr_attendance_trend_by_dept", { p_days: 7 });
  if (!byDept.error) return { rows: (byDept.data ?? []) as TrendRow[], byDept: true };
  const { data, error } = await s.rpc("hr_attendance_trend_by_kind", { p_days: 7 });
  if (error) {
    console.error("[hr-dashboard] trend failed", error);
    return { rows: [], byDept: false };
  }
  return { rows: (data ?? []) as TrendRow[], byDept: false };
}

export async function getHrDashboard(now: number): Promise<HrDashboard> {
  const [timings, { people, noCategory, bioOf }] = await Promise.all([listCategoryTimings(), enrolledPeople()]);
  const from = new Date(fetchFrom([...new Set(people.map((p) => p.categoryId))], timings, now)).toISOString();
  const [punches, trendRows, devices, timeOff] = await Promise.all([
    punchesSince(from),
    trend(),
    listDevices(),
    timeOffToday(now, bioOf),
  ]);

  const groups = computeGroupDays(people, punches, timings, now);

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
    now,
    groups,
    timings,
    trend: trendRows.rows,
    trendByDept: trendRows.byDept,
    devices,
    feed: feed.slice(0, 600),
    unlinkedIds: unlinked.size,
    noCategory,
    timeOff,
  };
}
