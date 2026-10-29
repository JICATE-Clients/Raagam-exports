import { PageHeader } from "@/components/ui/page-header";
import { can, requirePermission } from "@/lib/auth/server";
import { listPlaces, unitOptions, vendorOptions } from "@/lib/logistics/transport/service";
import { PlacesScreen } from "./places-screen";

export default async function TransportPlacesPage() {
  await requirePermission("logistics", "view");
  const [rows, units, vendors, canCreate, canEdit, canDelete] = await Promise.all([
    listPlaces(),
    unitOptions(),
    vendorOptions(),
    can("logistics", "create"),
    can("logistics", "edit"),
    can("logistics", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Transport Places" description="Every stop a vehicle starts or ends at, with its geofence" />
      <PlacesScreen rows={rows} units={units} vendors={vendors} perms={{ canCreate, canEdit, canDelete }} />
    </div>
  );
}
