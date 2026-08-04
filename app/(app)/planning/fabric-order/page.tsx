import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { listFabricOrders } from "@/lib/planning/material-planning-service";
import { fmtDate, fmtMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { FabricOrderRow } from "@/lib/planning/material-planning-types";
import type { MpStatus } from "@/lib/planning/material-planning-types";
import { withCreatedColumns } from "@/components/ui/created-columns";

const MP_STATUS_LABELS: Record<MpStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function mpStatusTone(status: MpStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "submitted":
      return "warning";
    case "approved":
      return "success";
    case "rejected":
      return "danger";
  }
}

const columns: Column<FabricOrderRow>[] = [
  {
    header: "Code",
    cell: (r) => (
      <Link
        href={`/planning/fabric-order/${r.id}`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {r.code ?? "\u2014"}
      </Link>
    ),
  },
  {
    header: "Customer",
    cell: (r) => <span className="text-sm">{r.customer_name ?? "\u2014"}</span>,
  },
  {
    header: "Order No",
    cell: (r) => <span className="text-sm">{r.order_no ?? "\u2014"}</span>,
  },
  {
    header: "Order Date",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtDate(r.order_date)}</span>
    ),
  },
  {
    header: "Ship Type",
    cell: (r) => <span className="text-sm">{r.ship_type ?? "\u2014"}</span>,
  },
  {
    header: "Gross Value",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtMoney(r.gross_value)}</span>
    ),
  },
  {
    header: "Status",
    cell: (r) => (
      <StatusPill tone={mpStatusTone(r.status)}>
        {MP_STATUS_LABELS[r.status]}
      </StatusPill>
    ),
  },
];

export default async function FabricOrderPage() {
  await requirePermission("planning", "view");

  const [orders, canCreate] = await Promise.all([
    listFabricOrders(),
    can("planning", "create"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Fabric Order"
        description="Fabric purchase orders with style/color/size breakdown."
        actions={
          canCreate ? (
            <Link
              href="/planning/fabric-order/new"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
            >
              New
            </Link>
          ) : undefined
        }
      />

      <DataTable
        columns={withCreatedColumns(columns, orders)}
        rows={orders}
        getKey={(r) => r.id}
        empty="No fabric order records yet."
      />
    </div>
  );
}
