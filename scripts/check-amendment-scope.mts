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
//   6. THE ALWAYS-OPEN OVERLAY (0622) — the attached files, open under every
//      entry at READ time: TS constant = SQL literal, `order_amendment_of`
//      still merges it, `scopeFromJson` applies it, it opens nothing else,
//      and no seed row names the table.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AMENDMENT_ENTRY_TYPE_VALUES,
  AMENDMENT_SCOPE_SEED,
  BOM_DERIVED_SCOPE,
  BUDGET_MARKER_TABLE,
  ORDER_CHANGE_KINDS,
  areaOpen,
  areaRecalculable,
  kindsForSelection,
  kindsMoveBoms,
  ORDER_HEADER_FIELD_AREAS,
  ORDER_SECTION_TABLES,
  openAreasOf,
  unionScope,
  ALWAYS_OPEN_WHILE_AMENDING,
  scopeAllowsRewrite,
  scopeFromJson,
  scopeOpensColumn,
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
const mig = (f: string) => readFileSync(resolve(root, "supabase/migrations", f), "utf8");
/* THE SEED IS 0604 PLUS EVERY LATER CORRECTION, REPLAYED IN ORDER:
   - 0618 added both BOMs to combo_colour_change (typed rows, on conflict update);
   - 0619 re-cut it by MODULE: copied bom_revision's fabric / material rows to
     the two new BOM kinds, added the budget marker, deleted the BOM rows from
     the quantity / combo kinds and seeded their DERIVED rows by cross join.
   Every 0619 operation must be FOUND — a parse that silently skipped one
   would compare the mirror against a seed that never existed. */
const seedSql = [mig("0604_order_amendment_scope.sql"), mig("0618_order_amendment_supersede.sql")].join("\n");
const sql0619 = mig("0619_order_amendment_modules_revert.sql");
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

const TYPED = /\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*,\s*(null|array\[[^\]]*\])\s*,\s*(true|false)\s*,\s*(true|false)\s*\)/gis;
const ROW = /\(\s*'([a-z_]+)'(?:::name)?\s*,\s*(null(?:::text\[\])?|array\[[^\]]*\])\s*,\s*(true|false)\s*,\s*(true|false)\s*\)/gis;

function put(seed: Seed, type: string, table: string, columns: string[] | null, ins: boolean, del: boolean) {
  (seed[type] ??= {})[table] = { columns, insert: ins, delete: del };
}

function parseSeed(sql: string): Seed {
  const seed: Seed = {};
  /* Block 1: ('type', 'table', <columns>, bool, bool) — rows with a TYPE first. */
  for (const m of sql.matchAll(TYPED)) put(seed, m[1], m[2], parseColumns(m[3]), m[4] === "true", m[5] === "true");

  /* Block 2: 0604's cross join — `(values ('qty_addition'), ('qty_cancellation'))`
     × rows of ('table'::name, <columns>, bool, bool). */
  const cj = sql.match(/from\s*\(values\s*((?:\('[a-z_]+'\)\s*,?\s*)+)\)\s*as\s+t\(amendment_type\)\s*cross\s+join\s*\(values\s*(.*?)\)\s*as\s+s\(/is);
  if (!cj) throw new Error("0604: the cross-join seed block was not found");
  const types = [...cj[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  for (const m of cj[2].matchAll(ROW)) {
    for (const t of types) put(seed, t, m[1], parseColumns(m[2]), m[3] === "true", m[4] === "true");
  }
  return seed;
}

/** 0619's four operations, applied to the seed in the order the file runs them. */
function apply0619(seed: Seed, sql: string): void {
  const body = sql.slice(0, sql.indexOf("-- ---------- 3."));
  // (a) copy bom_revision's rows by table prefix to a module kind
  const copies = [...body.matchAll(/select\s+'([a-z_]+)',\s*s\.table_name[\s\S]*?where\s+s\.amendment_type\s*=\s*'([a-z_]+)'\s+and\s+s\.table_name::text\s+like\s+'([a-z_]+)%'/gi)];
  if (copies.length !== 2) throw new Error(`0619: expected 2 module copies, found ${copies.length}`);
  for (const [, to, from, prefix] of copies) {
    for (const [table, e] of Object.entries(seed[from] ?? {})) {
      if (table.startsWith(prefix)) put(seed, to, table, e.columns ? [...e.columns] : null, e.insert, e.delete);
    }
  }
  // (b) typed rows (the budget marker)
  let typed = 0;
  for (const m of body.matchAll(TYPED)) {
    put(seed, m[1], m[2], parseColumns(m[3]), m[4] === "true", m[5] === "true");
    typed++;
  }
  if (typed < 1) throw new Error("0619: the budget marker row was not found");
  // (c) the delete of the BOM rows from the quantity / combo kinds
  const del = body.match(/delete\s+from\s+public\.order_amendment_scopes\s+where\s+amendment_type\s+in\s*\(([^)]*)\)\s+and\s*\(table_name::text\s+like\s+'([a-z_]+)%'\s+or\s+table_name::text\s+like\s+'([a-z_]+)%'\)/i);
  if (!del) throw new Error("0619: the BOM-row delete was not found");
  const delTypes = [...del[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  for (const t of delTypes) {
    for (const table of Object.keys(seed[t] ?? {})) {
      if (table.startsWith(del[2]) || table.startsWith(del[3])) delete seed[t][table];
    }
  }
  // (d) the derived rows, by cross join
  const cj = body.match(/from\s*\(values\s*((?:\('[a-z_]+'\)\s*,?\s*)+)\)\s*k\(t\)\s*cross\s+join\s*\(values\s*([\s\S]*?)\)\s*d\(tbl/i);
  if (!cj) throw new Error("0619: the derived-row cross join was not found");
  const types = [...cj[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  let rows = 0;
  for (const m of cj[2].matchAll(ROW)) {
    for (const t of types) put(seed, t, m[1], parseColumns(m[2]), m[3] === "true", m[4] === "true");
    rows++;
  }
  if (rows !== 6) throw new Error(`0619: expected 6 derived rows, found ${rows}`);
}

const sqlSeed = parseSeed(seedSql);
apply0619(sqlSeed, sql0619);

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
    fail(`${type}: not seeded in 0604 / 0618 / 0619`);
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
// 3. Nothing T&A; the budget only behind its own module
// ---------------------------------------------------------------------------

{
  let bad = 0;
  for (const [type, tables] of Object.entries(AMENDMENT_SCOPE_SEED)) {
    for (const t of Object.keys(tables)) {
      if (t.includes("_ta_")) {
        fail(`${type} scopes ${t} — T&A is execution, never amended`);
        bad++;
      }
      if (t.startsWith("order_budget") && !(type === "budget_revision" && t === BUDGET_MARKER_TABLE)) {
        fail(`${type} scopes ${t} — only Order Budget opens the budget, and only through its marker`);
        bad++;
      }
    }
  }
  if (bad === 0) ok("no scope names a T&A table; only budget_revision carries the budget marker");
}

// ---------------------------------------------------------------------------
// 3b. Selecting Order Entry keeps each BOM READ-ONLY (spec §2 rule 1)
// ---------------------------------------------------------------------------

{
  let bad = 0;
  for (const k of ORDER_CHANGE_KINDS) {
    const scope = unionScope([k]);
    for (const area of ["fabric_bom", "material_bom"] as const) {
      if (areaOpen(scope, area)) {
        fail(`${k} alone opens ${area} for editing — the spec keeps an unpicked BOM read-only`);
        bad++;
      }
    }
    for (const t of Object.keys(scope)) {
      if ((t.startsWith("order_fabric_bom") || t.startsWith("material_bom_amendment")) && !(t in BOM_DERIVED_SCOPE)) {
        fail(`${k} opens authored BOM table ${t}`);
        bad++;
      }
    }
    const moves = kindsMoveBoms([k]);
    const recalc = areaRecalculable(scope, "fabric_bom") && areaRecalculable(scope, "material_bom");
    if (moves !== recalc) {
      fail(`${k}: moves BOM figures=${moves} but the scope lets a recalculation write them=${recalc}`);
      bad++;
    }
  }
  const picked = unionScope(kindsForSelection({ modules: ["order_entry", "fabric_bom"], orderKinds: ["qty_addition"] }));
  if (!areaOpen(picked, "fabric_bom") || areaOpen(picked, "material_bom") || !areaRecalculable(picked, "material_bom")) {
    fail("Order Entry + Fabric BOM must open the Fabric BOM, keep the Material BOM read-only and still let it recalculate");
    bad++;
  }
  if (areaOpen(picked, "budget") || !areaOpen(unionScope(["budget_revision"]), "budget")) {
    fail("the budget opens only when Order Budget is picked");
    bad++;
  }
  if (bad === 0) ok("the spec's example holds: Order Entry + Fabric BOM keeps Material BOM read-only; derived rows recalculate; the budget opens only with Order Budget");
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

// ---------------------------------------------------------------------------
// 6. OPEN UNDER EVERY AMENDMENT (0622) — the read-time overlay, both sides
//
// A scope is frozen on the entry, so the files table is laid over it at READ
// time: `order_amendment_always_open()` in SQL, `ALWAYS_OPEN_WHILE_AMENDING`
// merged by `scopeFromJson` in TS. Two literals, held together here.
// ---------------------------------------------------------------------------

{
  const sql0622 = mig("0622_amendment_files_always_open.sql");
  const m = sql0622.match(/function public\.order_amendment_always_open\(\)[\s\S]*?select\s+'(\{[\s\S]*?\})'::jsonb/i);
  if (!m) fail("0622: the order_amendment_always_open() literal was not found");
  else {
    const sqlOpen = JSON.parse(m[1]) as Record<string, ScopeEntry>;
    const norm = (o: Readonly<Record<string, ScopeEntry>>) =>
      JSON.stringify(Object.keys(o).sort().map((t) => [t, o[t].columns, o[t].insert, o[t].delete]));
    if (norm(sqlOpen) === norm(ALWAYS_OPEN_WHILE_AMENDING)) {
      ok(`ALWAYS_OPEN_WHILE_AMENDING matches 0622's order_amendment_always_open() (${Object.keys(sqlOpen).join(", ")})`);
    } else fail(`ALWAYS_OPEN_WHILE_AMENDING ${norm(ALWAYS_OPEN_WHILE_AMENDING)} ≠ SQL ${norm(sqlOpen)}`);
  }
  if (!/coalesce\(r\.scope,\s*'\{\}'::jsonb\)\s*\|\|\s*public\.order_amendment_always_open\(\)/i.test(sql0622)) {
    fail("0622: order_amendment_of no longer lays order_amendment_always_open() over the frozen scope (constant on the RIGHT)");
  }

  // The overlay is applied to every stored scope, and wins over a narrower one.
  const read = scopeFromJson({ garment_order_amendment_combos: { columns: null, insert: true, delete: true } });
  const narrowed = scopeFromJson({ garment_order_amendment_files: { columns: ["file_name"], insert: false, delete: false } });
  if (
    scopeAllowsRewrite(read, "garment_order_amendment_files") &&
    scopeAllowsRewrite(narrowed, "garment_order_amendment_files") &&
    scopeAllowsRewrite(scopeFromJson(null), "garment_order_amendment_files")
  ) ok("scopeFromJson lays the files table over every stored scope, wins over a narrower entry, and survives an unreadable one");
  else fail(`scopeFromJson overlay wrong: ${JSON.stringify(read.garment_order_amendment_files)} / ${JSON.stringify(narrowed.garment_order_amendment_files)}`);

  // …and ONLY that table: nothing else of the order opens because of it.
  if (!scopeAllowsRewrite(read, "garment_order_amendment_pack_types") && !scopeOpensColumn(read, "garment_order_amendments", "delivery_date")) {
    ok("the overlay opens the files table and nothing else");
  } else fail("the overlay opened more than the files table");

  // The screen's `UnlockScope area="files"` exists under every category's
  // entry as READ, and in no raw seed (the seed is what is stored).
  const missing = AMENDMENT_ENTRY_TYPE_VALUES.filter(
    (t) => !openAreasOf(scopeFromJson(AMENDMENT_SCOPE_SEED[t])).includes("files"),
  );
  if (missing.length === 0) ok(`openAreasOf lists "files" under every one of the ${AMENDMENT_ENTRY_TYPE_VALUES.length} categories as read`);
  else fail(`openAreasOf omits "files" for: ${missing.join(", ")}`);
  const seeded = AMENDMENT_ENTRY_TYPE_VALUES.filter((t) => "garment_order_amendment_files" in AMENDMENT_SCOPE_SEED[t]);
  if (seeded.length === 0) ok("no category's SEED names the files table — 0604's closed list still stands");
  else fail(`the seed names the files table for: ${seeded.join(", ")} — 0622 opens it at read time, not in the seed`);
}

if (failures > 0) {
  console.error(`\n${failures} amendment-scope check(s) failed.`);
  process.exit(1);
}
console.log("\nOK — the TS scope mirror matches the seed (0604 · 0618 · 0619) and the always-open overlay (0622).");
