// Verification for the order's report registry (lib/orders/order-reports.ts).
//
//     npm run check:order-reports      (also runs inside `build:check`)
//
// Listed in tsconfig `exclude` like check-module-groups.mts: node's type
// stripping needs the `.ts` extension on the import below and the app's
// tsconfig forbids it, so this file is verified by running it, not by tsc. The
// registry imports nothing at all, so no `@/` alias is ever resolved.
//
// WHY IT EXISTS (client 2026-09-19): "Order Entry ▸ Reports is not linked with
// the actual report." Three Fabric BOM reports were built into a sheet inside
// the Fabric BOM editor and never reached the order's Reports strip, because
// the strip was a hand-kept list and nothing asked whether a new report was on
// it. The registry makes linking automatic for anything declared in it; this
// check is what makes DECLARING it unavoidable.
//
// What it asserts:
//
//   1. Keys are unique — a key is a URL segment and a React key.
//   2. An entry with its own `page` has that folder under
//      app/(app)/orders/[orderId]/, and the page renders the strip with
//      `current="<key>"` — a report page with no strip is the cul-de-sac the
//      strip exists to remove.
//   3. An entry with no `page` is served by the generic
//      /orders/<id>/reports/<key> route, which has a renderer only for the
//      `fabric-bom` and `material-bom` sources; any other source must first
//      get a branch. Every such key must have its view in its sheet's
//      `…_REPORT_VIEWS` record (VIEW_SHEETS below).
//   4. EVERY FOLDER under app/(app)/orders/[orderId]/ is a registered report,
//      the generic `reports` route, or declared NOT a report in NOT_REPORTS
//      with its reason — so a new per-order page cannot appear unlisted.
//   5. A REPORT LOADER IS ONLY EVER RENDERED THROUGH THE REGISTRY. Every
//      exported `load…Report…` / `load…Register…` server action under
//      lib/orders/ is referenced only from files that import the registry.
//      This is the check that would have failed on the sheet that caused the
//      bug: it called loadFabricBomEntryRegister and hand-typed its own tabs.
//
// THE FLOOR, stated rather than hidden: (5) recognises a report by its
// loader's NAME. A report whose loader is called something else, rendered on a
// screen outside app/(app)/orders/[orderId]/, is invisible to it. Name report
// loaders `load<Thing>Report` and this stays true.
//
// Verified by being made to FAIL first: (5) against the Fabric BOM sheet with
// its registry import removed, and (4) against an unlisted
// app/(app)/orders/[orderId]/<folder>/page.tsx.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ORDER_REPORTS } from "../lib/orders/order-reports.ts";

const ROOT = process.cwd();
const ORDER_DIR = join(ROOT, "app", "(app)", "orders", "[orderId]");
const GENERIC_ROUTE = join(ORDER_DIR, "reports", "[report]", "page.tsx");
/* Per source: the sheet whose `…_REPORT_VIEWS` record must name every key the
   generic route serves for it. */
const VIEW_SHEETS: Record<string, { file: string; record: string }> = {
  "fabric-bom": {
    file: join(ROOT, "components", "orders", "fabric-bom-reports-sheet.tsx"),
    record: "FABRIC_BOM_REPORT_VIEWS",
  },
  "material-bom": {
    file: join(ROOT, "components", "orders", "material-bom-reports-sheet.tsx"),
    record: "MATERIAL_BOM_REPORT_VIEWS",
  },
};
const REGISTRY_IMPORT = "@/lib/orders/order-reports";

/** Per-order folders that are screens, not reports — each with its reason. */
const NOT_REPORTS: Record<string, string> = {
  processes: "Garment Processes — an editor with Save, not a printable document",
  community: "RE-Community — the order's discussion thread, not a document",
  reports: "the generic route that serves every registered report without a page",
};

/** Sources the generic route can render. Add one when its branch is written. */
const GENERIC_SOURCES = new Set(Object.keys(VIEW_SHEETS));

const failures: string[] = [];
const fail = (m: string) => failures.push(m);
const rel = (p: string) => relative(ROOT, p).replaceAll("\\", "/");

// 1 — unique keys
const seen = new Set<string>();
for (const r of ORDER_REPORTS) {
  if (seen.has(r.key)) fail(`duplicate report key "${r.key}"`);
  seen.add(r.key);
}

// 2 + 3 — every entry is reachable and rendered
/* The object literal's body: from the `> = {` that ends the declaration's
   `Record<…>` type (whose own `=>` a `[^=]*` pattern stops on) to its `\n};`. */
function viewsBlockOf(source: string): string {
  const sheet = VIEW_SHEETS[source];
  if (!sheet || !existsSync(sheet.file)) return "";
  const src = readFileSync(sheet.file, "utf8");
  const start = src.indexOf(`const ${sheet.record}`);
  const bodyStart = start < 0 ? -1 : src.indexOf("> = {", start);
  return bodyStart < 0 ? "" : src.slice(bodyStart, src.indexOf("\n};", bodyStart));
}
if (!existsSync(GENERIC_ROUTE)) fail(`${rel(GENERIC_ROUTE)} is missing`);

for (const r of ORDER_REPORTS) {
  const page = "page" in r ? r.page : undefined;
  if (page) {
    const file = join(ORDER_DIR, page, "page.tsx");
    if (!existsSync(file)) {
      fail(`"${r.key}" declares page "${page}" but ${rel(file)} does not exist`);
      continue;
    }
    const src = readFileSync(file, "utf8");
    if (!src.includes("<OrderDocumentTabs") || !src.includes(`current="${r.key}"`)) {
      fail(`${rel(file)} must render <OrderDocumentTabs current="${r.key}" />`);
    }
  } else {
    if (!GENERIC_SOURCES.has(r.source)) {
      fail(
        `"${r.key}" has no page and source "${r.source}" has no renderer on the generic route — ` +
          `give it a page, or add a "${r.source}" branch to ${rel(GENERIC_ROUTE)}`,
      );
    }
    const sheet = VIEW_SHEETS[r.source];
    if (sheet && !new RegExp(`["']${r.key}["']\\s*:`).test(viewsBlockOf(r.source))) {
      fail(`"${r.key}" has no view in ${sheet.record} (${rel(sheet.file)})`);
    }
  }
}

// 3b — V_FINAL (0619, doc/order/amenment update.md §4B). While an order is
// amending, every report prints the approved version frozen at raise. A report
// page that reads its loader straight past `vFinalFor` would print the
// in-flight amendment on the floor, so each page — and the generic route —
// must ask it, with the source the registry names, and the capture must know
// that source (`V_FINAL_SOURCES`, run by `captureVFinal`).
{
  const vfSrc = readFileSync(join(ROOT, "lib/orders/amendments/v-final.ts"), "utf8");
  for (const r of ORDER_REPORTS) {
    if (!r.vFinal) {
      fail(`"${r.key}" declares no vFinal source — it would print an amendment's unapproved data`);
      continue;
    }
    const page = "page" in r ? r.page : undefined;
    const file = page ? join(ORDER_DIR, page, "page.tsx") : GENERIC_ROUTE;
    if (!existsSync(file)) continue;
    const src = readFileSync(file, "utf8");
    const asks = page ? src.includes(`vFinalFor("${r.vFinal}"`) : src.includes("vFinalFor(report.vFinal");
    if (!asks) fail(`${rel(file)} must read V_final through vFinalFor(${page ? `"${r.vFinal}"` : "report.vFinal"}, …)`);
    if (!new RegExp(`case\s+"${r.vFinal}"|default:`).test(vfSrc)) fail(`captureVFinal has no loader for "${r.vFinal}"`);
  }
}

// 4 — no unlisted per-order folder
const registeredPages = new Set(ORDER_REPORTS.map((r) => ("page" in r ? r.page : undefined)).filter(Boolean));
for (const name of readdirSync(ORDER_DIR)) {
  const full = join(ORDER_DIR, name);
  if (!statSync(full).isDirectory()) continue;
  if (registeredPages.has(name) || name in NOT_REPORTS) continue;
  fail(
    `${rel(full)} is a per-order page in neither ORDER_REPORTS nor NOT_REPORTS — ` +
      `register it in lib/orders/order-reports.ts (a report) or list it in NOT_REPORTS with a reason`,
  );
}

// 5 — report loaders are rendered only through the registry
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const loaderNames = new Set<string>();
for (const file of walk(join(ROOT, "lib", "orders"))) {
  if (!/actions\.ts$/.test(file)) continue;
  for (const m of readFileSync(file, "utf8").matchAll(/export\s+async\s+function\s+(load\w*(?:Report|Register)\w*)/g)) {
    loaderNames.add(m[1]);
  }
}

const consumers = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))];
for (const file of consumers) {
  const src = readFileSync(file, "utf8");
  const used = [...loaderNames].filter((n) => new RegExp(`\\b${n}\\b`).test(src));
  if (used.length === 0 || src.includes(REGISTRY_IMPORT)) continue;
  fail(
    `${rel(file)} renders a report (${used.join(", ")}) without reading ${REGISTRY_IMPORT} — ` +
      `declare it in ORDER_REPORTS so Order Entry's Reports links to it`,
  );
}

if (loaderNames.size === 0) fail("found no report loaders under lib/orders — the pattern in (5) has gone blind");

if (failures.length) {
  console.error(`check:order-reports — ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(
  `check:order-reports — ok: ${ORDER_REPORTS.length} reports, ${loaderNames.size} loaders ` +
    `(${[...loaderNames].join(", ")}), every per-order folder accounted for`,
);
