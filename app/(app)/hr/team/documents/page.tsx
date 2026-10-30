import { Suspense } from "react";
import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { DocumentsScreen } from "@/components/hr/lifecycle/documents-screen";
import { lifecycleViewer, listDocuments, listLifecyclePeople, listRequiredDocs } from "@/lib/hr/lifecycle-service";

export const metadata = { title: "People Documents" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const viewer = await lifecycleViewer();
  const [docs, required, people] = await Promise.all([listDocuments(), listRequiredDocs(), listLifecyclePeople(viewer)]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="People Documents"
        description="Pick a person to see which documents they have handed in, and upload the rest. HR verifies each one."
      />
      <Suspense>
        <DocumentsScreen docs={docs} required={required} people={people} selfOnly={!!viewer.myStaffId} />
      </Suspense>
    </div>
  );
}
