import { notFound } from "next/navigation";
import { can, requirePermission } from "@/lib/auth/server";
import { revisionShort } from "@/lib/sales/sample-costing/types";
import { getCostingLetterhead, getCostingRevisionSources, getSampleCostingFormData, getSampleCostingRecord } from "@/lib/sales/sample-costing/service";
import { buildRevisionHistory } from "@/lib/sales/sample-costing/revision-history";
import { buildCostSheetModel } from "@/lib/sales/sample-costing/cost-sheet";
import { buildQuotationModel } from "@/lib/sales/sample-costing/quotation";
import { PageHeader } from "@/components/ui/page-header";
import { CostingReports } from "./costing-reports";

/**
 * COSTING ▸ REPORTS, at `/sales/sample-costing/<costing id>/reports`.
 *
 * The one door the list's Reports icon opens (as Order Entry's does for an
 * order): the internal Cost Sheet and the buyer's Quotation, side by side as
 * tabs. Both are documents of ONE saved costing and are built here, from the same
 * record, so the page, its PDF and its Excel file can never disagree. It lists
 * nothing and edits nothing, so it carries no pager and no reload guard.
 *
 * `?tab=quotation` opens the Quotation; anything else opens the Cost Sheet.
 */
export const metadata = { title: "Costing Reports" };

export default async function CostingReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePermission("sales", "view");
  const [{ id }, sp, canEdit] = await Promise.all([params, searchParams, can("sales", "edit")]);
  const [record, data, letterhead] = await Promise.all([getSampleCostingRecord(id), getSampleCostingFormData(), getCostingLetterhead()]);
  if (!record) notFound();
  const history = buildRevisionHistory(await getCostingRevisionSources(record.code), record.id);
  const cost = buildCostSheetModel(record, data, letterhead, history);
  const quote = buildQuotationModel(record, data, letterhead, history);
  return (
    <div className="space-y-4">
      <PageHeader title="Costing Reports" description={[cost.costingNo, cost.revision, cost.style].filter(Boolean).join(" · ")} />
      <CostingReports
        cost={cost}
        quote={quote}
        initial={sp.tab === "quotation" ? "quotation" : "cost-sheet"}
        /* REVISE FROM THE REPORT (client 2026-10-09) — offered under the editor's own
           two conditions: the costing is APPROVED and the reader may edit. A draft or
           one with the MD is edited in place, and a superseded revision is history. */
        revise={canEdit && record.status === "approved" ? { id: record.id, nextLabel: revisionShort(record.version + 1) } : null}
      />
    </div>
  );
}
