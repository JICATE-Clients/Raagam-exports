import { PageHeader } from "@/components/ui/page-header";
import { TeamsScreen } from "@/components/resolve/admin/teams-screen";
import { requireRh } from "@/lib/resolve/auth";
import { listPeople, listTeams, listTrades } from "@/lib/resolve/service";

export default async function TeamsPage() {
  await requireRh("admin");
  const [rows, people, trades] = await Promise.all([listTeams(), listPeople(), listTrades({ includeInactive: true })]);
  const perms = { canCreate: true, canEdit: true, canDelete: true };
  return (
    <div className="space-y-4">
      <PageHeader title="Repair Teams" description="Each trade's people in this unit — the lead gets new jobs first" />
      <TeamsScreen
        rows={rows}
        perms={perms}
        people={people}
        trades={trades.map((t) => ({ id: t.id, name: t.name, inactive: t.inactive }))}
      />
    </div>
  );
}
