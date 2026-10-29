import { PageHeader } from "@/components/ui/page-header";
import { ServiceCategoriesScreen } from "@/components/resolve/admin/service-categories-screen";
import { requireRh } from "@/lib/resolve/auth";
import { listServiceCategories } from "@/lib/resolve/desk-service";
import { listTeams } from "@/lib/resolve/service";

export default async function ServiceCategoriesPage() {
  await requireRh("admin");
  const [rows, teams] = await Promise.all([listServiceCategories(), listTeams()]);
  const perms = { canCreate: true, canEdit: true, canDelete: true };
  return (
    <div className="space-y-4">
      <PageHeader title="IT Help Types" description="What an IT request can be about — its type, the team it goes to, and its starting priority" />
      <ServiceCategoriesScreen
        rows={rows}
        perms={perms}
        teams={teams.map((t) => ({ id: t.id, name: t.name, inactive: t.inactive }))}
      />
    </div>
  );
}
