// AN AMBIGUOUS POSTGREST EMBED IS AN EMPTY SCREEN THAT LOOKS LIKE NO DATA.
// Run:  npm run check:embeds
//
// ## What this exists to stop
//
// `purchase_orders` has TWO foreign keys to `vendors` — `vendor_id` (the
// supplier) and `agent_id` (the buying agent). Once a second one exists,
// PostgREST can no longer guess which the bare embed `vendors(name)` means, so
// it stops answering the query at all:
//
//     GET /purchase_orders?select=id,code,vendors(name)
//     300  PGRST201  'purchase_orders with vendors' is ambiguous
//
// Eleven call sites across five services were in that state on 2026-09-02 —
// the dashboard's approval queue, its overdue-PO alert and its spend-by-vendor
// tile, the Tally/integration PO export, three PO pickers, the PO cancellation
// list, the open-PO-lines feed for GRN, the PO list and the PO detail page.
//
// ## Why it was invisible, and why that is the dangerous part
//
// Every one of them reads `data ?? []` and never looks at `error`, so a query
// that refuses to run returns an empty list. That is the exact failure this
// repo keeps writing down — `getAmendments` carries the same lesson in its own
// words, "A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST" — and here it had a
// second cloak on top: `purchase_orders` holds ZERO rows today, so the broken
// screens and the correct ones are indistinguishable. Nothing looks wrong until
// the first purchase order is raised, at which point ten screens quietly report
// that there are none.
//
// A `.select()` string is not type-checked, not linted and not exercised by any
// build, so nothing else in this repo can catch it. That is what earns a script.
//
// ## The declared table
//
// AMBIGUOUS is a DECLARED TABLE, not something inferred from the migrations —
// same shape and same reasoning as `FLAGLESS_PICKERS` in `audit_layout.py` and
// the HSN chapter map in `vocab-sources/`. Parsing 500 migrations for foreign
// keys would be a second, worse source of truth for something the catalog
// answers exactly. Regenerate it against the live database with:
//
//     select c.conrelid::regclass::text as tbl,
//            c.confrelid::regclass::text as target,
//            count(*),
//            string_agg(a.attname, ',' order by a.attname) as cols
//     from pg_constraint c
//     join lateral unnest(c.conkey) k(attnum) on true
//     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
//     where c.contype = 'f'
//     group by c.conrelid, c.confrelid
//     having count(*) > 1;
//
// Run that whenever a migration adds a foreign key to a table that already has
// one to the same target — that is the moment every existing bare embed on it
// breaks at once, silently, everywhere.
//
// Verified by being made to FAIL first, against the eleven pre-fix call sites,
// before being trusted.
import fs from "node:fs";
import path from "node:path";

/** base table -> embedded table -> the FK columns that make it ambiguous. */
const AMBIGUOUS = {
  purchase_orders: { vendors: ["vendor_id", "agent_id"] },
};

/* Roots default to the app's source trees, but a path may be passed on the
   command line. That is not a convenience: it is how this check is verified.
   Proving a check FAILS means putting broken code somewhere, and doing that in
   the repo leaves a window in which a shared working tree is wrong — which is
   exactly what happened the first time this was tested. Point it at a scratch
   copy instead:  node scripts/check-embeds.mjs /tmp/prefix-copy  */
const ROOTS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["lib", "app", "components"];
const EXT = new Set([".ts", ".tsx"]);

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".next")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (EXT.has(path.extname(e.name))) yield p;
  }
}

/* COMPILED ONCE rather than inside the file × line × pair loops. That is for
   READABILITY, not speed: it was hoisted expecting a large win and measured at
   none. The run is I/O-bound, not CPU-bound — `user` + `sys` stay under 0.4s
   while `real` is 6s warm and 25s cold, which is Defender reading 1,280 files
   and 12 MB, and no amount of regex tuning touches that. Recorded because the
   obvious next optimisation is the wrong one.

   A bare embed is `target(` with no `!hint` before the paren. The negative
   lookbehind on a word character is what keeps `nominated_vendors(` and
   `master_vendors(` — real, unambiguous relationships — out of the match. */
const PAIRS = Object.entries(AMBIGUOUS).flatMap(([base, targets]) =>
  Object.entries(targets).map(([target, cols]) => ({
    base,
    target,
    cols,
    hint: `${target}!${cols[0]}(...)`,
    /* Two ways a select gets attached to a base table in this repo: the
       ordinary `.from("x")`, and the `table: "x"` entry of a config array (the
       dashboard's approval queues). Both are in scope; a check that knew only
       the first would have passed while `getApprovals` stayed broken, which is
       how this one was nearly written. */
    attaches: new RegExp(String.raw`\.from\(\s*"${base}"\s*\)|table:\s*"${base}"`),
    bare: new RegExp(String.raw`(?<![\w!])${target}\s*\(`),
    /* The base embedded INSIDE another table's select, carrying the ambiguous
       embed as a grandchild — `po_cancellations` does exactly this. */
    nested: new RegExp(String.raw`${base}\s*\([^)]*(?<![\w!])${target}\s*\(`),
  })),
);

const SELECT = /(?:\.select\(|select:\s*)([\s\S]*?)(?:\)\s*\n|,\s*\n)/;

const findings = [];

for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    const src = fs.readFileSync(file, "utf8");
    const lines = src.split("\n");

    for (const p of PAIRS) {
      if (!src.includes(p.base) || !src.includes(p.target)) continue;

      for (let i = 0; i < lines.length; i++) {
        // (a) the base's OWN select, on this line or shortly after it.
        if (p.attaches.test(lines[i])) {
          const m = lines.slice(i, i + 16).join("\n").match(SELECT);
          if (m && p.bare.test(m[1])) {
            findings.push({ file, line: i + 1, ...p });
          }
        }
        // (b) the base embedded inside another table's select.
        if (p.nested.test(lines[i])) {
          findings.push({ file, line: i + 1, ...p });
        }
      }
    }
  }
}

// One report per site: (a) and (b) can both match a single line.
const seen = new Set();
const unique = findings.filter((f) => {
  const k = `${f.file}:${f.line}:${f.target}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

if (unique.length === 0) {
  console.log("check:embeds — 0 ambiguous PostgREST embeds.");
  process.exit(0);
}

console.error("check:embeds FAILED — an embed PostgREST cannot resolve.\n");
console.error(
  "The base table has more than one foreign key to the embedded one, so this\n" +
    "query answers 300 / PGRST201 and the caller's `data ?? []` turns that into\n" +
    "an empty screen. Name the foreign key column in the embed.\n",
);
for (const f of unique) {
  console.error(
    `  ${f.file}:${f.line}\n` +
      `      ${f.base} has ${f.cols.join(" and ")} → ${f.target};` +
      ` write ${f.hint}`,
  );
}
console.error(`\n${unique.length} site(s).`);
process.exit(1);
