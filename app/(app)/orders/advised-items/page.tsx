import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { getBuyers } from "@/lib/orders/service";
import {
  getAcceptedOrdersWithAdvisedCount,
  type AdvisedOrderRow,
} from "@/lib/orders/advised-items/service";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import type { PickerItem } from "@/components/masters/record-picker";
import { AdvisedItemsFilter } from "./advised-items-filter";

const columns: Column<AdvisedOrderRow>[] = [
  {
    header: "SC No / Order No",
    cell: (row) => (
      <Link
        href={`/orders/advised-items/${row.id}`}
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
    header: "Country",
    cell: (row) => (
      <span className="text-sm text-muted-foreground">
        {row.buyers?.country ?? "—"}
      </span>
    ),
  },
  {
    header: "Items",
    align: "right",
    cell: (row) => (
      <Link
        href={`/orders/advised-items/${row.id}`}
        className="inline-flex items-center gap-1 tabular-nums text-sm text-primary hover:underline"
      >
        {row.item_count}
        <span aria-hidden>→</span>
      </Link>
    ),
  },
];

export default async function AdvisedItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string; order?: string }>;
}) {
  await requirePermission("orders", "view");
  const { customer, order } = await searchParams;

  const [rows, buyers] = await Promise.all([
    getAcceptedOrdersWithAdvisedCount({ buyerId: customer, orderId: order }),
    getBuyers(),
  ]);

  // The order picker lists every accepted order (unfiltered) so you can switch target.
  const orderSource =
    customer || order ? await getAcceptedOrdersWithAdvisedCount() : rows;

  const customerItems: PickerItem[] = buyers.map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
  }));
  const orderItems: PickerItem[] = orderSource.map((o) => ({
    id: o.id,
    code: o.order_number,
    name: o.buyers?.name ?? "—",
  }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Prepare Advised Items"
        description="Select an accepted order to prepare its advised items"
        actions={
          <Link href="/orders">
            <Button variant="outline" size="sm">
              ← Garment Orders
            </Button>
          </Link>
        }
      />

      <AdvisedItemsFilter
        customers={customerItems}
        orders={orderItems}
        current={{ customer: customer ?? null, order: order ?? null }}
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
