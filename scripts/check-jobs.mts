/**
 * check:jobs — the scheduled jobs are declared in THREE places, and they must
 * agree (doc/admin/notification-management-plan.md Phase 3, 0677):
 *
 *   lib/jobs/registry.ts         what the Scheduled Jobs screen lists and
 *                                what "late" is measured against;
 *   vercel.json  crons           what actually fires;
 *   app/api/cron/<key>/route.ts  what runs, and whether it is RECORDED.
 *
 * Each disagreement is a silent failure of the kind this screen exists to end:
 *   - a cron with no registry entry runs, and no screen ever shows it;
 *   - a registry entry with no cron reads "Late" forever, on a job nothing
 *     schedules — or worse, a schedule changed in vercel.json while the
 *     registry keeps the old one, so "late" is measured against the wrong clock;
 *   - a route that calls its sweep WITHOUT `runJob` works and records nothing,
 *     so the screen reports a healthy job as never having run.
 *
 * Also checks `everyMinutes` against the cron expression, since "late" is
 * 3× that number.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { JOBS } from "../lib/jobs/registry";

const ROOT = process.cwd();
const fail: string[] = [];

const cronDir = join(ROOT, "app", "api", "cron");
const routes = readdirSync(cronDir).filter((d) => existsSync(join(cronDir, d, "route.ts")));
const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as {
  crons?: { path: string; schedule: string }[];
};
const crons = new Map((vercel.crons ?? []).map((c) => [c.path.replace(/^\/api\/cron\//, ""), c.schedule]));

function minutesOf(expr: string): number | null {
  const [m, h, dom, mon, dow] = expr.trim().split(/\s+/);
  if (dom !== "*" || mon !== "*" || dow !== "*") return null;
  const every = m.match(/^\*\/(\d+)$/);
  if (every && h === "*") return Number(every[1]);
  if (/^\d+$/.test(m) && h === "*") return 60;
  if (/^\d+$/.test(m) && /^\d+$/.test(h)) return 1440;
  return null;
}

for (const [key, def] of Object.entries(JOBS)) {
  if (!routes.includes(key)) fail.push(`${key}: in the registry but there is no app/api/cron/${key}/route.ts`);
  const sched = crons.get(key);
  if (!sched) fail.push(`${key}: in the registry but vercel.json schedules no /api/cron/${key}`);
  else if (sched !== def.schedule)
    fail.push(`${key}: vercel.json runs it at "${sched}" but the registry says "${def.schedule}" — "late" would use the wrong clock`);
  const mins = minutesOf(def.schedule);
  if (mins == null) fail.push(`${key}: cannot read an interval from "${def.schedule}" — extend minutesOf() here`);
  else if (mins !== def.everyMinutes)
    fail.push(`${key}: "${def.schedule}" runs every ${mins} min but everyMinutes is ${def.everyMinutes}`);
}

for (const r of routes) {
  if (!(r in JOBS)) fail.push(`app/api/cron/${r}: a cron route with no registry entry — it runs, and no screen shows it`);
  const src = readFileSync(join(cronDir, r, "route.ts"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  if (!src.includes(`runJob("${r}"`))
    fail.push(`app/api/cron/${r}: does not call runJob("${r}", …) — it would run and record nothing`);
}
for (const path of crons.keys()) {
  if (!(path in JOBS)) fail.push(`vercel.json: /api/cron/${path} is scheduled but not in lib/jobs/registry.ts`);
}

const n = Object.keys(JOBS).length;
if (fail.length) {
  console.error(`check:jobs — ${fail.length} problem(s) across ${n} jobs:`);
  for (const f of fail) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`check:jobs — ok: ${n} jobs; registry, vercel.json and every cron route agree, and every route records its runs.`);
