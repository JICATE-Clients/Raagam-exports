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
import { NewOrderForm } from "./new-order-form";
import type { OrderWithBuyer } from "@/lib/orders/service";
import type { OrderStatus } from "@/lib/orders/types";
import type { StatusTone } from "@/components/ui/status-pill";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
// This page is the module root AND the All Orders screen — no card grid.
//
// It used to open with the legacy RP-Software 14-step "To-Do" panel, which was
// a second hand-written list of the same screens the sidebar registry already
// declares (lib/nav/module-groups.ts) — and step 4 pointed at
// `/orders/material-bom`, a route that has never existed; the real one is
// `/planning/material-bom`, a leaf of Planning ▸ Bill of Materials. The seven
// Orders sub-modules now carry every one of those screens, so the panel was two
// clicks of indirection in front of the table an operator came here for.

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
        title="Garment Orders"
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
