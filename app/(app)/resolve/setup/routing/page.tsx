import { PageHeader } from "@/components/ui/page-header";
import { RoutingScreen } from "@/components/resolve/admin/routing-screen";
import { requireRh } from "@/lib/resolve/auth";
import { listPeople, listPlaces, listRoutingOverrides, listTrades } from "@/lib/resolve/service";

export default async function RoutingPage() {
  await requireRh("admin");
  const [rows, people, trades, places] = await Promise.all([
    listRoutingOverrides(),
    listPeople(),
    listTrades({ includeInactive: true }),
    listPlaces(),
  ]);
  const perms = { canCreate: true, canEdit: true, canDelete: true };
  return (
    <div className="space-y-4">
      <PageHeader title="Who Gets Which Job" description="Send a trade, a place, or both to a named owner — these rules win over every other" />
      <RoutingScreen
        rows={rows}
        perms={perms}
        people={people}
        trades={trades.map((t) => ({ id: t.id, name: t.name, inactive: t.inactive }))}
        places={places.map((p) => ({ id: p.id, name: p.name, inactive: p.inactive }))}
      />
    </div>
  );
}
