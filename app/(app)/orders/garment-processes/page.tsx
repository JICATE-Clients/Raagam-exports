import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import {
  getAcceptedOrders,
  type AcceptedOrderRow,
} from "@/lib/orders/garment-processes/service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import type { PickerItem } from "@/components/masters/record-picker";
import { GarmentProcessFilter } from "./garment-process-filter";

const columns: Column<AcceptedOrderRow>[] = [
  {
    header: "SC No / Order No",
    cell: (row) => (
      <Link
        href={`/orders/${row.id}/processes`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {row.order_number ?? "—"}
      </Link>
    ),
  },
  {
    header: "Customer",
    cell: (row) => <span className="text-sm">{row.buyers?.name ?? "—"}</span>,
  },
  {
    header: "SC / Order Dt",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-xs text-muted-foreground">
        {fmtDate(row.created_at)}
      </span>
    ),
  },
  {
    header: "Delivery Dt",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-xs text-muted-foreground">
        {row.ship_date ? fmtDate(row.ship_date) : "—"}
      </span>
    ),
  },
  {
    header: "Order Qty",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm">{row.order_qty ?? 0}</span>
    ),
  },
  {
    header: "Processes",
    align: "right",
    cell: (row) => (
      <Link
        href={`/orders/${row.id}/processes`}
        className="inline-flex items-center gap-1 tabular-nums text-sm text-primary hover:underline"
      >
        {row.process_count}
        <span aria-hidden>→</span>
      </Link>
    ),
  },
];

export default async function GarmentProcessesSelectorPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; status?: string }>;
}) {
  await requirePermission("orders", "view");
  const { order, status } = await searchParams;

  const rows = await getAcceptedOrders({ orderId: order, status });

  // The picker lists every accepted order (unfiltered) so you can switch target.
  const pickerSource = order || status ? await getAcceptedOrders() : rows;
  const pickerItems: PickerItem[] = pickerSource.map((o) => ({
    id: o.id,
    code: o.order_number,
    name: o.buyers?.name ?? "—",
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Define Garment Processes for Accepted Orders"
        description="Select an accepted order to define its garment process plan"
        actions={
          <Link href="/orders">
            <Button variant="outline" size="sm">
              ← Garment Orders
            </Button>
          </Link>
        }
      />

      <GarmentProcessFilter
        orders={pickerItems}
        current={{ order: order ?? null, status: status ?? "" }}
      />

      <DataTable
        columns={columns}
        rows={rows}
        getKey={(row) => row.id}
        empty="No accepted orders match. Confirm an order first, or clear the filter."
      />
    </div>
  );
}
