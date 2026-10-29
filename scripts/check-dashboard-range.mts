/**
 * check-dashboard-range — the Dashboard's Custom period (2026-10-28).
 *
 * `parseCustom` turns two dates off the URL into a window or nothing, and
 * `filterWindow` turns the filters into the window every KPI queries plus the
 * equal window before it. Both feed SQL ranges, so a wrong edge is a wrong
 * figure with nothing on screen to say so. Run: npx tsx scripts/check-dashboard-range.mts
 */
import { compareLabel, filterWindow, parseCustom } from "../lib/dashboard/range";

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

eq("ordered dates pass through", parseCustom("2026-10-01", "2026-10-28"), { from: "2026-10-01", to: "2026-10-28" });
eq("reversed dates are swapped", parseCustom("2026-10-28", "2026-10-01"), { from: "2026-10-01", to: "2026-10-28" });
eq("one day is a window", parseCustom("2026-10-28", "2026-10-28"), { from: "2026-10-28", to: "2026-10-28" });
eq("not a date → null", parseCustom("2026-02-30", "2026-03-05"), null);
eq("missing half → null", parseCustom("2026-10-01", undefined), null);
eq("over a year is cut to 366 days ending on to", parseCustom("2024-01-01", "2026-10-28"), { from: "2025-10-28", to: "2026-10-28" });

eq(
  "custom compares with the equal span before it",
  filterWindow({ range: "custom", location: null, from: "2026-10-01", to: "2026-10-28" }),
  { from: "2026-10-01", to: "2026-10-28", prevFrom: "2026-09-03", prevTo: "2026-09-30" },
);
eq(
  "one custom day compares with the day before",
  filterWindow({ range: "custom", location: null, from: "2026-10-28", to: "2026-10-28" }),
  { from: "2026-10-28", to: "2026-10-28", prevFrom: "2026-10-27", prevTo: "2026-10-27" },
);
eq(
  "custom without dates falls back to Month",
  filterWindow({ range: "custom", location: null }, new Date("2026-10-28T06:00:00Z")).from,
  "2026-10-01",
);
eq("custom hint wording", compareLabel({ range: "custom", location: null }), "vs previous period");

if (failed) {
  console.error(`\ncheck-dashboard-range — ${failed} failed`);
  process.exit(1);
}
console.log("\ncheck-dashboard-range — ok");
