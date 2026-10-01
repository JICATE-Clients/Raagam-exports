import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { loadAccessControl } from "@/lib/permissions/service";
import { AccessControlScreen } from "../access-control/access-control-screen";

/**
 * Administration ▸ Users & Access ▸ User Permissions (user 2026-10-01: "list
 * the by user as separate with a better label").
 *
 * A PERSON's own email-based access, added on top of their roles, switched
 * Active / Inactive from the list's Status column. It was the By User tab of
 * Access Control until today; it is the same screen component over the same
 * permission tree, rendering this one list (`view="users"`), so the two pages
 * can never save access two different ways. /admin/permission-overrides and
 * the old /admin/access-control?tab=users redirect here.
 */
export default async function UserPermissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ user?: string }>;
}) {
  const me = await requirePermission("system_admin", "view");
  const { user } = await searchParams;

  const [data, canCreate, canEdit, canDelete] = await Promise.all([
    loadAccessControl(),
    can("system_admin", "create"),
    can("system_admin", "edit"),
    can("system_admin", "delete"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="User Permissions"
        description="Access given to one person by email, on top of their roles — switch it Active or Inactive from the list."
      />
      <AccessControlScreen
        data={data}
        meId={me.id}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        view="users"
        initialUser={user ?? null}
      />
    </div>
  );
}
