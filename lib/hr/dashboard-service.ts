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
      feed: data.feed.filter((f) => f.kind === filter.kind && keep(f.departmentId)).slice(0, FEED_ROWS),
    },
    depts,
    picked,
  };
}

type PersonRow = {
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

async function enrolledPeople(): Promise<{ people: Person[]; noCategory: number }> {
  const s = await createClient();
  // `departments!department_id`: workers also carry `prod_dept_id` (0553), so a bare
  // `departments(...)` embed there is PGRST201-ambiguous (AGENTS.md).
  const sel =
    "name, code, biometric_id, category_id, category:employee_categories!category_id(name), department_id, department:departments!department_id(name, short_name)";
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
  for (const { r, kind } of rows) {
    const bio = String(r.biometric_id ?? "").trim();
    if (!bio || seen.has(bio)) continue; // a shared id is an enrolment mistake; first claim wins here
    seen.add(bio);
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
  return { people, noCategory };
}

/**
 * The week, per Staff / Worker and department (0776). Until 0776 is applied
 * the per-kind trend (0774) answers instead, and `byDept` says the week can't
 * follow a department filter.
 */
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
  const [timings, { people, noCategory }] = await Promise.all([listCategoryTimings(), enrolledPeople()]);
  const from = new Date(fetchFrom([...new Set(people.map((p) => p.categoryId))], timings, now)).toISOString();
  const [punches, trendRows, devices] = await Promise.all([punchesSince(from), trend(), listDevices()]);

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
  };
}
