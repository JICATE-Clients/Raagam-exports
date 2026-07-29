import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { fmtNumber } from "@/lib/format";
import { getItemLedger, getItemReportFilterOptions } from "@/lib/reports/item-service";
import { readItemFilters, filterState, type SearchParams } from "@/lib/reports/filters";
import { ItemReportFilters } from "../_components/item-report-filters";
import { ItemLedgerReport } from "./item-ledger-report";

/**
 * Item Movement Ledger — the drill-down behind every summary figure.
 * One row per movement, from every source in the fact model.
 */
export default async function ItemLedgerReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requirePermission("reports", "view");

  const params = await searchParams;
  const filters = readItemFilters(params, "item_name");
  const factKind = Array.isArray(params.factKind) ? params.factKind[0] : params.factKind;

  const [rows, options] = await Promise.all([
    getItemLedger(filters, factKind ?? null),
    getItemReportFilterOptions(),
  ]);

  const posted = rows.filter((r) => r.posts_to_ledger).length;
  const unvalued = rows.filter((r) => r.rate == null).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Item Movement Ledger"
        description="Every movement behind the numbers — one row per transaction, across all sources"
      />

      <ItemReportFilters
        options={options}
        groupByFields={[]}
        current={filterState(filters)}
        basePath="/reports/item-ledger"
        showGroupBy={false}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Movements" value={fmtNumber(rows.length)} />
        <Stat
          label="Posted to stock"
          value={fmtNumber(posted)}
          hint={`${rows.length - posted} document-only (no stock effect)`}
        />
        <Stat
          label="Without a rate"
          value={fmtNumber(unvalued)}
          tone={unvalued > 0 ? "warning" : "success"}
          hint="No PO price, yarn rate or budget rate to value these"
        />
      </div>

      <ItemLedgerReport rows={rows} />
    </div>
  );
}
