import type { PermissionTree } from "@/lib/permissions/effective";

/** "3 modules · 1 per screen" — what a permission tree grants, in a list cell.
 *  Shared by Roles & Permissions (a role's tree) and Users (a person's extra
 *  screens), so the two read a tree the same way. */
export function treeSummary(tree: PermissionTree): string {
  const settings = Object.values(tree).filter(Boolean);
  if (settings.length === 0) return "—";
  const perScreen = settings.filter((s) => s!.mode === "screen").length;
  return `${settings.length} module${settings.length === 1 ? "" : "s"}${perScreen ? ` · ${perScreen} per screen` : ""}`;
}
