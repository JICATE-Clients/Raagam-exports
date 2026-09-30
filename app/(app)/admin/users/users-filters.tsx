import { KeyRound, ShieldCheck, Users } from "lucide-react";
import { createdGroup, flagFacet, type FacetGroup } from "@/components/ui/filter-drawer";
import type { UserRoleEntry, UserRow } from "./page";

/**
 * ADMIN ▸ USERS — THE FILTER DRAWER'S FACETS (user 2026-09-30: "add filter
 * option for this user page … we have the global filter, customise it").
 *
 * The same drawer every Orders list uses (`useFacetFilter` + `FilterBar`), so
 * this list filters the way the rest of the app does. Its own file, so the
 * screen gains a few lines rather than a block of facet definitions.
 *
 * A row is a STAFF member from HR & Payroll ▸ People ▸ Staff with an optional login (`profile`),
 * so the facets ask the questions an administrator has of that list — who
 * still has no login, who is on which role, who has not yet chosen a password:
 *   Login        has a login / no login yet
 *   Role         an assigned role, or "No role"
 *   Status       login active / inactive / no login
 *   Super admin  `profile.is_super_admin`
 *   Password     still on the temporary password (`must_change_password`)
 *   Created      the shared Created Date / Created By group — Order Entry's
 *                drawer ends with it too (each row carries its login's
 *                `created_at`; a row with no login has none)
 */
export function userFacets(rows: UserRow[], userRoles: UserRoleEntry[]): FacetGroup<UserRow>[] {
  const rolesOf = new Map<string, Set<string>>();
  for (const ur of userRoles) {
    const set = rolesOf.get(ur.user_id) ?? new Set<string>();
    set.add(ur.role_name);
    rolesOf.set(ur.user_id, set);
  }
  const roleNames = [...new Set(userRoles.map((ur) => ur.role_name))].sort((a, b) => a.localeCompare(b));

  return [
    {
      title: "Access",
      icon: <ShieldCheck />,
      facets: [
        flagFacet("login", "Login", (r) => !!r.profile, "Has a login", "No login yet"),
        {
          key: "role",
          label: "Role",
          all: "Any role",
          wide: true,
          counted: true,
          options: [...roleNames.map((n) => ({ value: n, label: n })), { value: "__none", label: "No role" }],
          match: (r, v) => {
            const mine = r.profile ? rolesOf.get(r.profile.id) : undefined;
            return v === "__none" ? !mine || mine.size === 0 : !!mine?.has(v);
          },
        },
        {
          key: "status",
          label: "Status",
          all: "Any",
          counted: true,
          options: [
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
            { value: "none", label: "No login" },
          ],
          match: (r, v) => (r.profile ? (r.profile.is_active ? "active" : "inactive") : "none") === v,
        },
      ],
    },
    {
      title: "Login details",
      icon: <KeyRound />,
      facets: [
        flagFacet("super", "Super admin", (r) => !!r.profile?.is_super_admin, "Super admin", "Not super admin"),
        flagFacet(
          "password",
          "Password",
          (r) => !!r.profile?.must_change_password,
          "Temporary password pending",
          "Password set or no login",
        ),
      ],
    },
    ...createdGroup(rows, <Users />),
  ];
}

/** What the search box matches: name, employee code, email, phone and role names. */
export function userSearchText(r: UserRow, userRoles: UserRoleEntry[]): string {
  const roles = r.profile ? userRoles.filter((ur) => ur.user_id === r.profile!.id).map((ur) => ur.role_name) : [];
  return [r.name, r.code, r.email, r.profile?.phone, r.profile?.full_name, ...roles]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * THE PENDING · UPDATED BOX, Order Entry's own (`useQuickStatus`, user
 * 2026-09-30: "use the same UI as Order Entry"). The words are the app's
 * fixed vocabulary, so they are given the meaning they carry everywhere else —
 * the work still to do, and the work done:
 *   Pending  onboarding not finished — no login yet, or still on the
 *            temporary password (a welcome mail to send, or to be used)
 *   Updated  has a login and has chosen their own password
 * A switched-off login is neither (null): it shows under All, and the Status
 * facet finds it. Draft is off — nothing on this screen is a draft.
 */
export function userWord(r: UserRow): "pending" | "updated" | null {
  if (!r.profile || r.profile.must_change_password) return "pending";
  return r.profile.is_active ? "updated" : null;
}
