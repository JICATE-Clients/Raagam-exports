import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import {
  getCancellations,
  getCancellableOrders,
  getBuyerOptions,
  type CancellationRow,
} from "@/lib/orders/cancellations/service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { NewCancellationForm } from "./new-cancellation-form";

const columns: Column<CancellationRow>[] = [
  {
    header: "Cancel No",
    cell: (row) => (
      <span className="font-mono text-xs font-medium text-primary">
        {row.code ?? "—"}
      </span>
    ),
  },
  {
    header: "SC No",
    cell: (row) => (
      <span className="font-mono text-xs">
        {row.sales_orders?.order_number ?? "—"}
      </span>
    ),
  },
  {
    header: "Customer",
    cell: (row) => (
      <span className="text-sm">{row.sales_orders?.buyers?.name ?? "—"}</span>
    ),
  },
  {
    header: "Order No",
    cell: (row) => <span className="text-sm">{row.order_no ?? "—"}</span>,
  },
  {
    header: "Date",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-xs text-muted-foreground">
        {fmtDate(row.cancelled_date)}
      </span>
    ),
  },
  {
    header: "Remarks",
    cell: (row) => (
      <span className="block max-w-[16rem] truncate text-sm text-muted-foreground" title={row.remarks ?? undefined}>
        {row.remarks ?? "—"}
      </span>
    ),
  },
];

export default async function OrderCancellationsPage() {
  await requirePermission("orders", "view");

  const [cancellations, orders, buyers] = await Promise.all([
    getCancellations(),
    getCancellableOrders(),
    getBuyerOptions(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Garment Order Cancellation"
        description="Cancel a confirmed order — pick the SC No, and the order's status is flipped to Cancelled."
        actions={
          <Link href="/orders">
            <Button variant="outline" size="sm">
              ← Garment Orders
            </Button>
          </Link>
        }
      />

      <NewCancellationForm orders={orders} buyers={buyers} />

      <DataTable
        columns={columns}
        rows={cancellations}
        getKey={(row) => row.id}
        empty="No cancellations yet."
      />
    </div>
  );
}
