/**
 * npm run check:favorites — Home Favourites (0812) cannot ship a tile that lies.
 *
 *   1. Every action key is well-formed and declared once.
 *   2. Every action's link is a real page in app/.
 *   3. Every `?new=1` link lands on a page that READS the intent — the page, or a file it
 *      imports, calls `useCreateIntent` (directly or through `MasterListShell`). Without that
 *      the tile quietly opens a LIST, which is the "menu diving" the feature exists to end.
 *   4. Every key a migration seeds into `favorite_defaults` resolves in the registry — a seed
 *      the registry does not know is a tile nobody ever sees, and nobody is told.
 *   5. The merge rule (lib/favorites/merge.ts), by vectors.
 *
 * Verified by being made to FAIL first (2026-11-05): Vehicle Dispatch given `?new=1` (a board
 * that never reads the intent) and the `leave-request` key renamed under its seed — each fired
 * alone. (Raise PO given `?new=1` did NOT fail, correctly: it is a MasterListShell screen and
 * opens its editor from the intent, so the tile now uses it.)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { FAVORITE_ACTIONS, resolveFavorite, isPinnablePath, screenKey } from "../lib/favorites/registry.ts";
import { mergeFavorites } from "../lib/favorites/merge.ts";

const ROOT = resolve(import.meta.dirname, "..");
let failures = 0;
const fail = (m: string) => {
  failures += 1;
  console.error("✗ " + m);
};

// ── 1 ──
const seen = new Set<string>();
for (const a of FAVORITE_ACTIONS) {
  if (!/^[a-z0-9-]+$/.test(a.key)) fail(`action key "${a.key}" breaks 0812's check constraint (a-z, 0-9, -)`);
  if (seen.has(a.key)) fail(`action key "${a.key}" is declared twice`);
  seen.add(a.key);
}

// ── 2 · route → page.tsx, route groups "(x)" ignored ──
function pagesUnder(dir: string, url: string, out: Map<string, string>) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (!statSync(p).isDirectory()) {
      if (name === "page.tsx") out.set(url || "/", p);
      continue;
    }
    if (name.startsWith("_") || name.startsWith("@") || name === "api") continue;
    const seg = name.startsWith("(") && name.endsWith(")") ? "" : "/" + name;
    pagesUnder(p, url + seg, out);
  }
}
const PAGES = new Map<string, string>();
pagesUnder(join(ROOT, "app"), "", PAGES);

/** One level of imports: relative paths and the `@/` alias, as files on disk. */
function importedFiles(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
    const spec = m[1];
    const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : spec.startsWith(".") ? join(dirname(file), spec) : null;
    if (!base) continue;
    for (const cand of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
      if (existsSync(cand) && statSync(cand).isFile()) {
        out.push(cand);
        break;
      }
    }
  }
  return out;
}
const READS_INTENT = /useCreateIntent\(|<MasterListShell\b/;

for (const a of FAVORITE_ACTIONS) {
  const [path, query = ""] = a.href.split("?");
  const page = PAGES.get(path);
  if (!page) {
    fail(`${a.key}: ${path} is not a page under app/`);
    continue;
  }
  if (new URLSearchParams(query).get("new") === "1") {
    const files = [page, ...importedFiles(page)];
    if (!files.some((f) => READS_INTENT.test(readFileSync(f, "utf8")))) {
      fail(`${a.key}: ${a.href} — ${path} never reads ?new=1 (no useCreateIntent / MasterListShell in the page or what it imports), so the tile would open a list`);
    }
  }
}

// ── 4 · every seeded key resolves ──
const MIG = join(ROOT, "supabase", "migrations");
for (const f of readdirSync(MIG).filter((n) => n.endsWith(".sql"))) {
  const sql = readFileSync(join(MIG, f), "utf8");
  if (!/insert into public\.favorite_defaults/i.test(sql)) continue;
  for (const m of sql.matchAll(/'((?:a:[a-z0-9-]+)|(?:screen:\/[a-z0-9/_-]*))'/g)) {
    if (!resolveFavorite(m[1])) fail(`${f} seeds ${m[1]}, which lib/favorites/registry.ts does not declare`);
  }
}

// ── pins ──
if (isPinnablePath("/")) fail("Home itself must not be pinnable");
if (screenKey("/HR/Payslip/?x=1") !== "screen:/hr/payslip") fail(`screenKey drops the query and lower-cases: got ${screenKey("/HR/Payslip/?x=1")}`);

// ── 5 · the merge rule ──
const R1 = "11111111-1111-1111-1111-111111111111";
const R2 = "22222222-2222-2222-2222-222222222222";
const keys = (xs: { key: string }[]) => xs.map((x) => x.key).join(",");
const vec = (name: string, got: string, want: string) => {
  if (got !== want) fail(`merge · ${name}: got [${got}], want [${want}]`);
};
const D = [
  { item_key: "a:r2", role_id: R2, position: 1 },
  { item_key: "a:e2", role_id: null, position: 2 },
  { item_key: "a:r1", role_id: R1, position: 1 },
  { item_key: "a:e1", role_id: null, position: 1 },
  { item_key: "a:both", role_id: R1, position: 2 },
  { item_key: "a:both", role_id: R2, position: 2 },
  { item_key: "a:other", role_id: "33333333-3333-3333-3333-333333333333", position: 1 },
];
vec("everyone, then roles in held order, each by position; a role not held is ignored; a tile from two roles once",
  keys(mergeFavorites(D, [], [R1, R2])), "a:e1,a:e2,a:r1,a:both,a:r2");
const hid = mergeFavorites(D, [{ item_key: "a:e1", position: null, hidden: true }], [R1]);
vec("a hidden default stays in the list, flagged", keys(hid), "a:e1,a:e2,a:r1,a:both");
if (!hid[0].hidden) fail("merge · a hidden default must come back hidden");
vec("a pin joins after the defaults", keys(mergeFavorites(D, [{ item_key: "screen:/hr/payslip", position: null, hidden: false }], [])), "a:e1,a:e2,screen:/hr/payslip");
vec("a hidden row on a non-default means nothing",
  keys(mergeFavorites(D, [{ item_key: "screen:/x", position: null, hidden: true }], [])), "a:e1,a:e2");
vec("the person's order wins; unarranged ones follow in base order",
  keys(mergeFavorites(D, [{ item_key: "a:r1", position: 1, hidden: false }, { item_key: "a:e2", position: 2, hidden: false }], [R1])),
  "a:r1,a:e2,a:e1,a:both");
const pinned = mergeFavorites([], [{ item_key: "screen:/hr/payslip", position: null, hidden: false }], []);
if (pinned[0]?.source !== "mine") fail("merge · a pin's source is 'mine'");

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log(`check:favorites — ${FAVORITE_ACTIONS.length} tiles, links and intents ok; seeds ok; merge rule ok`);
