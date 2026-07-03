import { requirePermission, can } from "@/lib/auth/server";
import { listWorkers, listContractors, getLocations } from "@/lib/hr/masters-service";
import { PageHeader } from "@/components/ui/page-header";
import WorkersClient from "./workers-client";

export default async function WorkersPage() {
  await requirePermission("hr_payroll", "view");

  const [workers, contractors, locations, canCreate, canExport, canDelete] =
    await Promise.all([
      listWorkers(),
      listContractors(),
      getLocations(),
      can("hr_payroll", "create"),
      can("hr_payroll", "export"),
      can("hr_payroll", "delete"),
    ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Workers"
        description="Manage shift workers and piece-rate workers."
      />
      <WorkersClient
        workers={workers}
        contractors={contractors}
        locations={locations}
        canCreate={canCreate}
        canExport={canExport}
        canDelete={canDelete}
      />
    </div>
  );
}
