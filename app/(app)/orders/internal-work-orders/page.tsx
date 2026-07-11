import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import {
  getInternalWorkOrders,
  getIwoFormData,
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
    header: "I.WO No",
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
    header: "Type",
    cell: (row) => (
      <span className="text-sm text-muted-foreground">{row.iwo_type ?? "—"}</span>
    ),
  },
  {
    header: "Customer",
    cell: (row) => <span className="text-sm">{row.customer?.name ?? "—"}</span>,
  },
  {
    header: "Style",
    cell: (row) => (
      <span className="text-sm text-muted-foreground">
        {row.style?.style_name ?? "—"}
      </span>
    ),
  },
  {
    header: "Deli Dt",
    cell: (row) => (
      <span className="tabular-nums text-xs">{fmtDate(row.deli_date)}</span>
    ),
  },
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

  const [iwos, formData] = await Promise.all([
    getInternalWorkOrders(),
    getIwoFormData(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Internal Work Order"
        description="Trial / internal work orders — order-related or non-order-related."
        actions={
          <Link href="/orders">
            <Button variant="outline" size="sm">
              ← Orders
            </Button>
          </Link>
        }
      />

      <NewIwoForm
        customers={formData.customers}
        employees={formData.employees}
        styles={formData.styles}
        itemClasses={formData.itemClasses}
      />

      <DataTable
        columns={columns}
        rows={iwos}
        getKey={(row) => row.id}
        empty="No internal work orders yet. Use 'New work order' above to create the first."
      />
    </div>
  );
}
