// Verification for the screen catalog (lib/permissions/screen-catalog.ts) —
// the Module → Sub-module → Screen tree the permission screens render and the
// screen-level checks resolve against.
//
//     npm run check:screen-catalog      (also runs inside `build:check`)
//
// Listed in tsconfig `exclude` like every other .mts checker: run with tsx
// (lib/masters/submodules.ts imports without extensions — see check-nav-paths).
//
// WHY IT EXISTS: a screen that is on disk but in no registry is a screen the
// permission tree cannot offer and a screen check cannot see — it silently
// falls back to the module grant. Harmless for a redirect, a hub or a `/new`
// form that inherits its parent by prefix; not harmless for a real screen
// nobody knew was missing. So every static page must be one of:
//   - a SCREEN (resolves via `screenOfPath` to itself or a parent screen),
//   - a HUB (a module root or a group route — cards, not a screen), or
//   - DECLARED in `UNREGISTERED` below, with the reason it is not a screen.
// A new page that is none of these fails the build, which is the point: it
// asks the author to register it (and so put it in the tree) or say why not.
//
// Also asserted: screen keys are unique; every screen's module is a real
// `Module`; `screenOfPath` resolves the vectors below; every module has a
// sub-module and every sub-module a screen.

import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  SCREEN_ALIASES,
  allScreens,
  buildScreenCatalog,
  screenOfPath,
} from "../lib/permissions/screen-catalog.ts";
import { NAV } from "../components/shell/nav.ts";
import { allGroupRoutes } from "../lib/nav/module-groups.ts";
import { SUBMODULES } from "../lib/masters/submodules.ts";
import { MODULES, hasPermission } from "../lib/auth/types.ts";
import {
  payloadFromTree,
  permissionAllows,
  screenGrantKey,
  treeFromRows,
  treeHas,
  treeToggle,
  type PermissionTree,
  type ScreenPermissionFacts,
} from "../lib/permissions/effective.ts";

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

/**
 * STATIC PAGES THAT ARE NOT SCREENS, each with its reason. Anything here falls
 * back to its module's grant — say why that is right.
 */
const UNREGISTERED: Record<string, string> = {
  "/admin/document-no-formats": "redirect() to Master Data ▸ System (declared in check-module-groups REDIRECTED)",
  "/orders/changes": "redirect() — the Amendments hub moved",
  "/orders/confirmations": "redirect() — merged into another screen",
  "/orders/fabric-ta": "redirect() — Fabric T&A is a tab of the Fabric BOM editor (0609)",
  "/orders/material-bom-amendment": "redirect() to Orders ▸ Material BOM",
  "/sales/create": "entry form linked from the Sample hub itself — takes the Sample module grant",
  "/sales/registers": "register page off the Sample hub — takes the Sample module grant",
  "/admin/roles": "redirect() to Access Control (merged 2026-09-30, REDIRECTED in check-module-groups)",
  "/admin/permission-overrides": "redirect() to Access Control ▸ By User (merged 2026-09-30)",
  "/orders/profitability": "redirect() to /orders/profit-check — Order Profit Check moved 2026-10-01",
  "/orders/po-import": "entry page opened from Order Entry's Upload Buyer PO button — takes the Orders grant (requirePermission in the page)",
  "/me": "redirect() to /my-profile — My Profile's first address (moved 2026-10-01)",
  "/my-profile": "every login's own profile (requireUser) — not a permission-gated screen",
  "/start": "post-sign-in landing that only redirects to the person's home page — never rendered",
  "/my-work": "every login's own work queue (requireUser); each card checks its own module grant",
};

const catalog = buildScreenCatalog();
const screens = allScreens(catalog);

// ── shape ─────────────────────────────────────────────────────────────────────
const keys = screens.map((s) => s.key);
const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
check(dupes.length === 0, `screen keys are unique (${keys.length} screens)${dupes.length ? ": " + [...new Set(dupes)].join(", ") : ""}`);
const badModule = screens.filter((s) => !(MODULES as readonly string[]).includes(s.module));
check(badModule.length === 0, `every screen's module is a real Module${badModule.length ? ": " + badModule.map((s) => s.key).join(", ") : ""}`);
check(catalog.every((m) => m.submodules.length > 0 && m.submodules.every((s) => s.screens.length > 0)), `every module has a sub-module and every sub-module a screen (${catalog.length} modules, ${catalog.reduce((n, m) => n + m.submodules.length, 0)} sub-modules)`);
/* A screen's module is its MENU module's: a tick switches exactly one
   permission module to screen mode, and it must be the one the operator is
   looking at in the tree. */
const crossModule = catalog.flatMap((m) => m.submodules.flatMap((sm) => sm.screens.filter((sc) => sc.module !== m.module).map((sc) => sc.key)));
check(crossModule.length === 0, `every screen carries its menu module's permission key${crossModule.length ? ": " + crossModule.join(", ") : ""}`);
check(catalog.length === NAV.length, `every nav module is in the catalog (${catalog.length}/${NAV.length})`);

// ── screenOfPath vectors ──────────────────────────────────────────────────────
const vectors: [string, string | null][] = [
  ["/", "/"],
  ["/purchase/indents", "/purchase/indents"],
  ["/purchase/indents/123/edit", "/purchase/indents"],
  ["/purchase/indents/approval", "/purchase/indents/approval"],
  ["/masters/materials/item-class", "/masters/materials/item-class"],
  ["/masters/associates/customer", "/masters/associates/customer"],
  ["/reports/override-edits", "/reports/override-edits"],
  ["/purchase", null],
  ["/orders/setup", null],
  ["/no/such/route", null],
];
for (const [path, want] of vectors) {
  const got = screenOfPath(path, catalog)?.key ?? null;
  if (got !== want) fail(`screenOfPath(${path}) = ${got}, expected ${want}`);
}
ok(`screenOfPath resolves ${vectors.length} vectors (longest prefix, "/" exact, hubs null)`);

// ── every static page is a screen, a hub, or declared ─────────────────────────
const appDir = resolve(import.meta.dirname ?? ".", "..", "app", "(app)");
function walk(dir: string, route: string[], out: string[]) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (!statSync(p).isDirectory()) {
      if (name === "page.tsx") out.push("/" + route.join("/"));
      continue;
    }
    if (name.startsWith("_") || name.startsWith("@")) continue;
    const seg = name.startsWith("(") && name.endsWith(")") ? null : name;
    walk(p, seg ? [...route, seg] : route, out);
  }
}
const pages: string[] = [];
walk(appDir, [], pages);
const staticPages = pages.map((p) => (p === "/" ? "/" : p.replace(/\/$/, ""))).filter((p) => !p.includes("["));

const hubs = new Set<string>([
  ...NAV.map((n) => n.href),
  ...allGroupRoutes(),
  ...SUBMODULES.map((s) => `/masters/${s.slug}`),
]);
const unresolved = staticPages.filter((p) => !screenOfPath(p, catalog) && !hubs.has(p) && !(p in UNREGISTERED));
if (unresolved.length) {
  for (const p of unresolved.sort()) fail(`${p} is a page in no registry — register it (it becomes a screen) or declare it in UNREGISTERED with a reason`);
} else {
  ok(`every static page is a screen, a hub, or declared (${staticPages.length} pages, ${Object.keys(UNREGISTERED).length} declared)`);
}
// ── SCREEN_ALIASES: every source is a page, every target a catalog screen ─────
const aliasBad = Object.entries(SCREEN_ALIASES).filter(
  ([from, to]) => !staticPages.includes(from) || !screens.some((s) => s.key === to),
);
check(aliasBad.length === 0, `every SCREEN_ALIASES entry maps a real page to a catalog screen (${Object.keys(SCREEN_ALIASES).length})${aliasBad.length ? ": " + aliasBad.map(([f]) => f).join(", ") : ""}`);
check(screenOfPath("/orders/iwo-budgets/123", catalog)?.key === "/orders/internal-work-orders", "an aliased sub-screen resolves to its parent screen, with a tail");

const stale = Object.keys(UNREGISTERED).filter((p) => !staticPages.includes(p) || screenOfPath(p, catalog));
check(stale.length === 0, `no UNREGISTERED entry is stale${stale.length ? ": " + stale.join(", ") : ""}`);

// ── The rule (lib/permissions/effective.ts) ───────────────────────────────────
{
  const purchase = catalog.find((m) => m.module === "materials_purchase")!;
  const pScreens = purchase.submodules.flatMap((s) => s.screens);
  const [a, b] = pScreens;
  const ordersScreen = allScreens(catalog).find((s) => s.module === "orders")!;
  const facts = (o: Partial<ScreenPermissionFacts>): ScreenPermissionFacts => ({
    isSuperAdmin: false,
    permissions: new Set(),
    moduleMode: new Set(),
    screenGrants: new Set(),
    ...o,
  });

  // Backward compatible: a role never touched by the tree (module mode) answers as before on every screen.
  const legacy = facts({ permissions: new Set(["materials_purchase:create"]), moduleMode: new Set(["materials_purchase:create"]) });
  check(pScreens.every((s) => permissionAllows(legacy, "materials_purchase", "create", s)) &&
        permissionAllows(legacy, "materials_purchase", "create", null) &&
        !permissionAllows(legacy, "materials_purchase", "delete", a),
    `module mode = today's answer on all ${pScreens.length} Purchase screens, a hub, and a missing action`);

  // Screen mode: only the granted screen/action.
  const scoped = facts({ permissions: new Set(["materials_purchase:create"]), screenGrants: new Set([screenGrantKey(a.key, "create")]) });
  check(permissionAllows(scoped, "materials_purchase", "create", a), `screen mode allows the granted screen (${a.key})`);
  check(!permissionAllows(scoped, "materials_purchase", "create", b), `screen mode refuses an ungranted screen of the same module (${b.key})`);
  check(permissionAllows(scoped, "materials_purchase", "create", null), "screen mode falls back to the module grant on a hub / unregistered page");
  check(permissionAllows(scoped, "materials_purchase", "create", ordersScreen), "a shared action posted from another module's screen falls back to the module grant");

  // The module grant is the ceiling; super admin passes; a module-mode role anywhere widens.
  check(!permissionAllows(facts({ screenGrants: new Set([screenGrantKey(a.key, "create")]) }), "materials_purchase", "create", a),
    "a screen grant never exceeds the module grant (my_permissions is the ceiling)");
  check(permissionAllows(facts({ isSuperAdmin: true }), "materials_purchase", "delete", b), "super admin passes");
  check(permissionAllows(facts({ permissions: scoped.permissions, moduleMode: new Set(["materials_purchase:create"]), screenGrants: scoped.screenGrants }), "materials_purchase", "create", b),
    "a second role in module mode for the module widens it to every screen");

  // The tree: toggling one screen of a module-mode setting expands it first.
  let tree: PermissionTree = { materials_purchase: { mode: "module", actions: ["view", "create"] } };
  tree = treeToggle(tree, purchase, b, "create", false);
  check(treeHas(tree, a, "create") && !treeHas(tree, b, "create") && treeHas(tree, b, "view"),
    "turning one screen off keeps every other screen's actions (module → screen expansion)");
  const pl = payloadFromTree(tree, catalog);
  check(pl.length === 1 && pl[0].mode === "screen", "a non-uniform module is stored in screen mode");
  tree = treeToggle(tree, purchase, b, "create", true);
  const pl2 = payloadFromTree(tree, catalog);
  check(pl2.length === 1 && pl2[0].mode === "module" && JSON.stringify((pl2[0] as { actions: string[] }).actions) === JSON.stringify(["create", "view"]),
    "a uniform screen-mode module normalises back to module mode (keeps working for screens added later)");
  const round = treeFromRows(
    [{ module: "materials_purchase", action: "view" }, { module: "materials_purchase", action: "create" }],
    [{ module: "materials_purchase", screen_key: a.key, action: "create" }],
  );
  check(round.materials_purchase?.mode === "screen" && treeHas(round, a, "create") && !treeHas(round, b, "view"),
    "stored rows read back: a module with screen rows is screen mode, its kept-OR role rows ignored");
  check(Object.keys(payloadFromTree({ materials_purchase: { mode: "screen", grants: {} } }, catalog)).length === 0,
    "an empty module is not stored");

  // hasPermission — what can() / requirePermission() / usePermission() call —
  // agrees with the rule, and a user object without screen facts (no
  // moduleMode) answers at module grain on every screen: today's answer.
  const legacyUser = { isSuperAdmin: false, permissions: ["materials_purchase:create" as const] };
  check(pScreens.every((s) => hasPermission(legacyUser, "materials_purchase", "create", s)),
    "a user with no screen facts answers at module grain on every screen (no regression)");
  const scopedUser = {
    isSuperAdmin: false,
    permissions: ["materials_purchase:create" as const],
    moduleMode: [],
    screenGrants: [screenGrantKey(a.key, "create")],
  };
  check(hasPermission(scopedUser, "materials_purchase", "create", a) &&
        !hasPermission(scopedUser, "materials_purchase", "create", b) &&
        hasPermission(scopedUser, "materials_purchase", "create") &&
        hasPermission(scopedUser, "materials_purchase", "create", null),
    "hasPermission applies the screen rule with a screen, module grain without one");
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck:screen-catalog — all assertions passed");
