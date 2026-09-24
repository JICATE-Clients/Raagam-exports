import { requirePermission } from "@/lib/auth/server";
import { listCadStyles } from "@/lib/orders/cad-lifecycle/service";
import { PageHeader } from "@/components/ui/page-header";
import { CadCompletionReport } from "./cad-completion-report";

/**
 * Reports ▸ CAD Completion (doc/order/cad.md §6.1, 0628).
 *
 * The CAD department's efficiency, one row per (order, style): who made it,
 * how many versions it took, where it stands, and Final Approval Lead Time =
 * the approval date − Version 1's allocation date. The arithmetic is
 * `cadCompletionOf` (lib/orders/cad-lifecycle/types.ts), the one definition
 * the CAD Lifecycle screen also reads — never re-derived here.
 *
 * Only styles that have been ALLOCATED at least once are listed: a style with
 * no CAD work has no lead time to report and nobody to attribute it to. The
 * lifecycle screen is where the unallocated ones are chased.
 */
export default async function CadCompletionReportPage() {
  await requirePermission("reports", "view");
  const rows = (await listCadStyles()).filter((r) => r.versions.length > 0);
  return (
    <div className="space-y-4">
      <PageHeader
        title="CAD Completion"
        description="Versions per style and the lead time from first allocation to buyer approval."
      />
      <CadCompletionReport rows={rows} />
    </div>
  );
}
