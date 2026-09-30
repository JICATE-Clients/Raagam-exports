/**
 * THE SCREEN-PERMISSION RULE — pure, so the server, the browser and the check
 * script all answer the same question the same way (0658).
 *
 *   A role with no screen rows for a module is in MODULE MODE for it: every
 *   screen follows its module grant, exactly as before screen permissions
 *   existed. A role with screen rows for a module is in SCREEN MODE for it:
 *   only the granted screen / action pairs are allowed there.
 *
 * `permissionAllows()` is what `can()`, `requirePermission()` and the client's
 * `usePermission()` delegate to once they know the current screen. It never
 * GRANTS beyond the module grant — `permissions` (from `my_permissions()`) is
 * checked first and is the ceiling — it only NARROWS it, and only on a screen
 * of that same module. A request on a page that is not one of that module's
 * screens (a shared lookup, a picker, a cross-module helper, a hub) falls back
 * to the module grant, so a shared action can never break.
 *
 * Also here, for the tree UI: `treeFromRows` (stored rows → the editable tree)
 * and `payloadFromTree` (the tree → what `save_role_permissions` stores).
 */

import type { Action, Module, PermissionKey } from "@/lib/auth/types";
import type { CatalogModule, CatalogScreen } from "./screen-catalog";

/** The user's screen-permission facts, as `my_screen_permissions()` returns them. */
export type ScreenPermissionFacts = {
  isSuperAdmin: boolean;
  /** Module-level keys from `my_permissions()` — the ceiling. */
  permissions: ReadonlySet<string>;
  /** `module:action` granted module-wide by a role in MODULE MODE. */
  moduleMode: ReadonlySet<string>;
  /** `screen_key|action` granted by a role in SCREEN MODE. */
  screenGrants: ReadonlySet<string>;
};

export const screenGrantKey = (screen: string, action: Action | string) => `${screen}|${action}`;

export function permissionAllows(
  facts: ScreenPermissionFacts,
  module: Module,
  action: Action,
  screen: Pick<CatalogScreen, "key" | "module"> | null,
): boolean {
  if (facts.isSuperAdmin) return true;
  const key: PermissionKey = `${module}:${action}`;
  if (!facts.permissions.has(key)) return false; // the module grant is the ceiling
  if (facts.moduleMode.has(key)) return true; // some role grants it module-wide
  // Only screen-mode roles grant it. Narrow on this module's own screens only.
  if (!screen || screen.module !== module) return true;
  return facts.screenGrants.has(screenGrantKey(screen.key, action));
}

// ---------------------------------------------------------------------------
// The editable tree
// ---------------------------------------------------------------------------

export type ModuleSetting =
  | { mode: "module"; actions: Action[] }
  | { mode: "screen"; grants: Record<string, Action[]> };

/** A role's (or a grant's) permissions, keyed by permission module. */
export type PermissionTree = Partial<Record<Module, ModuleSetting>>;

/** Stored rows → the tree the UI edits. */
export function treeFromRows(
  moduleRows: readonly { module: string; action: string }[],
  screenRows: readonly { module: string; screen_key: string; action: string }[],
): PermissionTree {
  const tree: PermissionTree = {};
  const screenModules = new Set(screenRows.map((r) => r.module));
  for (const r of screenRows) {
    const m = r.module as Module;
    const cur = tree[m];
    const grants = cur && cur.mode === "screen" ? cur.grants : {};
    grants[r.screen_key] = [...new Set([...(grants[r.screen_key] ?? []), r.action as Action])];
    tree[m] = { mode: "screen", grants };
  }
  for (const r of moduleRows) {
    const m = r.module as Module;
    if (screenModules.has(m)) continue; // the kept OR of a screen-mode module
    const cur = tree[m];
    const actions = cur && cur.mode === "module" ? cur.actions : [];
    tree[m] = { mode: "module", actions: [...new Set([...actions, r.action as Action])] };
  }
  return tree;
}

/** Is this screen / action on in the tree? (What a toggle shows.) */
export function treeHas(tree: PermissionTree, screen: Pick<CatalogScreen, "key" | "module">, action: Action): boolean {
  const s = tree[screen.module];
  if (!s) return false;
  return s.mode === "module" ? s.actions.includes(action) : (s.grants[screen.key] ?? []).includes(action);
}

/**
 * Turn one screen / action on or off. Touching a single screen of a module in
 * MODULE MODE first expands it to SCREEN MODE (every screen of the module
 * holding the module's actions), then changes the one cell — so the rest of
 * the module keeps exactly what it had.
 */
export function treeToggle(
  tree: PermissionTree,
  catalogModule: Pick<CatalogModule, "submodules">,
  screen: Pick<CatalogScreen, "key" | "module">,
  action: Action,
  on: boolean,
): PermissionTree {
  const cur = tree[screen.module];
  const grants: Record<string, Action[]> = {};
  if (cur?.mode === "module") {
    for (const sub of catalogModule.submodules) for (const sc of sub.screens) {
      if (sc.module === screen.module) grants[sc.key] = [...cur.actions];
    }
  } else if (cur?.mode === "screen") {
    for (const [k, v] of Object.entries(cur.grants)) grants[k] = [...v];
  }
  const set = new Set(grants[screen.key] ?? []);
  if (on) set.add(action);
  else set.delete(action);
  grants[screen.key] = [...set];
  return { ...tree, [screen.module]: { mode: "screen", grants } };
}

/** Set every offered action on every given screen on or off (Enable / Disable all). */
export function treeSetMany(
  tree: PermissionTree,
  catalogModule: Pick<CatalogModule, "submodules">,
  screens: readonly Pick<CatalogScreen, "key" | "module">[],
  actionsOf: (screen: Pick<CatalogScreen, "key" | "module">) => readonly Action[],
  on: boolean,
): PermissionTree {
  let next = tree;
  for (const sc of screens) for (const a of actionsOf(sc)) next = treeToggle(next, catalogModule, sc, a, on);
  return next;
}

/**
 * The tree → what `save_role_permissions` stores, NORMALISED: a screen-mode
 * module in which every catalog screen holds the same action set becomes
 * module mode with that set (it means the same, and module mode keeps working
 * for screens added to the module later); an empty module is dropped.
 */
export function payloadFromTree(
  tree: PermissionTree,
  catalog: readonly CatalogModule[],
): ({ module: Module; mode: "module"; actions: Action[] } | { module: Module; mode: "screen"; grants: { screen: string; action: Action }[] })[] {
  const screensOf = (m: Module) =>
    catalog.flatMap((cm) => cm.submodules.flatMap((s) => s.screens)).filter((s) => s.module === m);
  const out: ReturnType<typeof payloadFromTree> = [];
  for (const [m, setting] of Object.entries(tree) as [Module, ModuleSetting][]) {
    if (!setting) continue;
    if (setting.mode === "module") {
      if (setting.actions.length) out.push({ module: m, mode: "module", actions: [...setting.actions].sort() });
      continue;
    }
    const known = screensOf(m);
    const sets = known.map((s) => [...(setting.grants[s.key] ?? [])].sort().join(","));
    const uniform = known.length > 0 && sets.every((x) => x === sets[0]);
    if (uniform) {
      const actions = (sets[0] ? sets[0].split(",") : []) as Action[];
      if (actions.length) out.push({ module: m, mode: "module", actions });
      continue;
    }
    const knownKeys = new Set(known.map((s) => s.key));
    const grants = Object.entries(setting.grants)
      .filter(([k]) => knownKeys.has(k)) // a screen no longer in the catalog is not stored
      .flatMap(([k, acts]) => acts.map((a) => ({ screen: k, action: a })));
    if (grants.length) out.push({ module: m, mode: "screen", grants });
  }
  return out;
}
