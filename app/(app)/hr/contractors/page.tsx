import { requirePermission } from "@/lib/auth/server";
import { listContractors, getLocations } from "@/lib/hr/masters-service";
import { PageHeader } from "@/components/ui/page-header";
import ContractorsClient from "./contractors-client";

export default async function ContractorsPage() {
  await requirePermission("hr_payroll", "view");

  const [contractors, locations] = await Promise.all([
    listContractors(),
    getLocations(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Contractors"
        description="Manage piece-rate contractors and their details."
      />
      <ContractorsClient contractors={contractors} locations={locations} />
    </div>
  );
}
