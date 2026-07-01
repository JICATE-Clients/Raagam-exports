import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import {
  listShipments,
  getBuyers,
  getCurrencies,
  getOrdersForPicker,
} from "@/lib/logistics/service";
import { fmtMoney, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { NewShipmentForm } from "./new-shipment-form";
import {
  SHIPMENT_STATUS_LABELS,
  type ShipmentStatus,
} from "@/lib/logistics/types";
import type { ShipmentWithBuyer } from "@/lib/logistics/service";
import type { StatusTone } from "@/components/ui/status-pill";

function shipmentStatusTone(status: ShipmentStatus): StatusTone {
  switch (status) {
    case "planning":
      return "neutral";
    case "docs_ready":
      return "info";
    case "shipped":
      return "warning";
    case "delivered":
      return "success";
    case "closed":
      return "neutral";
  }
}

const columns: Column<ShipmentWithBuyer>[] = [
  {
    header: "Code",
    cell: (row) => (
      <Link
        href={`/logistics/${row.id}`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {row.code ?? "—"}
      </Link>
    ),
  },
  {
    header: "Buyer",
    cell: (row) => <span className="text-sm">{row.buyers?.name ?? "—"}</span>,
  },
  {
    header: "Destination",
    cell: (row) => (
      <span className="text-sm">
        {[row.destination_country, row.destination_port]
          .filter(Boolean)
          .join(" / ") || "—"}
      </span>
    ),
  },
  {
    header: "ETD",
    cell: (row) => (
      <span className="tabular-nums text-sm">{fmtDate(row.etd)}</span>
    ),
  },
  {
    header: "Total value",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm">
        {fmtMoney(row.total_value, row.currency_code)}
      </span>
    ),
  },
  {
    header: "Status",
    cell: (row) => (
      <StatusPill tone={shipmentStatusTone(row.status)}>
        {SHIPMENT_STATUS_LABELS[row.status]}
      </StatusPill>
    ),
  },
];

export default async function LogisticsPage() {
  await requirePermission("logistics", "view");

  const [shipments, buyers, currencies, orders] = await Promise.all([
    listShipments(),
    getBuyers(),
    getCurrencies(),
    getOrdersForPicker(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Logistics & Export"
        description="Shipment register and export documentation"
      />

      <NewShipmentForm buyers={buyers} currencies={currencies} orders={orders} />

      <DataTable
        columns={columns}
        rows={shipments}
        getKey={(row) => row.id}
        empty="No shipments yet. Use 'New shipment' above to create the first."
      />
    </div>
  );
}
