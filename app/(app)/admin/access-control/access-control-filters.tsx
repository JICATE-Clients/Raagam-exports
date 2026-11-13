import { ShieldCheck, Users } from "lucide-react";
import { createdGroup, flagFacet, type FacetGroup } from "@/components/ui/filter-drawer";
import type { PermissionTree } from "@/lib/permissions/effective";
import type { AccessRole } from "@/lib/permissions/service";

/**
 * ADMIN ▸ ROLES & PERMISSIONS — THE FILTER DRAWER'S FACETS (user
 * 2026-09-30: "for access control page also add filter option" — the same drawer
 * as Admin ▸ Users and every Orders list, through `MasterListShell`'s
 * `filterPanel` slot). Every facet reads a fact the row already carries.
 *
 * The By User facets left with the User Permissions list (2026-11-13): a
 * person's access is filtered on Users (`users-filters.tsx`).
 */

/**
 * By Role — Pending: the role grants nothing yet (a role nobody has set up
 * the tree for). Updated: it grants access.
 */
export function roleWord(r: AccessRole): "pending" | "updated" {
  return grantsAny(r.tree) ? "updated" : "pending";
}

/** Does a permission tree grant anything at all? */
const grantsAny = (tree: PermissionTree) => Object.values(tree).some(Boolean);

/** By Role: Type · Users · Access · Created. */
export function roleFacets(rows: AccessRole[]): FacetGroup<AccessRole>[] {
  return [
    {
      title: "Role",
      icon: <ShieldCheck />,
      facets: [
        flagFacet("type", "Type", (r) => r.is_system, "System", "Custom"),
        flagFacet("holders", "Users", (r) => r.holders > 0, "Held by someone", "Nobody holds it"),
        flagFacet("access", "Access", (r) => grantsAny(r.tree), "Grants access", "Grants nothing yet"),
      ],
    },
    ...createdGroup(rows, <Users />),
  ];
}
