import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { getOrdersWithBomStatus, type OrderWithBomStatus } from "@/lib/planning/bom-service";
import { fmtNumber, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import type { BomStatus } from "@/lib/planning/types";

function bomTone(status: BomStatus | null | undefined): StatusTone {
  if (!status) return "neutral";
  return status === "final" ? "success" : "warning";
}

function bomLabel(status: BomStatus | null | undefined): string {
  if (!status) return "None";
  return status === "final" ? "Final" : "Draft";
}

export default async function BomsPage() {
  await requirePermission("planning", "view");

  const orders = await getOrdersWithBomStatus();

  const columns: Column<OrderWithBomStatus>[] = [
    {
      header: "Order #",
      cell: (o) => (
        <Link
          href={`/planning/orders/${o.id}`}
          className="font-medium text-primary hover:underline"
        >
          {o.order_number ?? "—"}
        </Link>
      ),
    },
    {
      header: "Buyer",
      cell: (o) => (
        <span className="text-sm text-muted-foreground">
          {o.buyers?.name ?? "—"}
        </span>
      ),
    },
    {
      header: "Order qty",
      align: "right",
      cell: (o) => (
        <span className="tabular-nums text-sm">{fmtNumber(o.order_qty)}</span>
      ),
    },
    {
      header: "Ship date",
      cell: (o) => (
        <span className="tabular-nums text-sm">{fmtDate(o.ship_date)}</span>
      ),
    },
    {
      header: "Fabric BOM",
      cell: (o) => (
        <StatusPill tone={bomTone(o.fabric_bom?.status)}>
          {bomLabel(o.fabric_bom?.status)}
        </StatusPill>
      ),
    },
    {
      header: "Material BOM",
      cell: (o) => (
        <StatusPill tone={bomTone(o.material_bom?.status)}>
          {bomLabel(o.material_bom?.status)}
        </StatusPill>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bill of Materials"
        description="Fabric &amp; Material BOMs per sales order — click an order to open its workspace."
      />
      <DataTable
        columns={columns}
        rows={orders}
        getKey={(o) => o.id}
        empty="No sales orders found. Create an order in the Orders module first."
      />
    </div>
  );
}
