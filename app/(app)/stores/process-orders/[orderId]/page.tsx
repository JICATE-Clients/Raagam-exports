import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getProcessOrder } from "@/lib/stores/process-service";
import { ProcessOrderActions } from "./process-order-actions";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { PROC_STATUS_LABELS } from "@/lib/stores/process-types";
import type { ProcStatus, ProcessOrderLine } from "@/lib/stores/process-types";

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

export default async function ProcessOrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await requirePermission("stores", "view");
  const { orderId } = await params;

  const [order, canEdit] = await Promise.all([
    getProcessOrder(orderId),
    can("stores", "edit"),
  ]);
  if (!order) notFound();

  const lineColumns: Column<ProcessOrderLine>[] = [
    {
      header: "Description",
      cell: (r) => <span className="text-sm">{r.description}</span>,
    },
    {
      header: "Sent Qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.sent_qty)}</span>,
    },
    {
      header: "Received Qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.received_qty)}</span>,
    },
    {
      header: "Outstanding",
      align: "right",
      cell: (r) => {
        const bal = Math.max(0, r.sent_qty - r.received_qty);
        return (
          <span className={bal > 0 ? "tabular-nums text-sm text-warning" : "tabular-nums text-sm text-success"}>
            {fmtNumber(bal)}
          </span>
        );
      },
    },
    {
      header: "Rate",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtMoney(r.rate)}</span>,
    },
    {
      header: "Amount",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm font-semibold">{fmtMoney(r.amount)}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={order.code ?? "Process Order"}
        description={`${order.process_type} - ${order.vendor_name ?? "--"}`}
        actions={
          <StatusPill tone={procStatusTone(order.status)}>
            {PROC_STATUS_LABELS[order.status]}
          </StatusPill>
        }
      />

      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Processor</dt>
              <dd className="font-medium">{order.vendor_name ?? "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Process Type</dt>
              <dd className="capitalize">{order.process_type}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Order Date</dt>
              <dd>{order.order_date ? fmtDate(order.order_date) : "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Expected Date</dt>
              <dd>{order.expected_date ? fmtDate(order.expected_date) : "--"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total Amount</dt>
              <dd className="tabular-nums font-semibold">{fmtMoney(order.total_amount, order.currency_code)}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Line Items ({order.lines.length})</CardTitle>
        </CardHeader>
        <CardBody>
          <DataTable
            columns={lineColumns}
            rows={order.lines}
            getKey={(r) => r.id}
            empty="No line items."
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
        <CardBody>
          <ProcessOrderActions orderId={order.id} status={order.status} canEdit={canEdit} />
        </CardBody>
      </Card>
    </div>
  );
}
