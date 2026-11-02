import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { StockStatementView } from "@/components/reports/stock-statement-view";
import { pendingQcCount, stockStatementValue } from "@/lib/reports/stock-statement-service";
import { readAsOf, currentUnitName } from "@/lib/reports/stock-statement-page";

/**
 * Reports ▸ Stock Statement with Value — the Stock Statement plus qty × the approved PO
 * rate of the GRN each layer came in on (client brief 2026-11-02). A screen of its own so
 * the permission tree can give a role the quantities without the money; the database
 * checks the same screen grant before it returns a single rate.
 */
export default async function StockStatementValuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("reports", "view");
  const asOf = readAsOf(await searchParams);
  const [rows, pendingQc, unit] = await Promise.all([stockStatementValue(asOf), pendingQcCount(), currentUnitName()]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock Statement with Value"
        description="Stock on hand valued at the approved PO rate — yarn, fabric and total inventory value"
      />
      <StockStatementView
        title="Stock Statement with Value"
        rows={rows}
        asOf={asOf}
        unit={unit}
        pendingQc={pendingQc}
        withValue
      />
    </div>
  );
}
