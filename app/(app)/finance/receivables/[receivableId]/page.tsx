import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getReceivable } from "@/lib/finance/ar-service";
import { receivableOutstandingFc } from "@/lib/finance/calc";
import { fmtMoney, fmtDate, fmtNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RecordReceiptForm } from "./record-receipt-form";
import type { ReceivableStatus, ReceivableReceipt } from "@/lib/finance/types";
import type { StatusTone } from "@/components/ui/status-pill";

function statusTone(s: ReceivableStatus): StatusTone {
  switch (s) {
    case "open": return "info";
    case "partially_received": return "warning";
    case "received": return "success";
    case "overdue": return "danger";
    case "cancelled": return "neutral";
  }
}

const STATUS_LABELS: Record<ReceivableStatus, string> = {
  open: "Open",
  partially_received: "Partially received",
  received: "Received",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

const receiptColumns: Column<ReceivableReceipt>[] = [
  {
    header: "Date",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtDate(r.receipt_date)}</span>
    ),
  },
  {
    header: "Amount (FC)",
    align: "right",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtNumber(r.amount_fc)}</span>
    ),
  },
  {
    header: "Rate",
    align: "right",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtNumber(r.exchange_rate)}</span>
    ),
  },
  {
    header: "Amount (INR)",
    align: "right",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtMoney(r.amount_inr)}</span>
    ),
  },
  {
    header: "Reference",
    cell: (r) => <span className="text-sm">{r.reference ?? "—"}</span>,
  },
];

export default async function ReceivableDetailPage({
  params,
}: {
  params: Promise<{ receivableId: string }>;
}) {
  await requirePermission("finance", "view");
  const { receivableId } = await params;

  const [receivable, canEdit] = await Promise.all([
    getReceivable(receivableId),
    can("finance", "edit"),
  ]);

  if (!receivable) notFound();

  const outstandingFc = receivableOutstandingFc(receivable);
  const receipts = [...(receivable.receivable_receipts ?? [])].sort(
    (a, b) =>
      new Date(b.receipt_date).getTime() - new Date(a.receipt_date).getTime(),
  );

  const canReceive =
    canEdit &&
    receivable.status !== "received" &&
    receivable.status !== "cancelled";

  return (
    <div className="space-y-4">
      <PageHeader
        title={receivable.code ?? "Receivable"}
        description={receivable.buyers?.name ?? undefined}
        actions={
          <StatusPill tone={statusTone(receivable.status)}>
            {STATUS_LABELS[receivable.status]}
          </StatusPill>
        }
      />

      {/* Summary card */}
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Buyer</dt>
              <dd className="font-medium">{receivable.buyers?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Shipment</dt>
              <dd className="font-medium">{receivable.shipments?.code ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Invoice no.</dt>
              <dd className="font-mono font-medium">{receivable.invoice_no ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Invoice date</dt>
              <dd className="tabular-nums font-medium">
                {fmtDate(receivable.invoice_date)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Due date</dt>
              <dd className="tabular-nums font-medium">
                {fmtDate(receivable.due_date)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Currency</dt>
              <dd className="font-medium">{receivable.currency_code ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Amount (FC)</dt>
              <dd className="tabular-nums font-medium">
                {fmtNumber(receivable.amount_fc)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Exchange rate</dt>
              <dd className="tabular-nums font-medium">
                {fmtNumber(receivable.exchange_rate)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Amount (INR)</dt>
              <dd className="tabular-nums font-medium">
                {fmtMoney(receivable.amount_inr)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Received (FC)</dt>
              <dd className="tabular-nums font-medium">
                {fmtNumber(receivable.received_fc)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Outstanding (FC)</dt>
              <dd className="tabular-nums font-semibold text-warning">
                {fmtNumber(outstandingFc)}
              </dd>
            </div>
            {receivable.notes && (
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-xs text-muted-foreground">Notes</dt>
                <dd className="font-medium">{receivable.notes}</dd>
              </div>
            )}
          </dl>
        </CardBody>
      </Card>

      {/* Record receipt (only when outstanding) */}
      {canReceive && (
        <RecordReceiptForm
          receivableId={receivableId}
          currencyCode={receivable.currency_code ?? "GBP"}
          outstandingFc={outstandingFc}
        />
      )}

      {/* Receipt history */}
      <Card>
        <CardHeader>
          <CardTitle>Receipts ({receipts.length})</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          <DataTable
            columns={receiptColumns}
            rows={receipts}
            getKey={(r) => r.id}
            empty="No receipts recorded yet."
          />
        </CardBody>
      </Card>
    </div>
  );
}
