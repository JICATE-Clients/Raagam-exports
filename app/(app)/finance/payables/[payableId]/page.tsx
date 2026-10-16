import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getPayable } from "@/lib/finance/ap-service";
import { fmtMoney, fmtDate } from "@/lib/format";
import { payableOutstanding } from "@/lib/finance/calc";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { ApproveButton, RecordPaymentForm } from "./payable-actions";
import type { PayableStatus, MatchStatus, PayablePayment } from "@/lib/finance/types";
import { statusTone } from "@/lib/ui/status-tone";

const PAYABLE_STATUS_TONE_OVERRIDES = {
  // Approved is a step in this document's life, not its end — work still follows it (was info before the shared table, kept).
  approved: "info",
} as const;

function payableStatusTone(s: PayableStatus): StatusTone {
  return statusTone(s, PAYABLE_STATUS_TONE_OVERRIDES);
}

const PAYABLE_STATUS_LABELS: Record<PayableStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  partially_paid: "Partially paid",
  paid: "Paid",
  cancelled: "Cancelled",
};

const MATCH_STATUS_TONE_OVERRIDES = {
  unmatched: "neutral", // this module's own word — not in the shared table
  matched: "success", // this module's own word — not in the shared table
  exception: "danger", // this module's own word — not in the shared table
} as const;

function matchStatusTone(s: MatchStatus): StatusTone {
  return statusTone(s, MATCH_STATUS_TONE_OVERRIDES);
}

const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  unmatched: "Unmatched",
  matched: "3-way Matched",
  exception: "Match Exception",
};

const paymentColumns: Column<PayablePayment>[] = [
  {
    header: "Date",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtDate(r.payment_date)}</span>
    ),
  },
  {
    header: "Amount",
    align: "right",
    cell: (r) => (
      <span className="tabular-nums text-sm font-semibold">{fmtMoney(r.amount)}</span>
    ),
  },
  {
    header: "Method",
    cell: (r) => (
      <span className="text-sm text-muted-foreground">
        {r.method?.replace("_", " ") ?? "—"}
      </span>
    ),
  },
  {
    header: "Reference",
    cell: (r) => (
      <span className="text-sm text-muted-foreground">{r.reference ?? "—"}</span>
    ),
  },
];

export default async function PayableDetailPage({
  params,
}: {
  params: Promise<{ payableId: string }>;
}) {
  await requirePermission("finance", "view");
  const { payableId } = await params;

  const [payable, canEdit] = await Promise.all([
    getPayable(payableId),
    can("finance", "edit"),
  ]);

  if (!payable) notFound();

  const outstanding = payableOutstanding(payable);
  const showApprove = payable.status === "draft" && canEdit;
  const showPayment =
    (payable.status === "approved" || payable.status === "partially_paid") &&
    canEdit &&
    outstanding > 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title={payable.code ?? "Vendor Bill"}
        description={[
          payable.vendor_name,
          payable.bill_no ? `Bill# ${payable.bill_no}` : null,
          fmtDate(payable.bill_date),
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone={matchStatusTone(payable.match_status)}>
              {MATCH_STATUS_LABELS[payable.match_status]}
            </StatusPill>
            <StatusPill tone={payableStatusTone(payable.status)}>
              {PAYABLE_STATUS_LABELS[payable.status]}
            </StatusPill>
            {showApprove && <ApproveButton payableId={payable.id} />}
          </div>
        }
      />

      {/* Bill summary */}
      <Card>
        <CardHeader>
          <CardTitle>Bill Details</CardTitle>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Vendor</dt>
              <dd className="font-medium">{payable.vendor_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Bill No.</dt>
              <dd>{payable.bill_no ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Bill date</dt>
              <dd className="tabular-nums">{fmtDate(payable.bill_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Due date</dt>
              <dd className="tabular-nums">{fmtDate(payable.due_date)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Amount</dt>
              <dd className="tabular-nums">{fmtMoney(payable.amount, payable.currency_code)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Tax</dt>
              <dd className="tabular-nums">{fmtMoney(payable.tax_amount, payable.currency_code)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total</dt>
              <dd className="tabular-nums font-semibold">
                {fmtMoney(payable.total_amount, payable.currency_code)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Paid</dt>
              <dd className="tabular-nums text-success">
                {fmtMoney(payable.paid_amount, payable.currency_code)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Outstanding</dt>
              <dd
                className={
                  outstanding > 0
                    ? "tabular-nums font-semibold text-danger"
                    : "tabular-nums"
                }
              >
                {fmtMoney(outstanding, payable.currency_code)}
              </dd>
            </div>
            {payable.notes && (
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-xs text-muted-foreground">Notes</dt>
                <dd className="text-muted-foreground">{payable.notes}</dd>
              </div>
            )}
          </dl>
        </CardBody>
      </Card>

      {/* Payment form */}
      {showPayment && (
        <RecordPaymentForm payableId={payable.id} outstanding={outstanding} />
      )}

      {/* Payments list */}
      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          <DataTable paginate={false}
            columns={paymentColumns}
            rows={payable.payments}
            getKey={(r) => r.id}
            empty="No payments recorded yet."
          />
        </CardBody>
      </Card>
    </div>
  );
}
