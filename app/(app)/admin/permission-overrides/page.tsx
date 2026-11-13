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
 * Administration ▸ Users & Access ▸ Approved Order Edits (doc/email role
 * system.md §7.1) — the permission-override register.
 *
 * RESTORED 2026-11-13. The 2026-09-30 merge turned this route into a redirect
 * to User Permissions on the promise that the grant screen would render there
 * with `forEmail`; it never did, so for six weeks no override could be granted
 * from anywhere in the app. It is a REGISTER — every live grant, its expiry and
 * its history in one list — which is why it is its own row rather than a
 * section of one person's editor.
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
        title="Approved Order Edits"
        description="Time-limited permission for a named person to correct an approved order in place — no revision, no MD approval, every edit audited."
      />
      <PermissionOverridesScreen grants={grants} grantees={grantees} canManage={canManage} />
    </div>
  );
}
