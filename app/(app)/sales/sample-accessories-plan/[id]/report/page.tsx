import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { accessoriesPlanReport } from "@/lib/sales/plan-reports/service";
import { PageHeader } from "@/components/ui/page-header";
import { BackLink } from "@/components/ui/back-link";
import { AccessoriesPlanReportView } from "@/components/sales/plan-reports";

/**
 * SAMPLE ▸ ACCESSORIES PLAN ▸ REPORT, at `/sales/sample-accessories-plan/<plan id>/report`
 * (user 2026-10-13: "like order entry report"). The plan as a document — the
 * same one the approver reads on Sample ▸ Plan Approval — with Download PDF
 * and Print. It lists nothing and edits nothing: no pager, no reload guard.
 */
export const metadata = { title: "Sample Accessories Plan" };

export default async function SampleAccessoriesPlanReportPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales", "view");
  const { id } = await params;
  const report = await accessoriesPlanReport(id);
  if (!report) notFound();
  return (
    <div className="space-y-4">
      <BackLink target={{ href: `/sales/sample-accessories-plan?open=${report.header.iwoId}`, label: "Accessories Plan" }} />
      <PageHeader
        title="Sample Accessories Plan"
        description={[report.header.swoCode, report.header.revisionNo ? `Rev ${report.header.revisionNo}` : null].filter(Boolean).join(" · ")}
      />
      <AccessoriesPlanReportView report={report} />
    </div>
  );
}
