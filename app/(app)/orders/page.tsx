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
import { Card, CardBody } from "@/components/ui/card";
import { NewOrderForm } from "./new-order-form";
import type { OrderWithBuyer } from "@/lib/orders/service";
import type { OrderStatus } from "@/lib/orders/types";
import type { StatusTone } from "@/components/ui/status-pill";

/**
 * The legacy RP-Software "Garment Orders" To-Do panel, reproduced as a workflow
 * hub. Each step links to the screen that performs it. Per-order steps (garment
 * processes, amendments, approvals) point at the orders table below — the user
 * picks an order and works on its detail page.
 */
const WORKFLOW_STEPS: { n: number; label: string; href: string; desc: string }[] =
  [
    { n: 1, label: "Define Colour Cards", href: "/orders/color-cards", desc: "Customer colour / Pantone cards." },
    { n: 2, label: "Style", href: "/orders/styles", desc: "Define garment styles (coordinates, components, sizes)." },
    { n: 3, label: "Create Sale Orders", href: "#all-orders", desc: "Confirm orders from accepted quotes." },
    { n: 4, label: "Prepare Material BOM", href: "/orders/material-bom", desc: "Bill of materials for accepted orders." },
    { n: 5, label: "Define Garment Processes", href: "/orders/garment-processes", desc: "Select an accepted order and define its process plan." },
    { n: 6, label: "Internal Work Order", href: "/orders/internal-work-orders", desc: "Raise internal work orders." },
    { n: 7, label: "Prepare Advised Items", href: "/orders/advised-items", desc: "Select an accepted order and prepare its advised items." },
    { n: 8, label: "Garment Order Amendment", href: "/orders/amendments", desc: "Amend a confirmed order across styles, prices, packing & logistics." },
    { n: 9, label: "Material BOM Amendment", href: "/orders/material-bom-amendment", desc: "Amend an accepted order's material BOM — items, processes & calculated quantities." },
    { n: 10, label: "Garment Process Amendment", href: "/orders/process-amendments", desc: "Amend an order's component / garment process." },
    { n: 11, label: "Approve Amendment", href: "/orders/approve-amendments", desc: "Approve / reject raised amendments." },
    { n: 12, label: "Packing List Advice", href: "/orders/packing-advice", desc: "Prepare packing list advice." },
    { n: 13, label: "Garment Order Cancellation", href: "/orders/cancellations", desc: "Cancel an order with a logged reason." },
    { n: 14, label: "Garment Order Completion", href: "/orders/completions", desc: "Mark an order complete / closed." },
  ];

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
    <div className="space-y-6">
      <PageHeader
        title="Garment Orders"
        description="The garment order workflow — from colour cards through to order completion."
      />

      {/* Workflow hub — reproduces the legacy "To-Do Tasks" panel. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {WORKFLOW_STEPS.map((step) => (
          <Link key={step.n} href={step.href}>
            <Card className="h-full cursor-pointer transition-colors hover:bg-surface-muted">
              <CardBody>
                <div className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {step.n}
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground">{step.label}</div>
                    <p className="mt-0.5 text-sm text-muted-foreground">{step.desc}</p>
                  </div>
                </div>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>

      <div id="all-orders" className="space-y-4 scroll-mt-20">
        <PageHeader title="All Orders" description="Create and track sales orders." />

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
    </div>
  );
}
