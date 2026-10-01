/**
 * check:notification-events — the event registry and its database seed agree,
 * and every declared event is actually raised (doc/admin/notification-
 * management-plan.md §2, migration 0673).
 *
 * TypeScript already refuses `notify("cad.new_ordr", …)` — the key is a union
 * type. What it cannot see, and this does:
 *
 *   1. A REGISTRY KEY WITH NO SETTINGS ROW. `notify()` falls back to the
 *      registry's defaults, so nothing breaks — and the admin screen lists an
 *      event it cannot switch. Every key must be seeded by a migration.
 *   2. A SEEDED KEY THE REGISTRY DROPPED. A switch for an alert that no longer
 *      exists lies to the admin who flips it.
 *   3. MANDATORY DISAGREEING. The registry decides; the DB copy is what makes
 *      Postgres refuse "mandatory and disabled". Two answers is no answer.
 *   4. A DECLARED EVENT NOTHING RAISES. "A column no code reads is worse than a
 *      missing one: it lies to the admin who set it" (the SLA section of
 *      AGENTS.md). Phase-2 admin events are listed in RESERVED until built.
 *
 * Seeds are read from every migration's
 * `insert into public.notification_event_settings … values (…)` tuples and any
 * later `update … set mandatory = …` on one key, in file order.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { NOTIFICATION_EVENTS } from "../lib/notifications/events";

/** Declared ahead of the code that raises them — each names its phase. */
const RESERVED: Record<string, string> = {
  "admin.test": "Phase 2 — Administration ▸ Notifications ▸ Send",
  "admin.broadcast": "Phase 2 — Administration ▸ Notifications ▸ Send",
};

const ROOT = process.cwd();
const fail: string[] = [];

// ---- seeds ------------------------------------------------------------------
type Seed = { mandatory: boolean; push: boolean; fallback: boolean; file: string };
const seeds = new Map<string, Seed>();
const migDir = join(ROOT, "supabase", "migrations");
for (const f of readdirSync(migDir).filter((n) => n.endsWith(".sql")).sort()) {
  const sql = readFileSync(join(migDir, f), "utf8").replace(/--[^\n]*/g, "");
  const ins = sql.match(/insert\s+into\s+public\.notification_event_settings\s*\(([^)]*)\)\s*values([\s\S]*?);/i);
  if (ins) {
    const cols = ins[1].split(",").map((c) => c.trim());
    // `on conflict (event_key)` is not a seed row.
    const tuples = ins[2].split(/\bon\s+conflict\b/i)[0];
    for (const t of tuples.matchAll(/\(([^()]*)\)/g)) {
      const vals = t[1].split(",").map((v) => v.trim());
      const get = (c: string) => vals[cols.indexOf(c)];
      const key = get("event_key")?.replace(/^'|'$/g, "");
      if (!key) continue;
      seeds.set(key, {
        mandatory: get("mandatory") === "true",
        push: (get("push") ?? "true") === "true",
        fallback: (get("fallback_to_admins") ?? "true") === "true",
        file: f,
      });
    }
  }
  for (const u of sql.matchAll(
    /update\s+(?:public\.)?notification_event_settings\s+set\s+mandatory\s*=\s*(true|false)\s+where\s+event_key\s*=\s*'([^']+)'/gi,
  )) {
    const s = seeds.get(u[2]);
    if (s) s.mandatory = u[1] === "true";
  }
}

for (const [key, def] of Object.entries(NOTIFICATION_EVENTS)) {
  const s = seeds.get(key);
  if (!s) {
    fail.push(`${key}: declared in lib/notifications/events.ts but no migration seeds notification_event_settings for it`);
    continue;
  }
  if (s.mandatory !== def.mandatory)
    fail.push(`${key}: mandatory is ${def.mandatory} in the registry but ${s.mandatory} in the seed (${s.file})`);
  if (s.push !== def.push) fail.push(`${key}: push default ${def.push} in the registry, ${s.push} in the seed (${s.file})`);
  if (s.fallback !== def.fallbackToAdmins)
    fail.push(`${key}: fallbackToAdmins ${def.fallbackToAdmins} in the registry, ${s.fallback} in the seed (${s.file})`);
}
for (const [key, s] of seeds) {
  if (!(key in NOTIFICATION_EVENTS))
    fail.push(`${key}: seeded by ${s.file} but not in the registry — a switch for an alert that does not exist`);
}

// ---- raised somewhere -------------------------------------------------------
const sources: string[] = [];
function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if ([".ts", ".tsx"].includes(extname(p)) && !p.endsWith(join("notifications", "events.ts"))) sources.push(p);
  }
}
for (const d of ["lib", "app", "components"]) walk(join(ROOT, d));
const text = sources.map((p) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")).join("\n");
for (const key of Object.keys(NOTIFICATION_EVENTS)) {
  if (text.includes(`"${key}"`)) {
    if (RESERVED[key]) fail.push(`${key}: is raised now — take it out of RESERVED in this script`);
    continue;
  }
  if (!RESERVED[key]) fail.push(`${key}: declared but raised nowhere under lib/, app/ or components/`);
}

const n = Object.keys(NOTIFICATION_EVENTS).length;
if (fail.length) {
  console.error(`check:notification-events — ${fail.length} problem(s) across ${n} events:`);
  for (const f of fail) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`check:notification-events — ok: ${n} events, all seeded, mandatory agrees, every one raised (${Object.keys(RESERVED).length} reserved).`);
