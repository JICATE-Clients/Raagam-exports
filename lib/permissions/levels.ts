import { ACTIONS, type Action, type Module } from "@/lib/auth/types";
import { menuCatalog, screenCatalog, type CatalogModule, type CatalogScreen } from "./screen-catalog";
import { treeHas, type PermissionTree } from "./effective";

/**
 * ACCESS AS FOUR WORDS PER MODULE (plan approved 2026-11-14,
 * https://claude.ai/artifact/JopxLF22KNdjwGEjYzMQFt, D2).
 *
 * The screens used to show access as ~70 screen rows × 6 action boxes, in four
 * colours. Two people then had 1,300 boxes unticked each to say "Pulse only".
 * Now every surface — a role, an invite, one person — reads and sets a MENU
 * MODULE (a sidebar row) as one of:
 *   Full       every action on every screen
 *   View only  View on every screen, nothing else
 *   Custom     anything else — the only state that opens the screen boxes
 *   None       nothing
 *
 * Storage does not change. A level is DERIVED from the cells the tree / role
 * / extras / blocks already describe, and setting one writes cells — so a role
 * saved here is the same rows `save_role_permissions` always took, and
 * `payloadFromTree` still folds a uniform module back to module mode.
 *
 * A LEVEL IS JUDGED OVER THE SCREENS ON THE MENU (`menuCatalog`) and SET OVER
 * EVERY SCREEN OF THE MENU MODULE (`screenCatalog`), off-menu pages included —
 * so "Full" on Purchase still opens the PO page that PO Approval links to.
 *
 * Pure and client-safe.
 */

export type Level = "full" | "view" | "custom" | "none";
export type Offered = Partial<Record<Module, Action[]>>;
export type Cell = { sc: CatalogScreen; a: Action };
export type CellChange = Cell & { on: boolean };
/** A role cell taken away from one person (0840). */
export type Block = { module: string; screen: string; action: Action };
type Has = (sc: Pick<CatalogScreen, "key" | "module">, a: Action) => boolean;

export const LEVELS: readonly Level[] = ["full", "view", "custom", "none"];
export const LEVEL_WORD: Record<Level, string> = { full: "Full", view: "View only", custom: "Custom", none: "None" };

export const screensOf = (cm: CatalogModule): CatalogScreen[] => cm.submodules.flatMap((s) => s.screens);

/** Every (screen, action) the permission catalog offers on these screens. */
export function cellsOf(screens: readonly CatalogScreen[], offered: Offered): Cell[] {
  return screens.flatMap((sc) => (offered[sc.module] ?? []).map((a) => ({ sc, a })));
}

/** The menu module's screens in the FULL catalog — what setting a level writes. */
export function fullScreensOf(cmKey: string): CatalogScreen[] {
  const cm = screenCatalog().find((m) => m.key === cmKey);
  return cm ? screensOf(cm) : [];
}

/** The level these cells read as. */
export function levelOf(cells: readonly Cell[], has: Has): Level {
  if (cells.length === 0) return "none";
  let on = 0;
  let all = true;
  let viewOnly = true;
  for (const c of cells) {
    const h = has(c.sc, c.a);
    if (h) on++;
    else all = false;
    if (h !== (c.a === "view")) viewOnly = false;
  }
  if (on === 0) return "none";
  if (all) return "full";
  if (viewOnly) return "view";
  return "custom";
}

/** Should this action be on at this level? Custom keeps what is there. */
export const levelWants = (level: Exclude<Level, "custom">, a: Action) =>
  level === "full" ? true : level === "view" ? a === "view" : false;

/** The cell changes that put a menu module at a level (only cells that differ). */
export function changesForLevel(cmKey: string, level: Exclude<Level, "custom">, offered: Offered, has: Has): CellChange[] {
  return cellsOf(fullScreensOf(cmKey), offered)
    .map((c) => ({ ...c, on: levelWants(level, c.a) }))
    .filter((c) => has(c.sc, c.a) !== c.on);
}

/**
 * Apply cell changes to a tree. A module in MODULE mode is first spread over
 * every screen of that permission module in the full catalog, so the screens
 * the change does not touch keep exactly what they had.
 */
export function applyCells(tree: PermissionTree, changes: readonly CellChange[]): PermissionTree {
  if (changes.length === 0) return tree;
  const next: PermissionTree = { ...tree };
  const byModule = new Map<Module, CellChange[]>();
  for (const c of changes) byModule.set(c.sc.module, [...(byModule.get(c.sc.module) ?? []), c]);
  const all = screenCatalog().flatMap(screensOf);
  for (const [m, list] of byModule) {
    const cur = next[m];
    const grants: Record<string, Action[]> = {};
    if (cur?.mode === "module") {
      for (const sc of all) if (sc.module === m) grants[sc.key] = [...cur.actions];
    } else if (cur?.mode === "screen") {
      for (const [k, v] of Object.entries(cur.grants)) grants[k] = [...v];
    }
    for (const c of list) {
      const set = new Set(grants[c.sc.key] ?? []);
      if (c.on) set.add(c.a);
      else set.delete(c.a);
      if (set.size) grants[c.sc.key] = ACTIONS.filter((a) => set.has(a));
      else delete grants[c.sc.key];
    }
    if (Object.keys(grants).length) next[m] = { mode: "screen", grants };
    else delete next[m];
  }
  return next;
}

/** A tree from levels per menu module — how a suggested role is drawn up. */
export function treeFromLevels(levels: Record<string, Exclude<Level, "custom">>, offered: Offered): PermissionTree {
  let tree: PermissionTree = {};
  for (const [cmKey, level] of Object.entries(levels)) {
    tree = applyCells(tree, changesForLevel(cmKey, level, offered, (sc, a) => treeHas(tree, sc, a)));
  }
  return tree;
}

// ── One person: roles + extras − blocks ─────────────────────────────────────

export function personModel(roleTrees: readonly PermissionTree[], extras: PermissionTree, blocks: readonly Block[]) {
  const blocked = new Set(blocks.map((b) => `${b.screen}|${b.action}`));
  const roleHas: Has = (sc, a) => roleTrees.some((t) => treeHas(t, sc, a));
  const extraHas: Has = (sc, a) => treeHas(extras, sc, a);
  const isBlocked: Has = (sc, a) => blocked.has(`${sc.key}|${a}`);
  const has: Has = (sc, a) => (roleHas(sc, a) || extraHas(sc, a)) && !isBlocked(sc, a);
  return { roleHas, extraHas, isBlocked, has };
}

/**
 * Cell changes for one person → their new extras and blocks. A cell the role
 * gives is turned off by BLOCKING it and back on by lifting the block; any
 * other cell is an extra.
 */
export function applyPersonCells(
  roleTrees: readonly PermissionTree[],
  extras: PermissionTree,
  blocks: readonly Block[],
  changes: readonly CellChange[],
): { extras: PermissionTree; blocks: Block[] } {
  const m = personModel(roleTrees, extras, blocks);
  const extraChanges: CellChange[] = [];
  let bl = [...blocks];
  for (const c of changes) {
    const role = m.roleHas(c.sc, c.a);
    const isB = bl.some((b) => b.screen === c.sc.key && b.action === c.a);
    if (c.on) {
      if (isB) bl = bl.filter((b) => !(b.screen === c.sc.key && b.action === c.a));
      if (!role && !m.extraHas(c.sc, c.a)) extraChanges.push(c);
    } else {
      if (role && !isB) bl.push({ module: c.sc.module, screen: c.sc.key, action: c.a });
      if (m.extraHas(c.sc, c.a)) extraChanges.push(c);
    }
  }
  return { extras: applyCells(extras, extraChanges), blocks: bl };
}

/** Everything this person can open, as one tree — what "Save as a new role" stores. */
export function effectiveTree(has: Has, offered: Offered): PermissionTree {
  const changes = cellsOf(screenCatalog().flatMap(screensOf), offered)
    .filter((c) => has(c.sc, c.a))
    .map((c) => ({ ...c, on: true }));
  return applyCells({}, changes);
}

export type PersonChanges = {
  /** Menu modules the role gives and this person cannot open at all. */
  removed: string[];
  /** Menu modules the role does not give and this person can open. */
  added: string[];
  /** Menu modules partly changed, with how many screens differ. */
  changed: { label: string; screens: number }[];
  /** Modules that differ from the role(s) in any way — the D3 count. */
  total: number;
};

/** How this person differs from their role(s), module by module, over the menu. */
export function personChanges(
  roleTrees: readonly PermissionTree[],
  extras: PermissionTree,
  blocks: readonly Block[],
  offered: Offered,
): PersonChanges {
  const m = personModel(roleTrees, extras, blocks);
  const out: PersonChanges = { removed: [], added: [], changed: [], total: 0 };
  for (const cm of menuCatalog()) {
    const cells = cellsOf(screensOf(cm), offered);
    let roleOn = 0;
    let effOn = 0;
    const diffScreens = new Set<string>();
    for (const c of cells) {
      const r = m.roleHas(c.sc, c.a);
      const e = m.has(c.sc, c.a);
      if (r) roleOn++;
      if (e) effOn++;
      if (r !== e) diffScreens.add(c.sc.key);
    }
    if (diffScreens.size === 0) continue;
    if (roleOn > 0 && effOn === 0) out.removed.push(cm.label);
    else if (roleOn === 0 && effOn > 0) out.added.push(cm.label);
    else out.changed.push({ label: cm.label, screens: diffScreens.size });
  }
  out.total = out.removed.length + out.added.length + out.changed.length;
  return out;
}

/** "– 13 modules", "+ Pulse", "2 screens in Purchase" — the Users column, in words. */
export function changesInWords(c: PersonChanges): string[] {
  const parts: string[] = [];
  if (c.removed.length) parts.push(c.removed.length === 1 ? `– ${c.removed[0]}` : `– ${c.removed.length} modules`);
  if (c.added.length) parts.push(c.added.length === 1 ? `+ ${c.added[0]}` : `+ ${c.added.length} modules`);
  if (c.changed.length)
    parts.push(
      c.changed.length === 1
        ? `${c.changed[0].screens} screen${c.changed[0].screens === 1 ? "" : "s"} in ${c.changed[0].label}`
        : `${c.changed.length} modules adjusted`,
    );
  return parts;
}

/** Past this many changed modules a person's access is really another role (D3). */
export const EXCEPTION_LIMIT = 5;

/** A role's access in one line: "Orders full · Sample full · Purchase view". */
export function roleInWords(tree: PermissionTree, offered: Offered, max = 3): string {
  const parts: string[] = [];
  for (const cm of menuCatalog()) {
    const lvl = levelOf(cellsOf(screensOf(cm), offered), (sc, a) => treeHas(tree, sc, a));
    if (lvl === "none") continue;
    parts.push(`${cm.label} ${lvl === "full" ? "full" : lvl === "view" ? "view" : "custom"}`);
  }
  if (parts.length === 0) return "Nothing yet";
  return parts.length > max ? `${parts.slice(0, max).join(" · ")} · +${parts.length - max} more` : parts.join(" · ");
}

/** One-letter-off emails: the typo twin of an existing person (D5). */
export function nearEmails(email: string, others: readonly string[]): string[] {
  const e = email.trim().toLowerCase();
  return others.filter((o) => {
    const x = o.trim().toLowerCase();
    return x !== e && editDistanceAtMostOne(e, x);
  });
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
