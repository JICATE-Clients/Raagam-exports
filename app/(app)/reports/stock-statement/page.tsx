import { requirePermission } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { StockStatementView } from "@/components/reports/stock-statement-view";
import { pendingQcCount, stockStatement } from "@/lib/reports/stock-statement-service";
import { readAsOf, currentUnitName } from "@/lib/reports/stock-statement-page";

/**
 * Reports ▸ Stock Statement — physical stock only, no price anywhere (client brief
 * 2026-11-02). The RPC behind it has no rate column, so nothing to hide on the client.
 */
export default async function StockStatementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("reports", "view");
  const asOf = readAsOf(await searchParams);
  const [rows, pendingQc, unit] = await Promise.all([stockStatement(asOf), pendingQcCount(), currentUnitName()]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock Statement"
        description="Stock on hand per store, bin, GRN and lot — accepted, rejected and replacement, with its age"
      />
      <StockStatementView title="Stock Statement" rows={rows} asOf={asOf} unit={unit} pendingQc={pendingQc} />
    </div>
  );
}
