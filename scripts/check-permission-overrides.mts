// Verification for the permission-override vocabulary
// (lib/orders/overrides/override-modules.ts against 0650).
//
//     npm run check:permission-overrides      (also runs inside `build:check`)
//
// Listed in tsconfig `exclude` like every other .mts checker: run with tsx.
//
// WHY IT EXISTS: the override keys are declared twice — the SQL catalog the
// database enforces (0650's CHECK + `permission_override_kind()`), and the TS
// twin the screens read to decide which fields to unlock. Two literals nobody
// syncs is how the screen ends up offering a key the database refuses, or
// unlocking a field the trigger will reject. Same reason check:amendment-scope
// exists for the revision seed this one borrows from.
//
// What it asserts:
//
//   1. THE CATALOG AGREES, THREE WAYS — TS `OVERRIDE_KEYS`, 0650's CHECK list,
//      0650's `permission_override_kind()` CASE and its self-check array are
//      the same eight keys, and every key maps to the same kind on both sides.
//   2. EVERY KEY OPENS SOMETHING, AND ONLY WHAT ITS KIND OPENS — each mapped
//      kind is a seeded, OFFERED revision kind (never legacy `bom_revision`).
//   3. R-17: AN OVERRIDE IS AS NARROW AS ITS KEY — `price_change` opens no
//      quantity table; `delivery_date_ext` opens exactly one header column and
//      renders as exactly ["delivery_date"]; no Order Entry key reaches a table
//      only 0627's whole-document overlay would open (e.g. styles); the three
//      module keys unlock their own editor and no other.
//   4. THE RULES — R-1 email normalisation, R-16 reason length (TS constant =
//      the SQL CHECK literal), D-3 expiry window, and the status badge vectors
//      (AC-4's "expired one second ago" among them).
//   5. MIGRATION HYGIENE — every function 0650 / 0651 create has a
//      `revoke all … from public, anon` (STANDING), every table enables RLS.
//   6. 0651's CONSTANTS AGREE — commit TTL and max days are the TS numbers,
//      and `override_is_recalc()` names exactly BOM_DERIVED_SCOPE's columns
//      (a recalculated field the audit forgets to label reads as typed).

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AMENDMENT_SCOPE_SEED,
  BOM_DERIVED_SCOPE,
  OFFERED_KINDS,
  ORDER_ENTRY_WHOLE,
  openAreasOf,
} from "../lib/orders/amendments/amendment-entry.ts";
import {
  OVERRIDE_GROUPS,
  OVERRIDE_KEYS,
  OVERRIDE_KEY_AREA,
  OVERRIDE_KEY_KIND,
  OVERRIDE_COMMIT_TTL_MINUTES,
  OVERRIDE_MAX_DAYS,
  OVERRIDE_MIN_REASON,
  expiryProblem,
  grantStatusOf,
  normalizeEmail,
  overrideAreasOf,
  overrideKeyLabel,
  overrideScopeOf,
  overrideScopeFromJson,
  qtyDirectionProblem,
  reasonProblem,
} from "../lib/orders/overrides/override-modules.ts";

let failures = 0;
function fail(msg: string) {
  failures++;
  console.error(`FAIL  ${msg}`);
}
function ok(msg: string) {
  console.log(`ok    ${msg}`);
}
function check(cond: boolean, msg: string) {
  if (cond) ok(msg);
  else fail(msg);
}
const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

const root = resolve(import.meta.dirname ?? ".", "..");
const readMig = (f: string) => readFileSync(resolve(root, "supabase/migrations", f), "utf8");
/* Comments out before parsing — the headers describe the catalog in prose. */
const strip = (s: string) => s.replace(/--[^\n]*/g, "");
const code = strip(readMig("0650_permission_overrides.sql"));
const code51 = strip(readMig("0651_permission_override_rpcs.sql"));
const code53 = strip(readMig("0653_permission_override_enforcement.sql"));
const code55 = strip(readMig("0655_permission_override_budget_and_cascades.sql"));
const code56 = strip(readMig("0656_order_override_edit_count.sql"));
const code57 = strip(readMig("0657_permission_override_gate_self_only.sql"));

// ---------------------------------------------------------------------------
// 1. The catalog agrees
// ---------------------------------------------------------------------------

const checkList = code.match(/module_key\s+text\s+not\s+null\s+check\s*\(\s*module_key\s+in\s*\(([^)]*)\)/i);
const sqlCheckKeys = checkList ? [...checkList[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : [];
if (!checkList) fail("0650: the module_key CHECK list was not found");

const kindFn = code.match(/function public\.permission_override_kind\(p_key text\)[\s\S]*?\$\$([\s\S]*?)\$\$/i);
const sqlKind: Record<string, string> = {};
if (!kindFn) fail("0650: permission_override_kind() was not found");
else for (const m of kindFn[1].matchAll(/when\s+'([a-z_]+)'\s+then\s+'([a-z_]+)'/gi)) sqlKind[m[1]] = m[2];

const selfCheck = code.match(/v_keys\s+text\[\]\s*:=\s*array\[([^\]]*)\]/i);
const sqlSelfKeys = selfCheck ? [...selfCheck[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : [];
if (!selfCheck) fail("0650: the self-check key array was not found");

check(same(OVERRIDE_KEYS, sqlCheckKeys), `TS OVERRIDE_KEYS = 0650 CHECK list (${sqlCheckKeys.length} keys)`);
check(same(OVERRIDE_KEYS, Object.keys(sqlKind)), "TS OVERRIDE_KEYS = permission_override_kind() cases");
check(same(OVERRIDE_KEYS, sqlSelfKeys), "TS OVERRIDE_KEYS = 0650's self-check array");
for (const k of OVERRIDE_KEYS) {
  if (sqlKind[k] !== OVERRIDE_KEY_KIND[k]) fail(`${k}: TS maps to ${OVERRIDE_KEY_KIND[k]}, SQL to ${sqlKind[k]}`);
}
ok("every key maps to the same kind in TS and SQL");
check(/else\s+null/i.test(kindFn?.[1] ?? ""), "an unknown key maps to NULL in SQL (opens nothing)");
check(
  same(OVERRIDE_GROUPS.flatMap((g) => g.keys), OVERRIDE_KEYS),
  "the admin screen's groups offer every key exactly once",
);
check(overrideKeyLabel("price_change") === "Price Change" && overrideKeyLabel("fabric_bom") === "Fabric Plan",
  "labels are the Raise Revision wording");

// ---------------------------------------------------------------------------
// 2. Every key opens something real
// ---------------------------------------------------------------------------

for (const k of OVERRIDE_KEYS) {
  const kind = OVERRIDE_KEY_KIND[k];
  if (!OFFERED_KINDS.includes(kind)) fail(`${k} → ${kind}, which is not an offered revision kind`);
  if (Object.keys(AMENDMENT_SCOPE_SEED[kind] ?? {}).length === 0) fail(`${k} → ${kind} opens no table`);
}
ok("every key maps to an offered, seeded revision kind");

// ---------------------------------------------------------------------------
// 3. R-17: as narrow as the key
// ---------------------------------------------------------------------------

const price = overrideScopeOf(["price_change"]);
check(!("garment_order_amendment_quantities" in price), "AC-7: price_change opens no quantity table");
check(!!price.garment_order_amendment_style_prices, "price_change opens the style prices");

const delivery = overrideScopeOf(["delivery_date_ext"]);
check(
  Object.keys(delivery).length === 1 &&
    same(delivery.garment_order_amendments?.columns ?? ["(whole)"], ["delivery_date"]) &&
    !delivery.garment_order_amendments?.insert &&
    !delivery.garment_order_amendments?.delete,
  "delivery_date_ext opens exactly the header's delivery_date",
);
check(same(openAreasOf(delivery), ["delivery_date"]), `delivery_date_ext unlocks exactly ["delivery_date"] (got ${JSON.stringify(openAreasOf(delivery))})`);

const orderKeys = OVERRIDE_KEYS.filter((k) => OVERRIDE_KEY_AREA[k] === "order");
const allOrder = overrideScopeOf(orderKeys);
check(allOrder.garment_order_amendments?.columns !== null, "no Order Entry key opens the header WHOLE (that is 0627's overlay)");
const overlayOnly = Object.keys(ORDER_ENTRY_WHOLE).filter((t) => !(t in allOrder));
check(
  overlayOnly.includes("garment_order_amendment_styles"),
  `all five Order Entry keys together still leave overlay-only tables shut (${overlayOnly.length}, incl. styles)`,
);

for (const k of OVERRIDE_KEYS) {
  const areas = overrideAreasOf([k]);
  if (!same(areas, [OVERRIDE_KEY_AREA[k]])) fail(`${k} unlocks ${JSON.stringify(areas)}, expected ["${OVERRIDE_KEY_AREA[k]}"]`);
}
ok("each key unlocks its own editor and no other");
check(overrideScopeOf(["bom_revision", "nonsense"]) && Object.keys(overrideScopeOf(["bom_revision", "nonsense"])).length === 0,
  "unknown / legacy keys open nothing");

// ---------------------------------------------------------------------------
// 4. The rules
// ---------------------------------------------------------------------------

check(normalizeEmail(" Ravi@Raagam.in ") === "ravi@raagam.in", "AC-12: emails normalise lower-cased and trimmed");

const sqlReason = code.match(/reason\s+text\s+not\s+null\s+check\s*\(\s*char_length\(btrim\(reason\)\)\s*>=\s*(\d+)\s*\)/i);
check(!!sqlReason && Number(sqlReason[1]) === OVERRIDE_MIN_REASON, `R-16: TS OVERRIDE_MIN_REASON = SQL CHECK (${sqlReason?.[1]})`);
check(reasonProblem("  123456789 ") !== null && reasonProblem("1234567890") === null, "a reason needs 10 characters after trimming");

const now = new Date("2026-09-29T10:00:00Z");
const day = 86_400_000;
check(expiryProblem(new Date(now.getTime() - 1000), now) !== null, "an expiry in the past is refused");
check(expiryProblem(now, now) !== null, "an expiry of exactly now is refused");
check(expiryProblem(new Date(now.getTime() + OVERRIDE_MAX_DAYS * day), now) === null, `exactly ${OVERRIDE_MAX_DAYS} days is allowed`);
check(expiryProblem(new Date(now.getTime() + OVERRIDE_MAX_DAYS * day + 60_000), now) !== null, `beyond ${OVERRIDE_MAX_DAYS} days is refused`);
check(expiryProblem(new Date("nope"), now) !== null, "no expiry is refused (D-3)");

const g = (over: Partial<{ can_edit: boolean; revoked_at: string | null; override_expiry: string }>) => ({
  can_edit: true,
  revoked_at: null,
  override_expiry: new Date(now.getTime() + day).toISOString(),
  ...over,
});
check(grantStatusOf(g({}), now) === "active", "a live grant reads Active");
check(grantStatusOf(g({ override_expiry: new Date(now.getTime() - 1000).toISOString() }), now) === "expired",
  "AC-4: expired one second ago reads Expired");
check(grantStatusOf(g({ revoked_at: now.toISOString(), override_expiry: new Date(now.getTime() - day).toISOString() }), now) === "revoked",
  "revoked wins over expired");
check(grantStatusOf(g({ can_edit: false }), now) === "disabled", "R-2: can_edit = false is not active");

/* D-6 for quantities (the server action's half; the trigger cannot see a total). */
check(qtyDirectionProblem(["qty_addition"], 100, 120) === null, "D-6: Quantity Addition may raise the total");
check(qtyDirectionProblem(["qty_addition"], 100, 90) !== null, "D-6: Quantity Addition may not lower it");
check(qtyDirectionProblem(["qty_cancellation"], 100, 90) === null, "D-6: Quantity Cancellation may lower the total");
check(qtyDirectionProblem(["qty_cancellation"], 100, 120) !== null, "D-6: Quantity Cancellation may not raise it");
check(qtyDirectionProblem(["qty_addition", "qty_cancellation"], 100, 50) === null, "D-6: holding both allows either way");
check(qtyDirectionProblem(["price_change"], 100, 50) === null, "D-6: no quantity key → nothing to judge (the trigger keeps quantities shut)");

/* The override's scope is read PLAIN: parsing what order_override_scope()
   returns must not grow it the way scopeFromJson grows a revision's scope. */
const priceJson = JSON.parse(JSON.stringify(overrideScopeOf(["price_change"])));
const reread = overrideScopeFromJson(priceJson);
check(
  same(Object.keys(reread), Object.keys(overrideScopeOf(["price_change"]))) &&
    !("garment_order_amendment_styles" in reread) &&
    !("garment_order_amendment_files" in reread),
  "overrideScopeFromJson adds no overlay (no whole-document tables, no files table)",
);

// ---------------------------------------------------------------------------
// 5. Migration hygiene
// ---------------------------------------------------------------------------

for (const [name, src] of [["0650", code], ["0651", code51], ["0653", code53], ["0655", code55], ["0656", code56], ["0657", code57]] as const) {
  const fns = [...src.matchAll(/create or replace function public\.([a-z_]+)\(/gi)].map((m) => m[1]);
  for (const f of fns) {
    const re = new RegExp(`revoke all on function public\\.${f}\\([^)]*\\)\\s+from public, anon`, "i");
    if (!re.test(src)) fail(`${name}: function ${f} has no "revoke all … from public, anon"`);
  }
  ok(`${name}: all ${fns.length} functions revoke from public, anon`);
}
const tables = [...code.matchAll(/create table if not exists public\.([a-z_]+)/gi)].map((m) => m[1]);
for (const t of tables) {
  if (!new RegExp(`alter table public\\.${t}\\s+enable row level security`, "i").test(code)) fail(`0650: table ${t} does not enable RLS`);
}
ok(`0650: all ${tables.length} tables enable RLS`);

// ---------------------------------------------------------------------------
// 6. 0651's constants agree
// ---------------------------------------------------------------------------

const ttl = code51.match(/override_commit_ttl\(\)[\s\S]*?interval '(\d+) minutes'/i);
check(!!ttl && Number(ttl[1]) === OVERRIDE_COMMIT_TTL_MINUTES, `commit TTL: SQL ${ttl?.[1]} min = TS ${OVERRIDE_COMMIT_TTL_MINUTES}`);
const maxd = code51.match(/override_max_days\(\)[\s\S]*?\$\$\s*select\s+(\d+)\s*\$\$/i);
check(!!maxd && Number(maxd[1]) === OVERRIDE_MAX_DAYS, `max days: SQL ${maxd?.[1]} = TS ${OVERRIDE_MAX_DAYS}`);

/* override_is_recalc(): one `p_table in (…)` clause for the whole tables, then
   `p_table = / in … and p_field in (…)` clauses for the column lists. */
const recalcFn = code51.match(/function public\.override_is_recalc\([^)]*\)[\s\S]*?\$\$([\s\S]*?)\$\$/i)?.[1] ?? "";
const colClauses = [...recalcFn.matchAll(/p_table\s*(?:=|in)\s*(\([^)]*\)|'[a-z_]+')\s+and\s+p_field\s+in\s*\(([^)]*)\)/gi)];
const sqlCols = new Map<string, string[]>();
for (const m of colClauses) {
  const cols = [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  for (const t of m[1].matchAll(/'([a-z_]+)'/g)) sqlCols.set(t[1], cols);
}
const wholeClause = recalcFn.replace(/\(\s*p_table[^)]*\)\s+and\s+p_field\s+in\s*\([^)]*\)/gi, "")
  .match(/p_table\s+in\s*\(([^)]*)\)/i);
const sqlWhole = wholeClause ? [...wholeClause[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [];
const derived = Object.entries(BOM_DERIVED_SCOPE);
const tsWhole = derived.filter(([, e]) => e.columns === null).map(([t]) => t);
const tsCols = derived.filter(([, e]) => e.columns !== null);
check(same(tsWhole, sqlWhole), `override_is_recalc whole tables = BOM_DERIVED_SCOPE (${sqlWhole.join(", ")})`);
check(
  tsCols.length === sqlCols.size && tsCols.every(([t, e]) => same(e.columns ?? [], sqlCols.get(t) ?? [])),
  `override_is_recalc column lists = BOM_DERIVED_SCOPE (${sqlCols.size} tables)`,
);

// ---------------------------------------------------------------------------
// 7. The lock survives the override (0653, AC-17)
// ---------------------------------------------------------------------------
// 0653 re-creates the two lock triggers. The override may only ADD to them:
// every statement line of the body it replaces must still be there, in order.
// A line dropped — a step lost in the copy — is exactly how 0619 and 0629 each
// lost 0617's guard by re-creating a function from an older body.

function fnBody(src: string, fn: string): string[] {
  const m = src.match(new RegExp(`create or replace function public\\.${fn}\\(\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$`, "i"));
  return (m?.[1] ?? "").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}
function isSubsequence(needle: string[], hay: string[]): string | null {
  let i = 0;
  for (const line of needle) {
    while (i < hay.length && hay[i] !== line) i++;
    if (i === hay.length) return line;
    i++;
  }
  return null;
}
/* The LATEST migration that re-creates a function is the one the database
   runs — found by scanning, so the next migration to touch these triggers is
   held to the same rule without anyone remembering to edit this list. */
const migFiles = readdirSync(resolve(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
function latestDefining(fn: string): string | null {
  const re = new RegExp(`create or replace function public\\.${fn}\\(\\)`, "i");
  return [...migFiles].reverse().find((f) => re.test(strip(readMig(f)))) ?? null;
}
for (const [fn, baseFiles] of [
  ["refuse_when_order_locked", ["0619_order_amendment_modules_revert.sql", "0653_permission_override_enforcement.sql"]],
  ["refuse_when_budget_approved", ["0576_budget_approval_lock.sql", "0653_permission_override_enforcement.sql"]],
] as const) {
  const latestFile = latestDefining(fn);
  const next = latestFile ? fnBody(strip(readMig(latestFile)), fn) : [];
  for (const baseFile of baseFiles) {
    if (baseFile === latestFile) continue;
    const base = fnBody(strip(readMig(baseFile)), fn);
    if (base.length === 0 || next.length === 0) {
      fail(`${fn}: body not found in ${base.length === 0 ? baseFile : latestFile}`);
      continue;
    }
    const lost = isSubsequence(base, next);
    check(lost === null, lost === null
      ? `${fn}: every line of ${baseFile.slice(0, 4)}'s body survives in ${latestFile?.slice(0, 4)}, in order (${base.length} lines)`
      : `${fn}: ${latestFile?.slice(0, 4)} dropped a line of ${baseFile.slice(0, 4)}'s body: "${lost}"`);
  }
}
/* And the override is consulted only where the lock was already refusing. */
const lockBody = fnBody(strip(readMig(latestDefining("refuse_when_order_locked") ?? "")), "refuse_when_order_locked").join("\n");
const iMsg = lockBody.indexOf("if v_msg is not null then");
const iOvr = lockBody.indexOf("order_override_scope(");
const iRaise = lockBody.indexOf("hint = 'order_locked'");
check(iMsg >= 0 && iMsg < iOvr && iOvr < iRaise,
  "the override is asked only inside the hard-lock branch, before its refusal (no lookup on an open order)");

// ---------------------------------------------------------------------------

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck:permission-overrides — all assertions passed");
