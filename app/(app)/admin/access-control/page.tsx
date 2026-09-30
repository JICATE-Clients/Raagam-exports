import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { loadAccessControl } from "@/lib/permissions/service";
import { AccessControlScreen } from "./access-control-screen";

/**
 * Administration ▸ Access Control ▸ Access Control (user 2026-09-30).
 *
 * ONE PAGE FOR BOTH WAYS OF GIVING ACCESS, over one permission tree:
 *   - By Role  — a role's screens and actions (everyone holding it);
 *   - By User  — a person's EMAIL-BASED access, added on top of their roles,
 *                switched Active / Inactive from the list's Status column.
 *                (Approved-order corrections were taken off this sheet on
 *                2026-09-30, screenshot 3148.)
 * Roles & Permissions and Permission Overrides redirect here.
 */
export default async function AccessControlPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; user?: string }>;
}) {
  const me = await requirePermission("system_admin", "view");
  const { tab, user } = await searchParams;

  const [data, canCreate, canEdit, canDelete] = await Promise.all([
    loadAccessControl(),
    can("system_admin", "create"),
    can("system_admin", "edit"),
    can("system_admin", "delete"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Access Control"
        description="Who can open and change each screen — by role, and by person (email-based access on top of their roles)."
      />
      <AccessControlScreen
        data={data}
        meId={me.id}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        initialTab={tab === "users" ? "users" : "roles"}
        initialUser={user ?? null}
      />
    </div>
  );
}
