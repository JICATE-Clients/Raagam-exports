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
      <PageHeader title="Complaint Categories" description="What a complaint can be about, who handles it, and who may see the sensitive ones" />
      <ComplaintCategoriesScreen rows={rows} perms={perms} people={people} />
    </div>
  );
}
