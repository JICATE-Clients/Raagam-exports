/**
 * Vectors for `lib/hr/timing-calc.ts` — the shift-day rule and the day status
 * the HR dashboard shows. Run: npm run check:timing-calc
 */
import { computeGroupDays, type Person } from "../lib/hr/timing-calc";
import type { CategoryTiming } from "../lib/masters/category-timing-types";

// Hours are per Employee Category (0774): an office category and a night
// security category, both under Staff.
const T = (cat: string, i: string, o: string, grace = 10): CategoryTiming => ({
  id: cat, category_id: cat, in_time: i, out_time: o, grace_minutes: grace,
  effective_from: "2026-01-01", created_at: "", created_by: null, updated_at: "",
});
const timings = [T("office", "09:00:00", "18:00:00"), T("security", "20:00:00", "08:00:00")];
const ist = (d: string, hm: string) => new Date(`${d}T${hm}:00+05:30`).toISOString();
const P = (bio: string, kind: Person["kind"], categoryId: string | null): Person => ({
  bio, name: bio, code: null, kind, categoryId, categoryName: categoryId,
});
const people: Person[] = ["A", "B", "C", "D", "E", "F", "G", "H"].map((b) => P(b, "staff", "office"));
people.push(P("S", "staff", "security"));
people.push(P("W", "worker", null)); // no category → calendar day, never late

let fail = 0;
function expect(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
}

const D = "2026-10-28";
const punches = [
  { user_id: "A", punch_time: ist(D, "08:55") },                       // on time, inside
  { user_id: "B", punch_time: ist(D, "09:25") },                       // late 25
  { user_id: "C", punch_time: ist(D, "08:50") }, { user_id: "C", punch_time: ist(D, "08:51") }, // double tap
  { user_id: "D", punch_time: ist(D, "09:00") }, { user_id: "D", punch_time: ist(D, "13:00") }, // stepped out
  { user_id: "E", punch_time: ist(D, "09:00") }, { user_id: "E", punch_time: ist(D, "11:00") },
  { user_id: "E", punch_time: ist(D, "11:30") },                       // movement, back inside
  { user_id: "G", punch_time: ist(D, "08:58") }, { user_id: "G", punch_time: ist(D, "17:55") }, // out 5 min early, inside the 10-min grace
  { user_id: "H", punch_time: ist(D, "08:58") }, { user_id: "H", punch_time: ist(D, "18:02") }, // out after 18:00
  { user_id: "S", punch_time: ist("2026-10-27", "19:58") },            // security last night
  { user_id: "S", punch_time: ist(D, "08:02") },                       // ends this morning
];

// 14:00 — staff day is the 28th, security's 16:00 window not open yet → 27th
let g = computeGroupDays(people, punches, timings, Date.parse(ist(D, "14:00")));
const st = (bio: string) => g.flatMap((x) => x.people).find((p) => p.person.bio === bio)!;
const dayOf = (cat: string) => g.flatMap((x) => x.shifts).find((x) => x.categoryId === cat)!.day;
expect("staff day", dayOf("office"), D);
expect("A inside", st("A").status, "inside");
expect("B late 25", [st("B").status, st("B").lateMin], ["inside", 25]);
expect("C double tap = one punch", [st("C").status, st("C").punches.length], ["inside", 1]);
expect("D stepped out", st("D").status, "stepped_out");
expect("E movement", [st("E").status, st("E").movements.length, st("E").movements[0].backAt != null], ["inside", 1, true]);
expect("F absent", st("F").status, "absent");
expect("security day = 27th", dayOf("security"), "2026-10-27");
expect("S night shift left on time", [st("S").status, st("S").lateMin], ["left", 0]);
expect("groups are Staff, Worker", g.map((x) => x.group), ["staff", "worker"]);
expect("W (no category) not late, not absent", st("W").status, "not_in");

// 19:00 — D never came back → left early 300 min
g = computeGroupDays(people, punches, timings, Date.parse(ist(D, "19:00")));
expect("D left early", [st("D").status, st("D").earlyMin], ["left_early", 300]);
expect("security day rolls to 28th at 19:00", dayOf("security"), D);
expect("G grace does NOT cover Punch Out: left early 5", [st("G").status, st("G").earlyMin], ["left_early", 5]);
expect("H out after Punch Out: gone home", st("H").status, "left");
expect("S not in yet tonight", st("S").status, "not_in");

// 08:30 — nobody in yet, inside grace
g = computeGroupDays(people, [], timings, Date.parse(ist(D, "08:30")));
expect("F not in yet 08:30", st("F").status, "not_in");
// 04:00 — before the 05:00 window: still yesterday's staff day
g = computeGroupDays(people, [], timings, Date.parse(ist(D, "04:00")));
expect("04:00 staff day = 27th", dayOf("office"), "2026-10-27");

if (fail) { console.error(`${fail} FAIL`); process.exit(1); }
console.log("0 FAIL");
