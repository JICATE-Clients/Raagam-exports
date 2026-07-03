import { requirePermission } from "@/lib/auth/server";
import { listShipmentPnl } from "@/lib/finance/pnl-service";
import { money } from "@/lib/finance/calc";
import { fmtMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { ShipmentPnlReport } from "./shipment-pnl-report";

export default async function ShipmentPnlReportPage() {
  await requirePermission("reports", "view");

  const rows = await listShipmentPnl();

  const totalRevenue = money(rows.reduce((s, r) => s + r.pnl.revenue, 0));
  const totalCost = money(rows.reduce((s, r) => s + r.pnl.totalCost, 0));
  const totalProfit = money(rows.reduce((s, r) => s + r.pnl.profit, 0));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Shipment P&L"
        description="Profitability by shipment — export to PDF/Excel, print, or chart"
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Total revenue" value={fmtMoney(totalRevenue)} tone="neutral" />
        <Stat label="Total cost" value={fmtMoney(totalCost)} tone="neutral" />
        <Stat
          label="Total profit"
          value={fmtMoney(totalProfit)}
          tone={totalProfit < 0 ? "danger" : "success"}
        />
      </div>

      <ShipmentPnlReport rows={rows} />
    </div>
  );
}
