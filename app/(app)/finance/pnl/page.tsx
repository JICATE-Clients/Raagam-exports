import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { listShipmentPnl } from "@/lib/finance/pnl-service";
import { money } from "@/lib/finance/calc";
import { fmtMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { ShipmentPnlRow } from "@/lib/finance/pnl-service";
import type { StatusTone } from "@/components/ui/status-pill";

function marginTone(pct: number): StatusTone {
  if (pct < 0) return "danger";
  if (pct < 10) return "warning";
  return "success";
}

const columns: Column<ShipmentPnlRow>[] = [
  {
    header: "Shipment",
    cell: (row) => (
      <Link
        href={`/finance/pnl/${row.shipment.id}`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {row.shipment.code ?? row.shipment.id.slice(0, 8)}
      </Link>
    ),
  },
  {
    header: "Buyer",
    cell: (row) => (
      <span className="text-sm">{row.shipment.buyers?.name ?? "—"}</span>
    ),
  },
  {
    header: "Revenue (INR)",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm">{fmtMoney(row.pnl.revenue)}</span>
    ),
  },
  {
    header: "Total cost (INR)",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm">{fmtMoney(row.pnl.totalCost)}</span>
    ),
  },
  {
    header: "Profit (INR)",
    align: "right",
    cell: (row) => (
      <span
        className={`tabular-nums text-sm font-medium ${
          row.pnl.profit < 0 ? "text-danger" : "text-success"
        }`}
      >
        {fmtMoney(row.pnl.profit)}
      </span>
    ),
  },
  {
    header: "Margin",
    align: "right",
    cell: (row) => (
      <StatusPill tone={marginTone(row.pnl.marginPct)}>
        {row.pnl.marginPct.toFixed(1)}%
      </StatusPill>
    ),
  },
];

export default async function PnlPage() {
  await requirePermission("finance", "view");

  const rows = await listShipmentPnl();

  const totalRevenue = money(rows.reduce((s, r) => s + r.pnl.revenue, 0));
  const totalCost = money(rows.reduce((s, r) => s + r.pnl.totalCost, 0));
  const totalProfit = money(rows.reduce((s, r) => s + r.pnl.profit, 0));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Shipment P&L"
        description="Profitability by shipment — revenue vs. total cost"
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

      <DataTable
        columns={columns}
        rows={rows}
        getKey={(row) => row.shipment.id}
        empty="No shipments found."
      />
    </div>
  );
}
