import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { getOrders, getLocations } from "@/lib/orders/service";
import {
  getInternalWorkOrders,
  type IwoWithOrder,
} from "@/lib/orders/internal-work-orders/service";
import {
  IWO_STATUS_LABELS,
  iwoStatusTone,
} from "@/lib/orders/internal-work-orders/types";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { NewIwoForm } from "./new-iwo-form";

const columns: Column<IwoWithOrder>[] = [
  {
    header: "Code",
    cell: (row) => (
      <Link
        href={`/orders/internal-work-orders/${row.id}`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {row.code ?? "—"}
      </Link>
    ),
  },
  {
    header: "Order",
    cell: (row) => (
      <span className="font-mono text-xs">
        {row.sales_orders?.order_number ?? "—"}
      </span>
    ),
  },
  {
    header: "Buyer",
    cell: (row) => (
      <span className="text-sm">{row.sales_orders?.buyers?.name ?? "—"}</span>
    ),
  },
  { header: "Title", cell: (row) => <span className="text-sm font-medium">{row.title}</span> },
  {
    header: "Status",
    cell: (row) => (
      <StatusPill tone={iwoStatusTone(row.status)}>
        {IWO_STATUS_LABELS[row.status]}
      </StatusPill>
    ),
  },
  {
    header: "Created",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-xs text-muted-foreground">
        {fmtDate(row.created_at)}
      </span>
    ),
  },
];

export default async function InternalWorkOrdersPage() {
  await requirePermission("orders", "view");

  const [iwos, orders, locations] = await Promise.all([
    getInternalWorkOrders(),
    getOrders(),
    getLocations(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Internal Work Orders"
        description="Internal instructions authorising production for an order"
        actions={
          <Link href="/orders">
            <Button variant="outline" size="sm">
              ← Orders
            </Button>
          </Link>
        }
      />

      <NewIwoForm orders={orders} locations={locations} />

      <DataTable
        columns={columns}
        rows={iwos}
        getKey={(row) => row.id}
        empty="No internal work orders yet. Use 'New work order' above to create the first."
      />
    </div>
  );
}
