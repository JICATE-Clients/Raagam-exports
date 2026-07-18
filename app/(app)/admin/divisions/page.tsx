import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { listDivisions } from "@/lib/masters/division-service";
import { DivisionMasterScreen } from "@/components/masters/division-master-screen";
import { can } from "@/lib/auth/server";

export default async function AdminDivisionsPage() {
  await requirePermission("system_admin", "view");
  const rows = await listDivisions();
  const [canCreate, canEdit, canDelete, canExport, isSuperAdmin] = await Promise.all([
    can("masters", "create"),
    can("masters", "edit"),
    can("masters", "delete"),
    can("masters", "export"),
    can("system_admin", "edit"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Divisions"
        description="Business units / divisions."
      />
      <DivisionMasterScreen
        rows={rows}
        perms={{ canCreate, canEdit, canDelete, canExport, isSuperAdmin }}
      />
    </div>
  );
}
