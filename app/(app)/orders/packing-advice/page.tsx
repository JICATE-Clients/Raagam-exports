import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { getOrders } from "@/lib/orders/service";
import {
  getPackingAdvices,
  type PackingAdviceWithOrder,
} from "@/lib/orders/packing-advice/service";
import {
  PLA_STATUS_LABELS,
  plaStatusTone,
} from "@/lib/orders/packing-advice/types";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { NewPackingAdviceForm } from "./new-packing-advice-form";

const columns: Column<PackingAdviceWithOrder>[] = [
  {
    header: "Code",
    cell: (row) => (
      <Link
        href={`/orders/packing-advice/${row.id}`}
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
  {
    header: "Pack method",
    cell: (row) => (
      <span className="text-sm capitalize">{row.pack_method}</span>
    ),
  },
  {
    header: "Status",
    cell: (row) => (
      <StatusPill tone={plaStatusTone(row.status)}>
        {PLA_STATUS_LABELS[row.status]}
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

export default async function PackingAdvicePage() {
  await requirePermission("orders", "view");

  const [advices, orders] = await Promise.all([
    getPackingAdvices(),
    getOrders(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Packing List Advice"
        description="How each order is to be packed — method & carton assortment"
        actions={
          <Link href="/orders">
            <Button variant="outline" size="sm">
              ← Orders
            </Button>
          </Link>
        }
      />

      <NewPackingAdviceForm orders={orders} />

      <DataTable
        columns={columns}
        rows={advices}
        getKey={(row) => row.id}
        empty="No packing advices yet. Use 'New packing advice' above to create the first."
      />
    </div>
  );
}
