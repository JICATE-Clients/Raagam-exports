import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/server";
import { getFleetMap } from "@/lib/logistics/transport/service";
import { FleetMapScreen } from "./fleet-map-screen";

/** LOGISTICS ▸ TRANSPORT ▸ FLEET MAP — places, fences and the trips on the road (OpenStreetMap). */
export default async function FleetMapPage() {
  await requirePermission("logistics", "view");
  const { places, trips } = await getFleetMap();
  return (
    <div className="space-y-4">
      <PageHeader title="Fleet Map" description="Places, their fences and every vehicle on a trip" />
      <FleetMapScreen places={places} trips={trips} />
    </div>
  );
}
