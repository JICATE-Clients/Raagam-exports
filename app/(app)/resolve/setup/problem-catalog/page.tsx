import { PageHeader } from "@/components/ui/page-header";
import { ProblemCatalogScreen } from "@/components/resolve/admin/problem-catalog-screen";
import { requireRh } from "@/lib/resolve/auth";
import { listCatalog, listCatalogRouting } from "@/lib/resolve/catalog-service";

export default async function ProblemCatalogPage() {
  await requireRh("admin");
  const [{ areas, items }, routing] = await Promise.all([listCatalog(), listCatalogRouting()]);
  const perms = { canCreate: true, canEdit: true, canDelete: true };
  return (
    <div className="space-y-4">
      <PageHeader
        title="Problem List"
        description="What Raagam Assist offers a reporter in each lane, and where each problem goes"
      />
      <ProblemCatalogScreen areas={areas} items={items} routing={routing} perms={perms} />
    </div>
  );
}
