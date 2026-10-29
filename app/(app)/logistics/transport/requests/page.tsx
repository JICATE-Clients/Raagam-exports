import { PageHeader } from "@/components/ui/page-header";
import { can, requirePermission } from "@/lib/auth/server";
import { listRequisitions, orderSourceOptions, placeOptions } from "@/lib/logistics/transport/service";
import { RequestsScreen } from "./requests-screen";

/**
 * LOGISTICS ▸ TRANSPORT ▸ TRIP REQUESTS (doc/vehicle program/plan.md, Screens 3).
 * The list, the orders a request can be charged to and the places it can move
 * between load in one round — all three are small, and the booking sheet then
 * filters in the browser with nothing to wait on.
 */
export default async function TripRequestsPage() {
  await requirePermission("logistics", "view");
  const [rows, orders, places, canCreate, canEdit, canDelete] = await Promise.all([
    listRequisitions(),
    orderSourceOptions(),
    placeOptions(),
    can("logistics", "create"),
    can("logistics", "edit"),
    can("logistics", "delete"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader title="Trip Requests" description="Book a vehicle for an order's material" />
      <RequestsScreen rows={rows} orders={orders} places={places} perms={{ canCreate, canEdit, canDelete }} />
    </div>
  );
}
