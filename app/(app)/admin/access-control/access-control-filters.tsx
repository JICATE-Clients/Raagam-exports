import { KeyRound, ShieldCheck, Users } from "lucide-react";
import { createdGroup, flagFacet, type FacetGroup } from "@/components/ui/filter-drawer";
import type { PermissionTree } from "@/lib/permissions/effective";
import type { AccessRole, AccessUser } from "@/lib/permissions/service";

/**
 * ADMIN ▸ ACCESS CONTROL — THE FILTER DRAWER'S FACETS, one set per tab (user
 * 2026-09-30: "for access control page also add filter option" — the same drawer
 * as Admin ▸ Users and every Orders list, through `MasterListShell`'s
 * `filterPanel` slot). Every facet reads a fact the row already carries.
 *
 * THE PENDING · UPDATED BOX TOO (user 2026-09-30: "add both … option in both
 * pages") — the same box Admin ▸ Users and Order Entry draw beside Filters.
 * An earlier cut left it off because it OPENS on Pending and would show a
 * short list; the user asked for the two pages to match, so the box is here
 * and the words below say what "still to set up" means on each tab.
 */

/**
 * By Role — Pending: the role grants nothing yet (a role nobody has set up
 * the tree for). Updated: it grants access.
 */
export function roleWord(r: AccessRole): "pending" | "updated" {
  return grantsAny(r.tree) ? "updated" : "pending";
}

/**
 * By User — Pending: a working login with no access yet (no role, no
 * personal grants, not super admin), so they can sign in and see nothing.
 * Updated: has access. A deactivated login is neither (null): it shows
 * under All, and the Login facet finds it.
 */
export function userAccessWord(u: AccessUserRow): "pending" | "updated" | null {
  if (!u.login_active) return null;
  return u.is_super_admin || u.roles.length > 0 || grantsAny(u.tree) ? "updated" : "pending";
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

/** The By User row: the person, with `login_active` beside the email-access `is_active`. */
export type AccessUserRow = AccessUser & { login_active: boolean };

/** By User: Role · Email access · Login · Personal grants. */
export function userAccessFacets<R extends AccessUserRow>(rows: R[]): FacetGroup<R>[] {
  const roleNames = [...new Set(rows.flatMap((u) => u.roles))].sort((a, b) => a.localeCompare(b));
  return [
    {
      title: "Access",
      icon: <ShieldCheck />,
      facets: [
        {
          key: "role",
          label: "Role",
          all: "Any role",
          wide: true,
          counted: true,
          options: [
            ...roleNames.map((n) => ({ value: n, label: n })),
            { value: "__super", label: "Super admin" },
            { value: "__none", label: "No role" },
          ],
          match: (u, v) =>
            v === "__super" ? u.is_super_admin : v === "__none" ? !u.is_super_admin && u.roles.length === 0 : u.roles.includes(v),
        },
        {
          key: "email",
          label: "Email access",
          all: "Any",
          counted: true,
          options: [
            { value: "on", label: "Active" },
            { value: "off", label: "Switched off" },
            { value: "none", label: "Not set up" },
          ],
          match: (u, v) => (u.access ? (u.access.is_active ? "on" : "off") : "none") === v,
        },
        flagFacet("grants", "Personal grants", (u) => grantsAny(u.tree), "Has grants", "None"),
      ],
    },
    {
      title: "Login",
      icon: <KeyRound />,
      facets: [flagFacet("login", "Login", (u) => u.login_active, "Active", "Deactivated")],
    },
  ];
}
