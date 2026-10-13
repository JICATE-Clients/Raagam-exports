import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { fabricPlanReport } from "@/lib/sales/plan-reports/service";
import { PageHeader } from "@/components/ui/page-header";
import { BackLink } from "@/components/ui/back-link";
import { FabricPlanReportView } from "@/components/sales/plan-reports";

/**
 * SAMPLE ▸ FABRIC PLAN ▸ REPORT, at `/sales/sample-fabric-plan/<plan id>/report`
 * (user 2026-10-13: "like order entry report"). The plan as a document — the
 * same one the approver reads on Sample ▸ Plan Approval — with Download PDF
 * and Print. It lists nothing and edits nothing: no pager, no reload guard.
 */
export const metadata = { title: "Sample Fabric Plan" };

export default async function SampleFabricPlanReportPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales", "view");
  const { id } = await params;
  const report = await fabricPlanReport(id);
  if (!report) notFound();
  return (
    <div className="space-y-4">
      <BackLink target={{ href: `/sales/sample-fabric-plan?open=${report.header.iwoId}`, label: "Fabric Plan" }} />
      <PageHeader
        title="Sample Fabric Plan"
        description={[report.header.swoCode, report.header.revisionNo ? `Rev ${report.header.revisionNo}` : null].filter(Boolean).join(" · ")}
      />
      <FabricPlanReportView report={report} />
    </div>
  );
}
