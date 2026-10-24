import { requireRh } from "@/lib/resolve/auth";
import { listOpenComplaintCategories } from "@/lib/resolve/service";
import { PageHeader } from "@/components/ui/page-header";
import { ComplaintForm } from "@/components/resolve/complaint/complaint-form";

/** MAKE A COMPLAINT — the form; who sees it is said on the form itself. */
export default async function ComplaintPage() {
  await requireRh("view");
  const categories = await listOpenComplaintCategories();

  return (
    <div className="space-y-4">
      <PageHeader title="Make a complaint" back={{ href: "/resolve/report", label: "Report a problem" }} />
      {categories.length === 0 ? (
        <p className="max-w-[40rem] rounded-lg border border-border p-4 text-sm text-muted-foreground">
          Complaints are not set up for this unit yet. Until they are, speak to your department head
          or HR.
        </p>
      ) : (
        <ComplaintForm categories={categories} />
      )}
    </div>
  );
}
