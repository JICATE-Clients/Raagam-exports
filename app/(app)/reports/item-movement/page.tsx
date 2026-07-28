import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { fmtMoney, fmtNumber } from "@/lib/format";
import {
  getItemMovement,
  getItemReportFilterOptions,
  listAttributeDimensions,
} from "@/lib/reports/item-service";
import { readItemFilters, filterState, type SearchParams } from "@/lib/reports/filters";
import { DEFAULT_GROUP_BY, ITEM_DIMENSIONS } from "@/lib/reports/registry";
import { ItemReportFilters } from "../_components/item-report-filters";
import { ItemMovementReport } from "./item-movement-report";

/**
 * Item Purchase & Consumption — the flagship item report.
 *
 * Server component: gate, read filters from the URL, fetch. It hands the client
 * wrapper a plain rows array and plain field descriptors; the `ReportConfig`
 * (which carries closures) is built over there, because functions cannot cross
 * the RSC boundary.
 */
export default async function ItemMovementReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requirePermission("reports", "view");

  const params = await searchParams;
  const filters = readItemFilters(params, DEFAULT_GROUP_BY);

  const [rows, options, attributeDims] = await Promise.all([
    getItemMovement(filters),
    getItemReportFilterOptions(),
    listAttributeDimensions(),
  ]);

  const groupByFields = [
    ...ITEM_DIMENSIONS.filter((d) => d.groupable),
    ...attributeDims,
  ];

  const purchasedQty = rows.reduce((s, r) => s + r.qty_received, 0);
  const purchasedValue = rows.reduce((s, r) => s + r.value_purchased, 0);
  const consumedQty = rows.reduce((s, r) => s + r.qty_issued, 0);
  const consumedValue = rows.reduce((s, r) => s + r.value_consumed, 0);
  const closingValue = rows.reduce((s, r) => s + r.value_closing_balance, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Item Purchase & Consumption"
        description="Ordered, received, consumed and closing stock — sliced by item, class, category or material attribute"
      />

      <ItemReportFilters
        options={options}
        groupByFields={groupByFields}
        current={filterState(filters)}
        basePath="/reports/item-movement"
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Purchased"
          value={fmtNumber(purchasedQty)}
          hint={fmtMoney(purchasedValue)}
        />
        <Stat
          label="Consumed"
          value={fmtNumber(consumedQty)}
          hint={fmtMoney(consumedValue)}
        />
        <Stat
          label="Net movement"
          value={fmtNumber(purchasedQty - consumedQty)}
          tone={purchasedQty - consumedQty < 0 ? "warning" : "neutral"}
        />
        <Stat label="Closing stock value" value={fmtMoney(closingValue)} />
      </div>

      <ItemMovementReport rows={rows} groupBy={filters.groupBy} />
    </div>
  );
}
