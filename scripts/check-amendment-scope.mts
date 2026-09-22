// Verification for the Amendment Entry's scope vocabulary
// (lib/orders/amendments/amendment-entry.ts against 0604's seed).
//
//     npm run check:amendment-scope      (also runs inside `build:check`)
//
// Listed in tsconfig `exclude` like every other .mts checker: run with tsx.
//
// WHY IT EXISTS (doc/order/amendment-plan.md §3): the scope — which tables and
// columns each Change Category opens while an order is `amending` — is
// declared ONCE, in the database (`order_amendment_scopes`, seeded by 0604),
// and the trigger enforces it. The SCREENS read a TypeScript mirror of that
// seed so the fields they show as editable are the fields the trigger will
// accept. Two literals nobody syncs is the failure `FLAGLESS_PICKERS` and the
// ambiguous-embed catalog were built to avoid; this check is what makes the
// mirror a mirror rather than a memory.
//
// What it asserts, each verified by being made to FAIL first:
//
//   1. THE TS MIRROR AND THE SQL SEED AGREE — every type, every table, the same
//      columns, the same insert / delete verdicts. Parsed out of 0604's seed
//      literal (both `values` blocks: the four hand-written types and the
//      `cross join` that seeds the two quantity types identically).
//   2. DELIVERY DATE EXTENSION OPENS EXACTLY ONE FIELD — the spec's worked
//      example; a scope that quietly grew is a scope that stopped meaning
//      anything. And `openAreasOf` renders it as exactly ["delivery_date"].
//   3. NO SCOPE NAMES A T&A TABLE, and none names `order_budget_lines` — a
//      budget line is not amended, it is re-pulled.
//   4. EVERY TABLE THE ORDER EDITOR'S SECTION MAP NAMES IS A LOCKED TABLE (one
//      0576 attaches `trg_order_lock` to) — a section keyed to a table the
//      lock never sees would unlock nothing and refuse nothing.
//   5. THE UNION RULE MATCHES 0616's: a two-type scope opens the union of
//      columns, and a table one type opens whole is whole.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AMENDMENT_ENTRY_TYPE_VALUES,
  AMENDMENT_SCOPE_SEED,
  ORDER_HEADER_FIELD_AREAS,
  ORDER_SECTION_TABLES,
  openAreasOf,
  unionScope,
  type ScopeEntry,
} from "../lib/orders/amendments/amendment-entry.ts";

let failures = 0;
function fail(msg: string) {
  failures++;
  console.error(`FAIL  ${msg}`);
}
function ok(msg: string) {
  console.log(`ok    ${msg}`);
}

const root = resolve(import.meta.dirname ?? ".", "..");
/* THE SEED IS 0604 PLUS EVERY LATER CORRECTION: 0618 added both BOMs to
   combo_colour_change with a plain `values` block and `on conflict … do update`.
   Parsed in order, so a later row for the same (type, table) wins. */
const seedSql = ["0604_order_amendment_scope.sql", "0618_order_amendment_supersede.sql"]
  .map((f) => readFileSync(resolve(root, "supabase/migrations", f), "utf8"))
  .join("\n");
const lockSql = readFileSync(resolve(root, "supabase/migrations/0576_budget_approval_lock.sql"), "utf8");

// ---------------------------------------------------------------------------
// Parse the SQL seed
// ---------------------------------------------------------------------------

type Seed = Record<string, Record<string, ScopeEntry>>;

function parseColumns(raw: string): string[] | null {
  const t = raw.trim();
  if (/^null(::text\[\])?$/i.test(t)) return null;
  const m = t.match(/^array\[(.*)\]$/is);
  if (!m) throw new Error(`unreadable columns literal: ${raw}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
}

function parseSeed(sql: string): Seed {
  const seed: Seed = {};
  const put = (type: string, table: string, columns: string[] | null, ins: boolean, del: boolean) => {
    (seed[type] ??= {})[table] = { columns, insert: ins, delete: del };
  };

  /* Block 1: ('type', 'table', <columns>, bool, bool) — rows with a TYPE first. */
  const typed = /\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*,\s*(null|array\[[^\]]*\])\s*,\s*(true|false)\s*,\s*(true|false)\s*\)/gis;
  for (const m of sql.matchAll(typed)) {
    put(m[1], m[2], parseColumns(m[3]), m[4] === "true", m[5] === "true");
  }

  /* Block 2: the cross join — `(values ('qty_addition'), ('qty_cancellation'))`
     × rows of ('table'::name, <columns>, bool, bool). */
  const cj = sql.match(/from\s*\(values\s*((?:\('[a-z_]+'\)\s*,?\s*)+)\)\s*as\s+t\(amendment_type\)\s*cross\s+join\s*\(values\s*(.*?)\)\s*as\s+s\(/is);
  if (!cj) throw new Error("0604: the cross-join seed block was not found");
  const types = [...cj[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  const rows = /\(\s*'([a-z_]+)'(?:::name)?\s*,\s*(null(?:::text\[\])?|array\[[^\]]*\])\s*,\s*(true|false)\s*,\s*(true|false)\s*\)/gis;
  for (const m of cj[2].matchAll(rows)) {
    for (const t of types) put(t, m[1], parseColumns(m[2]), m[3] === "true", m[4] === "true");
  }
  return seed;
}

const sqlSeed = parseSeed(seedSql);

// ---------------------------------------------------------------------------
// 1. Mirror = seed
// ---------------------------------------------------------------------------

const norm = (e: ScopeEntry) => ({
  columns: e.columns ? [...e.columns].sort() : null,
  insert: e.insert,
  delete: e.delete,
});

for (const type of AMENDMENT_ENTRY_TYPE_VALUES) {
  const sql = sqlSeed[type];
  const ts = AMENDMENT_SCOPE_SEED[type];
  if (!sql) {
    fail(`${type}: not seeded in 0604`);
    continue;
  }
  const tables = new Set([...Object.keys(sql), ...Object.keys(ts)]);
  let drift = 0;
  for (const table of tables) {
    const a = sql[table];
    const b = ts[table];
    if (!a) {
      fail(`${type}: TS mirror opens ${table}, the SQL seed does not`);
      drift++;
    } else if (!b) {
      fail(`${type}: SQL seed opens ${table}, the TS mirror does not`);
      drift++;
    } else if (JSON.stringify(norm(a)) !== JSON.stringify(norm(b))) {
      fail(`${type}: ${table} differs — sql ${JSON.stringify(norm(a))} vs ts ${JSON.stringify(norm(b))}`);
      drift++;
    }
  }
  if (drift === 0) ok(`${type}: ${Object.keys(sql).length} tables agree`);
}
for (const type of Object.keys(sqlSeed)) {
  if (!(AMENDMENT_ENTRY_TYPE_VALUES as readonly string[]).includes(type)) {
    fail(`0604 seeds ${type}, which the TS mirror does not offer`);
  }
}

// ---------------------------------------------------------------------------
// 2. Delivery Date Extension opens one field
// ---------------------------------------------------------------------------

{
  const d = AMENDMENT_SCOPE_SEED.delivery_date_ext;
  const tables = Object.keys(d);
  const only = tables.length === 1 && tables[0] === "garment_order_amendments";
  const cols = d.garment_order_amendments?.columns;
  const oneCol = Array.isArray(cols) && cols.length === 1 && cols[0] === "delivery_date";
  const noRows = d.garment_order_amendments?.insert === false && d.garment_order_amendments?.delete === false;
  if (only && oneCol && noRows) ok("delivery_date_ext opens exactly garment_order_amendments.delivery_date");
  else fail(`delivery_date_ext opens ${JSON.stringify(d)}`);

  const areas = openAreasOf(d);
  if (areas.length === 1 && areas[0] === "delivery_date") ok('openAreasOf(delivery_date_ext) === ["delivery_date"]');
  else fail(`openAreasOf(delivery_date_ext) = ${JSON.stringify(areas)}`);
}

// ---------------------------------------------------------------------------
// 3. Nothing T&A, nothing budget
// ---------------------------------------------------------------------------

{
  let bad = 0;
  for (const [type, tables] of Object.entries(AMENDMENT_SCOPE_SEED)) {
    for (const t of Object.keys(tables)) {
      if (t.includes("_ta_") || t.startsWith("order_budget")) {
        fail(`${type} scopes ${t} — T&A is execution and a budget line is re-pulled, never amended`);
        bad++;
      }
    }
  }
  if (bad === 0) ok("no scope names a T&A table or a budget table");
}

// ---------------------------------------------------------------------------
// 4. The editor's section map names locked tables only
// ---------------------------------------------------------------------------

{
  const locked = new Set([...lockSql.matchAll(/\(\s*'([a-z_]+)'\s*,\s*array\[/g)].map((m) => m[1]));
  if (locked.size < 40) fail(`0576's attach list parsed to ${locked.size} tables — expected ~47`);
  let bad = 0;
  for (const [section, tables] of Object.entries(ORDER_SECTION_TABLES)) {
    for (const t of tables) {
      if (!locked.has(t)) {
        fail(`ORDER_SECTION_TABLES.${section} names ${t}, which 0576 does not lock`);
        bad++;
      }
    }
  }
  for (const col of Object.keys(ORDER_HEADER_FIELD_AREAS)) {
    const opened = Object.values(AMENDMENT_SCOPE_SEED).some((s) =>
      s.garment_order_amendments?.columns?.includes(col),
    );
    if (!opened) {
      fail(`ORDER_HEADER_FIELD_AREAS.${col} has a field area but no category opens that column`);
      bad++;
    }
  }
  if (bad === 0) ok(`the editor's ${Object.keys(ORDER_SECTION_TABLES).length} sections and ${Object.keys(ORDER_HEADER_FIELD_AREAS).length} header fields map onto locked tables and opened columns`);
}

// ---------------------------------------------------------------------------
// 5. The union rule
// ---------------------------------------------------------------------------

{
  const u = unionScope(["delivery_date_ext", "price_change"]);
  const cols = u.garment_order_amendments?.columns ?? [];
  const both = cols.includes("delivery_date") && cols.includes("ex_rate");
  const grids = u.garment_order_amendment_price_details?.insert === true;
  if (both && grids) ok("unionScope: delivery_date_ext + price_change = the union of header columns plus the price grids");
  else fail(`unionScope wrong: ${JSON.stringify(u.garment_order_amendments)} / ${JSON.stringify(u.garment_order_amendment_price_details)}`);

  const w = unionScope(["bom_revision", "qty_addition"]);
  if (w.order_fabric_boms?.columns === null && w.order_fabric_boms.delete === false) ok("unionScope: a table one type opens whole stays whole, and delete stays refused when neither allows it");
  else fail(`unionScope whole-table rule wrong: ${JSON.stringify(w.order_fabric_boms)}`);

  const areas = openAreasOf(unionScope(["qty_addition"]));
  if (areas.includes("quantities") && areas.includes("approvalqty") && areas.includes("excess_pct") && !areas.includes("orderinfo") && !areas.includes("prices")) {
    ok("openAreasOf(qty_addition) opens Quantities, Approval Qty and the excess % — not Order Info whole, not Prices");
  } else fail(`openAreasOf(qty_addition) = ${JSON.stringify(areas)}`);
}

if (failures > 0) {
  console.error(`\n${failures} amendment-scope check(s) failed.`);
  process.exit(1);
}
console.log("\nOK — the TS scope mirror matches 0604's seed.");
