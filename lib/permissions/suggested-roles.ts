import type { Action } from "@/lib/auth/types";
import { menuCatalog } from "./screen-catalog";
import type { PermissionTree } from "./effective";
import { applyCells, cellsOf, fullScreensOf, treeFromLevels, type Level, type Offered } from "./levels";

/**
 * SUGGESTED JOB ROLES (plan D1, approved 2026-11-14). The roles a garment unit
 * actually has, drawn up as DRAFTS: Roles & Permissions lists the ones not yet
 * created, and "Review & create" opens the role sheet filled in — nothing is
 * stored until the admin saves it. A suggestion is a starting point, never
 * applied behind anyone's back.
 *
 * Keyed by SIDEBAR module (its nav href), the way the access screens read.
 * Every role gets Dashboard, Favourites and Pulse: the home page, the
 * person's own tiles, and the messages / My Approvals inbox everyone works from.
 *
 * "Managing Director" is spelled exactly so: 16 approval steps route to a role
 * of that name (approver_role_key), and nothing reaches them until it exists
 * and someone holds it.
 */

type Lv = Exclude<Level, "custom">;

export type SuggestedRole = {
  name: string;
  description: string;
  levels: Record<string, Lv>;
  /** View on every sidebar module, plus these actions wherever offered. */
  everyModule?: Action[];
};

const BASE: Record<string, Lv> = { "/": "full", "/favourites": "full", "/comms": "full" };

export const SUGGESTED_ROLES: readonly SuggestedRole[] = [
  {
    name: "Managing Director",
    description: "Sees every module, approves and exports. Approval steps route here.",
    levels: BASE,
    everyModule: ["approve", "export"],
  },
  {
    name: "Merchandiser",
    description: "Orders and Sample in full; Planning, Purchase and Reports to read.",
    levels: { ...BASE, "/orders": "full", "/sales": "full", "/planning": "view", "/purchase": "view", "/reports": "view", "/masters": "view" },
  },
  {
    name: "Store Keeper",
    description: "Stores in full; Purchase and Reports to read.",
    levels: { ...BASE, "/stores": "full", "/purchase": "view", "/reports": "view", "/masters": "view" },
  },
  {
    name: "Purchase",
    description: "Purchase in full; Orders, Stores and Reports to read.",
    levels: { ...BASE, "/purchase": "full", "/orders": "view", "/stores": "view", "/reports": "view", "/masters": "view" },
  },
  {
    name: "Accounts",
    description: "Finance in full; Purchase, Logistics and Reports to read.",
    levels: { ...BASE, "/finance": "full", "/purchase": "view", "/logistics": "view", "/reports": "view" },
  },
  {
    name: "HR Executive",
    description: "HR & Payroll in full.",
    levels: { ...BASE, "/hr": "full" },
  },
  {
    name: "Production",
    description: "Production and Process in full; Orders and Stores to read.",
    levels: { ...BASE, "/production": "full", "/process": "full", "/orders": "view", "/stores": "view" },
  },
  {
    name: "Sample",
    description: "Sample in full; Orders and Master Data to read.",
    levels: { ...BASE, "/sales": "full", "/orders": "view", "/masters": "view" },
  },
  {
    name: "Pulse only",
    description: "Messages and My Approvals only.",
    levels: BASE,
  },
];

/** The draft tree for a suggestion, against this database's permission catalog. */
export function suggestedTree(s: SuggestedRole, offered: Offered): PermissionTree {
  const known = new Set(menuCatalog().map((cm) => cm.key));
  const levels: Record<string, Lv> = {};
  if (s.everyModule) for (const k of known) levels[k] = "view";
  for (const [k, v] of Object.entries(s.levels)) if (known.has(k)) levels[k] = v;
  let tree = treeFromLevels(levels, offered);
  if (s.everyModule?.length) {
    const extra = [...known].flatMap((k) =>
      cellsOf(fullScreensOf(k), offered)
        .filter((c) => s.everyModule!.includes(c.a))
        .map((c) => ({ ...c, on: true })),
    );
    tree = applyCells(tree, extra);
  }
  return tree;
}
