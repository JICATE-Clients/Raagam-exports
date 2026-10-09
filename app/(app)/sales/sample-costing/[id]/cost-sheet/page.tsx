import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { getCostingLetterhead, getSampleCostingFormData, getSampleCostingRecord } from "@/lib/sales/sample-costing/service";
import { buildCostSheetModel } from "@/lib/sales/sample-costing/cost-sheet";
import { CostSheetDocument } from "@/components/sales/cost-sheet-document";
import { PageHeader } from "@/components/ui/page-header";

/**
 * THE SAMPLE COST SHEET, at `/sales/sample-costing/<costing id>/cost-sheet`.
 *
 * A document of one saved costing: the page, its PDF and its Excel file all draw
 * from `buildCostSheetModel`, so they cannot disagree. INTERNAL — it prints
 * rates, margin and wastage; the buyer's document is the Quotation.
 *
 * It lists NOTHING, so it carries no pager, and it is read-only, so it declares
 * no reload guard (a guard here would only block the silent updater on this
 * route to protect nothing).
 */
export default async function CostSheetPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("sales", "view");
  const { id } = await params;
  const [record, data, letterhead] = await Promise.all([getSampleCostingRecord(id), getSampleCostingFormData(), getCostingLetterhead()]);
  if (!record) notFound();
  const model = buildCostSheetModel(record, data, letterhead);
  return (
    <div className="space-y-4">
      <PageHeader title="Sample Cost Sheet" description={[model.costingNo, model.revision, model.style].filter(Boolean).join(" · ")} />
      <CostSheetDocument model={model} />
    </div>
  );
}
