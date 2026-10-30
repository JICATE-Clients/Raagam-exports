import "server-only";
import { createClient } from "@/lib/supabase/server";
import { listGroupTimings } from "@/lib/masters/group-timing-service";
import type { GroupTiming, TimingGroup } from "@/lib/masters/group-timing-types";
import { listDevices, type DeviceRow } from "./punch-service";
import { computeGroupDays, fetchFrom, type GroupDay, type Person, type RawPunch } from "./timing-calc";

// created-by: exempt -- a dashboard read model, not a listing of records.

export interface TrendRow {
  day: string;
  timing_group: TimingGroup;
  enrolled: number;
  present: number;
  late: number;
}

export interface FeedPunch {
  at: number;
  name: string | null;
  bio: string;
  group: TimingGroup | null;
  /** In · Out · Back — by its position in that person's day. */
  label: "In" | "Out" | "Back";
}

export interface HrDashboard {
  now: number;
  groups: GroupDay[];
  timings: GroupTiming[];
  trend: TrendRow[];
  devices: DeviceRow[];
  feed: FeedPunch[];
  /** Ids that punched today but match no person in a timing group. */
  unlinkedIds: number;
  /** People on the reader whose category has no timing group yet. */
  noGroup: number;
}

type PersonRow = {
  name: string;
  code: string | null;
  biometric_id: string | null;
  category: { timing_group: TimingGroup | null } | null;
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

async function enrolledPeople(): Promise<{ people: Person[]; noGroup: number }> {
  const s = await createClient();
  const sel = "name, code, biometric_id, category:employee_categories!category_id(timing_group)";
  const [staff, workers] = await Promise.all([
    s.from("staff").select(sel).eq("is_active", true).not("biometric_id", "is", null),
    s.from("workers").select(sel).eq("is_active", true).not("biometric_id", "is", null),
  ]);
  if (staff.error) console.error("[hr-dashboard] staff failed", staff.error);
  if (workers.error) console.error("[hr-dashboard] workers failed", workers.error);

  const people: Person[] = [];
  let noGroup = 0;
  const seen = new Set<string>();
  for (const r of [...(staff.data ?? []), ...(workers.data ?? [])] as unknown as PersonRow[]) {
    const bio = String(r.biometric_id ?? "").trim();
    if (!bio || seen.has(bio)) continue; // a shared id is an enrolment mistake; first claim wins here
    seen.add(bio);
    const group = r.category?.timing_group ?? null;
    if (!group) {
      noGroup++;
      continue;
    }
    people.push({ bio, name: r.name, code: r.code, group });
  }
  return { people, noGroup };
}

async function trend(): Promise<TrendRow[]> {
  const s = await createClient();
  const { data, error } = await s.rpc("hr_attendance_trend", { p_days: 7 });
  if (error) {
    console.error("[hr-dashboard] trend failed", error);
    return [];
  }
  return (data ?? []) as TrendRow[];
}

export async function getHrDashboard(now: number): Promise<HrDashboard> {
  const timings = await listGroupTimings();
  const from = new Date(fetchFrom(timings, now)).toISOString();
  const [{ people, noGroup }, punches, trendRows, devices] = await Promise.all([
    enrolledPeople(),
    punchesSince(from),
    trend(),
    listDevices(),
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
          group: g.group,
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
    trend: trendRows,
    devices,
    feed: feed.slice(0, 25),
    unlinkedIds: unlinked.size,
    noGroup,
  };
}
