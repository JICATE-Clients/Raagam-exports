import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  canManageOverrides,
  canViewOverrides,
  listOverrideGrantees,
  listOverrideGrants,
} from "@/lib/orders/overrides/service";
import { PermissionOverridesScreen } from "./permission-overrides-screen";

/**
 * Admin ▸ Access Control ▸ Permission Overrides (doc/email role system.md §7.1).
 *
 * NOT `requirePermission("system_admin", "view")`: the Managing Director may
 * grant overrides (R-15, D-7) without holding system_admin at all, so the gate
 * is the database's own — `can_view_permission_overrides()`, the function the
 * tables' RLS reads. Managing is `can_manage_permission_overrides()`; the grant
 * RPCs refuse anyone else whatever this page shows.
 */
export default async function PermissionOverridesPage() {
  await requireUser();
  const [canView, canManage] = await Promise.all([canViewOverrides(), canManageOverrides()]);
  if (!canView) redirect("/?denied=system_admin");

  const [grants, grantees] = await Promise.all([
    listOverrideGrants(),
    // The picker is a manager's; override_grantee_candidates() refuses anyone else.
    canManage ? listOverrideGrantees() : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Permission Overrides"
        description="Time-limited access for a named user to correct an approved order in place — no revision, no MD approval, every edit audited."
      />
      <PermissionOverridesScreen grants={grants} grantees={grantees} canManage={canManage} />
    </div>
  );
}
