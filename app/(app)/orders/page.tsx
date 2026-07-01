import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import {
  getOrders,
  getAcceptedQuotes,
  getBuyers,
  getLocations,
} from "@/lib/orders/service";
import { fmtMoney, fmtNumber, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { NewOrderForm } from "./new-order-form";
import type { OrderWithBuyer } from "@/lib/orders/service";
import type { OrderStatus } from "@/lib/orders/types";
import type { StatusTone } from "@/components/ui/status-pill";

function orderStatusTone(status: OrderStatus): StatusTone {
  switch (status) {
    case "confirmed":
      return "info";
    case "in_production":
      return "warning";
    case "shipped":
      return "success";
    case "closed":
      return "neutral";
    case "cancelled":
      return "danger";
  }
}

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  confirmed: "Confirmed",
  in_production: "In Production",
  shipped: "Shipped",
  closed: "Closed",
  cancelled: "Cancelled",
};

const columns: Column<OrderWithBuyer>[] = [
  {
    header: "Order #",
    cell: (row) => (
      <Link
        href={`/orders/${row.id}`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {row.order_number ?? "—"}
      </Link>
    ),
  },
  {
    header: "Buyer",
    cell: (row) => (
      <span className="text-sm">{row.buyers?.name ?? "—"}</span>
    ),
  },
  {
    header: "Qty",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm">{fmtNumber(row.order_qty)}</span>
    ),
  },
  {
    header: "FOB",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm">
        {fmtMoney(row.fob_price, row.currency_code)}
      </span>
    ),
  },
  {
    header: "Ship date",
    cell: (row) => (
      <span className="tabular-nums text-sm">{fmtDate(row.ship_date)}</span>
    ),
  },
  {
    header: "Status",
    cell: (row) => (
      <StatusPill tone={orderStatusTone(row.status)}>
        {ORDER_STATUS_LABELS[row.status]}
      </StatusPill>
    ),
  },
  {
    header: "Ver.",
    align: "center",
    cell: (row) => (
      <span className="text-xs text-muted-foreground">
        v{row.current_version}
      </span>
    ),
  },
];

export default async function OrdersPage() {
  await requirePermission("orders", "view");

  const [orders, quotes, buyers, locations] = await Promise.all([
    getOrders(),
    getAcceptedQuotes(),
    getBuyers(),
    getLocations(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Orders"
        description="Sales order management"
      />

      {/* NewOrderForm manages its own open/close state and renders the "New order"
          button when collapsed, and the full form card when expanded. */}
      <NewOrderForm quotes={quotes} buyers={buyers} locations={locations} />

      <DataTable
        columns={columns}
        rows={orders}
        getKey={(row) => row.id}
        empty="No orders yet. Use 'New order' above to create your first."
      />
    </div>
  );
}
