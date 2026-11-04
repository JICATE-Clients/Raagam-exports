import { PageHeader } from "@/components/ui/page-header";
import { can, requirePermission } from "@/lib/auth/server";
import { getPendingPool, placeOptions, vehicleOptions } from "@/lib/logistics/transport/service";
import { DispatchScreen } from "./dispatch-screen";

/** LOGISTICS ▸ TRANSPORT ▸ DISPATCH (doc/vehicle program/plan.md, Screens 4). */
export default async function DispatchPage() {
  await requirePermission("logistics", "view");
  const [pool, vehicles, places, canDispatch] = await Promise.all([
    getPendingPool(),
    vehicleOptions(),
    placeOptions(),
    can("logistics", "create"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Dispatch" description="Open a destination, tick what goes on the vehicle, and dispatch" />
      <DispatchScreen pool={pool} vehicles={vehicles} places={places} canDispatch={canDispatch} />
    </div>
  );
}
