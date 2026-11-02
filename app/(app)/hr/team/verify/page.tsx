import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { VerifyScreen } from "@/components/hr/lifecycle/verify-screen";
import { lifecycleViewer, listDocuments } from "@/lib/hr/lifecycle-service";

export const metadata = { title: "Document Verification" };

export default async function Page() {
  await requirePermission("hr_payroll", "view");
  const [docs, viewer] = await Promise.all([listDocuments(), lifecycleViewer()]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Document Verification"
        description="Open each upload, check it against the original, then verify or reject it. Expiring documents are listed too."
      />
      <VerifyScreen docs={docs} canEdit={viewer.canEdit} />
    </div>
  );
}
