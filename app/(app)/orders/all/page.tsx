import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import {
  getOrders,
  getAcceptedQuotes,
  getBuyers,
  getLocations,
} from "@/lib/orders/service";
import { fmtMoney, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { NewOrderForm } from "../new-order-form";
import type { OrderWithBuyer } from "@/lib/orders/service";
import type { OrderStatus } from "@/lib/orders/types";
import type { StatusTone } from "@/components/ui/status-pill";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
// THE ALL ORDERS REGISTER — every confirmed order, with its SC No and status.
//
// It lived at `/orders` until 2026-08-13, where it was the module root and this
// screen at once. The module root is now an index of the seven Orders
// sub-modules (`components/shell/module-hub.tsx`), because clicking a module
// has to show what is in it — only `/masters` did that, and every other module
// root hand-wrote a grid of leaf screens instead.
//
// It is titled "All Orders" here, matching the label its registry entry has
// carried all along. As "Garment Orders" it collided with the Garment Order
// ENTRY screen, and the two are different things: this lists `sales_orders`,
// that one raises them.
//
// The route moved, so `revalidatePath` had to follow it — see the three call
// sites in lib/orders/actions.ts, lib/orders/amendments/actions.ts and
// lib/orders/approve-amendments/actions.ts, which revalidate BOTH paths.

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

/**
 * QTY AND VER. WERE WITHDRAWN from this list (client 2026-08-11).
 *
 * Display only — `sales_orders.order_qty` and `current_version` are untouched,
 * still selected by `getOrders`, and still read elsewhere: `order_qty` is what
 * seeds an amendment, and the version drives the revision history. Dropping a
 * COLUMN from a list is not the same withdrawal as dropping a FIELD from a form,
 * where the field must also leave the Zod input or every save writes null over
 * it (0392). There is nothing to guard here — a list writes nothing.
 *
 * Created Date / Created User are NOT in this array: `withCreatedColumns`
 * splices them on at the end, which is what keeps their wording and order the
 * same on every listing in the app.
 */
const columns: Column<OrderWithBuyer>[] = [
  {
    header: "SC No",
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
  /* View + Edit, the Master Data cluster. Edit is a LINK because this page is a
     SERVER component: an `onEdit` closure cannot cross the RSC boundary, a href can.
     Delete is deliberately absent — no delete action exists for this record, and an
     order is retired through Order Closure, not removed. */
  rowActionsColumn((row) => (
    <RowActions label={row.order_number} editHref={`/orders/${row.id}`} />
  )),
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
        title="All Orders"
        description="Confirmed customer orders — create and track from an accepted quote."
      />

      {/* NewOrderForm manages its own open/close state and renders the "New order"
          button when collapsed, and the full form card when expanded. */}
      <NewOrderForm quotes={quotes} buyers={buyers} locations={locations} />

      <DataTable
        columns={withCreatedColumns(columns, orders)}
        rows={orders}
        getKey={(row) => row.id}
        empty="No orders yet. Use 'New order' above to create your first."
      />
    </div>
  );
}
