"use client";

import { fmtMoney } from "@/lib/format";
import { ReportView } from "@/components/reports/report-view";
import type { ReportConfig } from "@/lib/reports/types";
import type { ShipmentPnlRow } from "@/lib/finance/pnl-service";

/**
 * Client wrapper that turns server-fetched P&L rows into a `ReportConfig`.
 * The config carries functions (`value`, chart accessors) so it MUST be built on
 * the client — the server page only passes the serializable `rows` array across.
 */
export function ShipmentPnlReport({ rows }: { rows: ShipmentPnlRow[] }) {
  const config: ReportConfig<ShipmentPnlRow> = {
    title: "Shipment P&L",
    subtitle: "Profitability by shipment — revenue vs. total cost",
    rows,
    columns: [
      {
        key: "shipment",
        header: "Shipment",
        value: (r) => r.shipment.code ?? r.shipment.id.slice(0, 8),
      },
      {
        key: "buyer",
        header: "Buyer",
        value: (r) => r.shipment.buyers?.name ?? "—",
      },
      {
        key: "revenue",
        header: "Revenue (INR)",
        isNumeric: true,
        value: (r) => fmtMoney(r.pnl.revenue),
      },
      {
        key: "totalCost",
        header: "Total cost (INR)",
        isNumeric: true,
        value: (r) => fmtMoney(r.pnl.totalCost),
      },
      {
        key: "profit",
        header: "Profit (INR)",
        isNumeric: true,
        value: (r) => fmtMoney(r.pnl.profit),
      },
      {
        key: "margin",
        header: "Margin %",
        isNumeric: true,
        value: (r) => `${r.pnl.marginPct.toFixed(1)}%`,
      },
    ],
    chart: {
      kind: "bar",
      category: (r) => r.shipment.code ?? r.shipment.id.slice(0, 8),
      series: [
        { key: "revenue", label: "Revenue", value: (r) => r.pnl.revenue },
        { key: "profit", label: "Profit", value: (r) => r.pnl.profit },
      ],
    },
  };

  return (
    <ReportView
      config={config}
      getKey={(r) => r.shipment.id}
      empty="No shipments found."
    />
  );
}
