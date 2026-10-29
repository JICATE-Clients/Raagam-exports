import { PageHeader } from "@/components/ui/page-header";
import { can, requirePermission } from "@/lib/auth/server";
import { listVehicles } from "@/lib/logistics/transport/service";
import { VehiclesScreen } from "./vehicles-screen";

export default async function VehiclesPage() {
  await requirePermission("logistics", "view");
  const [rows, canCreate, canEdit, canDelete] = await Promise.all([
    listVehicles(),
    can("logistics", "create"),
    can("logistics", "edit"),
    can("logistics", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Vehicles" description="The fleet — number, type, payload and GPS device" />
      <VehiclesScreen rows={rows} perms={{ canCreate, canEdit, canDelete }} />
    </div>
  );
}
