import { requirePermission, can } from "@/lib/auth/server";
import { listProcessOrders } from "@/lib/stores/process-service";
import { getVendorsForPicker, getLocations, getItems, getUoms } from "@/lib/purchase/po-service";
import { NewProcessOrderForm } from "./new-process-order-form";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { fmtDate, fmtMoney } from "@/lib/format";
import { PROC_STATUS_LABELS } from "@/lib/stores/process-types";
import type { ProcStatus } from "@/lib/stores/process-types";
import type { ProcWithVendor } from "@/lib/stores/process-service";
import Link from "next/link";
import { withCreatedColumns } from "@/components/ui/created-columns";

function procStatusTone(status: ProcStatus): StatusTone {
  switch (status) {
    case "draft": return "neutral";
    case "issued": return "info";
    case "in_process": return "warning";
    case "partially_received": return "warning";
    case "received": return "success";
    case "closed": return "neutral";
    case "cancelled": return "danger";
  }
}

export default async function ProcessOrdersPage() {
  await requirePermission("stores", "view");
  const [orders, vendors, items, uoms, locations, canCreate] = await Promise.all([
    listProcessOrders(),
    getVendorsForPicker(),
    getItems(),
    getUoms(),
    getLocations(),
    can("stores", "create"),
  ]);

  const columns: Column<ProcWithVendor>[] = [
    {
      header: "Code",
      cell: (r) => (
        <Link
          href={`/stores/process-orders/${r.id}`}
          className="font-medium text-primary hover:underline"
        >
          {r.code ?? "--"}
        </Link>
      ),
    },
    {
      header: "Process",
      cell: (r) => <span className="text-sm capitalize">{r.process_type}</span>,
    },
    {
      header: "Processor",
      cell: (r) => <span className="text-sm">{r.vendor_name ?? "--"}</span>,
    },
    {
      header: "Order Date",
      cell: (r) => <span className="text-sm">{r.order_date ? fmtDate(r.order_date) : "--"}</span>,
    },
    {
      header: "Total",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm font-semibold">
          {fmtMoney(r.total_amount, r.currency_code)}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={procStatusTone(r.status)}>
          {PROC_STATUS_LABELS[r.status]}
        </StatusPill>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Process Orders"
        description="Send materials to external processors (dyeing, printing, knitting, etc.)"
        actions={canCreate ? <NewProcessOrderForm vendors={vendors} items={items} uoms={uoms} locations={locations} /> : undefined}
      />

      <DataTable
        columns={withCreatedColumns(columns, orders)}
        rows={orders}
        getKey={(r) => r.id}
        empty="No process orders yet."
      />
    </div>
  );
}
