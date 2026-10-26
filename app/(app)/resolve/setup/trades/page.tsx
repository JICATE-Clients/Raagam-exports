import { PageHeader } from "@/components/ui/page-header";
import { TradesScreen } from "@/components/resolve/admin/trades-screen";
import { requireRh } from "@/lib/resolve/auth";
import { listTrades } from "@/lib/resolve/service";

export default async function TradesPage() {
  await requireRh("admin");
  const rows = await listTrades({ includeInactive: true });
  const perms = { canCreate: true, canEdit: true, canDelete: true };
  return (
    <div className="space-y-4">
      <PageHeader title="Trades" description="The kinds of fix — every unit's teams and routing pick from this list" />
      <TradesScreen rows={rows} perms={perms} />
    </div>
  );
}
