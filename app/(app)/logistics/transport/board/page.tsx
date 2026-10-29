import { PageHeader } from "@/components/ui/page-header";
import { can, requirePermission } from "@/lib/auth/server";
import { listTrips, vehicleOptions } from "@/lib/logistics/transport/service";
import { BoardScreen } from "./board-screen";

/** LOGISTICS ▸ TRANSPORT ▸ FLEET BOARD (doc/vehicle program/plan.md, Screens 5). */
export default async function FleetBoardPage() {
  await requirePermission("logistics", "view");
  const [trips, vehicles, canEdit] = await Promise.all([
    listTrips({ active: true }),
    vehicleOptions(),
    can("logistics", "edit"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Fleet Board" description="Every trip on the road, its load and its last update" />
      <BoardScreen trips={trips} vehicles={vehicles} canEdit={canEdit} />
    </div>
  );
}
