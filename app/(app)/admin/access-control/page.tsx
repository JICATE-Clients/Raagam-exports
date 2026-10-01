import { redirect } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { loadAccessControl } from "@/lib/permissions/service";
import { AccessControlScreen } from "./access-control-screen";

/**
 * Administration ▸ Users & Access ▸ Roles & Permissions.
 *
 * A role's screens and actions, for everyone holding it, over the one
 * permission tree (0658). Until 2026-10-01 this page also carried a By User
 * tab; a person's own email-based access is now its own screen,
 * /admin/user-permissions (user: "list the by user as separate with a better
 * label"). The ROUTE stays /admin/access-control so every bookmark lands, and
 * an old `?tab=users` / `?user=` link is sent on to the new screen.
 * /admin/roles redirects here.
 */
export default async function RolesAndPermissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; user?: string }>;
}) {
  const { tab, user } = await searchParams;
  if (tab === "users" || user) {
    redirect(user ? `/admin/user-permissions?user=${encodeURIComponent(user)}` : "/admin/user-permissions");
  }

  const me = await requirePermission("system_admin", "view");
  const [data, canCreate, canEdit, canDelete] = await Promise.all([
    loadAccessControl(),
    can("system_admin", "create"),
    can("system_admin", "edit"),
    can("system_admin", "delete"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Roles & Permissions"
        description="Who can open and change each screen, by role — everyone holding a role gets its access."
      />
      <AccessControlScreen
        data={data}
        meId={me.id}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        view="roles"
        initialUser={null}
      />
    </div>
  );
}
