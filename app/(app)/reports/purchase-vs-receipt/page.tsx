import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { fmtNumber } from "@/lib/format";
import { getItemMovement, getItemReportFilterOptions } from "@/lib/reports/item-service";
import { readItemFilters, filterState, type SearchParams } from "@/lib/reports/filters";
import { ItemReportFilters } from "../_components/item-report-filters";
import { PurchaseVsReceiptReport } from "./purchase-vs-receipt-report";

/**
 * Purchase vs Receipt — a reconciliation, not a summary.
 *
 * Three numbers that *should* agree and can silently disagree:
 *   ordered (po_line_items) → GRN accepted (grn_line_items) → received (stock_ledger)
 *
 * GRN stock-in in `lib/purchase/grn-actions.ts` posts inside a swallowed
 * try/catch, so a GRN can be posted while its stock movement never lands. This
 * report is where that shows up instead of staying invisible.
 */
export default async function PurchaseVsReceiptPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requirePermission("reports", "view");

  const params = await searchParams;
  const filters = readItemFilters(params, "item_name");

  const [rows, options] = await Promise.all([
    getItemMovement(filters),
    getItemReportFilterOptions(),
  ]);

  const ordered = rows.reduce((s, r) => s + r.qty_ordered, 0);
  const accepted = rows.reduce((s, r) => s + r.qty_grn_accepted, 0);
  const received = rows.reduce((s, r) => s + r.qty_received, 0);
  const gap = accepted - received;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase vs Receipt"
        description="Ordered against GRN-accepted against what actually reached stock"
      />

      <ItemReportFilters
        options={options}
        groupByFields={[]}
        current={filterState(filters)}
        basePath="/reports/purchase-vs-receipt"
        showGroupBy={false}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Ordered" value={fmtNumber(ordered)} />
        <Stat label="GRN accepted" value={fmtNumber(accepted)} />
        <Stat label="Reached stock" value={fmtNumber(received)} />
        <Stat
          label="Unposted to stock"
          value={fmtNumber(gap)}
          tone={gap !== 0 ? "danger" : "success"}
          hint={gap !== 0 ? "GRN accepted but no stock movement" : "Reconciled"}
        />
      </div>

      <PurchaseVsReceiptReport rows={rows} />
    </div>
  );
}
