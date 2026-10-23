import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import Link from "next/link";
import { getProcessOrder } from "@/lib/stores/process-service";
import { createClient } from "@/lib/supabase/server";
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
import { statusTone } from "@/lib/ui/status-tone";

const PROC_STATUS_TONE_OVERRIDES = {
  in_process: "warning", // this module's own word — not in the shared table
} as const;

function procStatusTone(status: ProcStatus): StatusTone {
  return statusTone(status, PROC_STATUS_TONE_OVERRIDES);
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

  /* 0609 — the order this job-work is for, by its RE No. A failed read shows
     the dash, never a uuid (the creatorName rule, one field along). */
  let reNo: string | null = null;
  if (order.sales_order_id) {
    const sb = await createClient();
    const { data } = await sb.from("sales_orders").select("order_number").eq("id", order.sales_order_id).maybeSingle();
    reNo = (data as { order_number: string | null } | null)?.order_number ?? null;
  }

  /* 0708 — the work order (an SWO's sample IW) a dyeing order was raised
     from, by its number. */
  let iwoCode: string | null = null;
  if (order.iwo_id) {
    const sb = await createClient();
    const { data } = await sb.from("internal_work_orders").select("code").eq("id", order.iwo_id).maybeSingle();
    iwoCode = (data as { code: string | null } | null)?.code ?? null;
  }
  /* BOTH WEIGHTS (client decision 2026-10-12): when a line states what comes
     back, Sent is the GREIGE issued — what the dye house processes and
     invoices — and Return is the FINISHED weight stores checks on receipt. */
  const hasReturn = order.lines.some((l) => l.return_qty != null);

  const lineColumns: Column<ProcessOrderLine>[] = [
    {
      header: "Description",
      cell: (r) => <span className="text-sm">{r.description}</span>,
    },
    {
      header: hasReturn ? "Issue Qty (greige)" : "Sent Qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.sent_qty)}</span>,
    },
    ...(hasReturn
      ? [
          {
            header: "Return Qty (finished)",
            align: "right" as const,
            cell: (r: ProcessOrderLine) => (
              <span className="tabular-nums text-sm">{r.return_qty != null ? fmtNumber(r.return_qty) : "—"}</span>
            ),
          },
        ]
      : []),
    {
      header: "Received Qty",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.received_qty)}</span>,
    },
    {
      header: "Outstanding",
      align: "right",
      cell: (r) => {
        // Against what comes BACK when the line says (0708: finished, not greige).
        const bal = Math.max(0, (r.return_qty ?? r.sent_qty) - r.received_qty);
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
              <dt className="text-xs text-muted-foreground">Order (RE No)</dt>
              <dd>
                {order.sales_order_id ? (
                  <Link href="/orders/fabric-bom" className="text-primary hover:underline" title="Its steps are on the T&A tab of this order's Fabric Plan">
                    {reNo ?? "—"}
                  </Link>
                ) : (
                  "--"
                )}
              </dd>
            </div>
            {order.iwo_id ? (
              <div>
                <dt className="text-xs text-muted-foreground">Work Order</dt>
                <dd>
                  <Link href={`/sales/sample-fabric-plan?open=${order.iwo_id}`} className="text-primary hover:underline">
                    {iwoCode ?? "—"}
                  </Link>
                </dd>
              </div>
            ) : null}
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
          <DataTable paginate={false}
            columns={lineColumns}
            rows={order.lines}
            getKey={(r) => r.id}
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
