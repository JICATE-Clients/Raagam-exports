import { PageHeader } from "@/components/ui/page-header";
import { ComplaintCategoriesScreen } from "@/components/resolve/complaints/categories-screen";
import { requireRh } from "@/lib/resolve/auth";
import { listComplaintCategories, listPeople } from "@/lib/resolve/service";

export default async function ComplaintCategoriesPage() {
  await requireRh("admin");
  const [rows, people] = await Promise.all([listComplaintCategories(), listPeople()]);
  const perms = { canCreate: true, canEdit: true, canDelete: true };
  return (
    <div className="space-y-4">
      <PageHeader title="Complaint Types" description="What a concern can be about, who looks into it, and who may see the confidential ones" />
      <ComplaintCategoriesScreen rows={rows} perms={perms} people={people} />
    </div>
  );
}
