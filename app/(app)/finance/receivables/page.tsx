import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import {
  listReceivables,
  getReceivableAging,
  getBuyers,
  getShipmentsForPicker,
  getCurrencies,
} from "@/lib/finance/ar-service";
import { receivableOutstandingFc, AGING_BUCKETS } from "@/lib/finance/calc";
import { fmtMoney, fmtDate, fmtNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { NewReceivableForm } from "./new-receivable-form";
import type { ReceivableWithBuyer } from "@/lib/finance/ar-service";
import type { ReceivableStatus } from "@/lib/finance/types";
import type { AgingBucket } from "@/lib/finance/calc";
import type { StatusTone } from "@/components/ui/status-pill";

function receivableStatusTone(status: ReceivableStatus): StatusTone {
  switch (status) {
    case "open": return "info";
    case "partially_received": return "warning";
    case "received": return "success";
    case "overdue": return "danger";
    case "cancelled": return "neutral";
  }
}

const STATUS_LABELS: Record<ReceivableStatus, string> = {
  open: "Open",
  partially_received: "Partial",
  received: "Received",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  current: "Current",
  "1-30": "1–30 days",
  "31-60": "31–60 days",
  "61-90": "61–90 days",
  "90+": "90+ days",
};

const AGING_TONES: Record<AgingBucket, StatusTone> = {
  current: "success",
  "1-30": "info",
  "31-60": "warning",
  "61-90": "danger",
  "90+": "danger",
};

const columns: Column<ReceivableWithBuyer>[] = [
  {
    header: "Code",
    cell: (row) => (
      <Link
        href={`/finance/receivables/${row.id}`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {row.code ?? "—"}
      </Link>
    ),
  },
  {
    header: "Buyer",
    cell: (row) => <span className="text-sm">{row.buyers?.name ?? "—"}</span>,
  },
  {
    header: "Invoice no.",
    cell: (row) => <span className="font-mono text-xs">{row.invoice_no ?? "—"}</span>,
  },
  {
    header: "Due date",
    cell: (row) => (
      <span className="tabular-nums text-sm">{fmtDate(row.due_date)}</span>
    ),
  },
  {
    header: "Ccy",
    cell: (row) => <span className="text-sm">{row.currency_code ?? "—"}</span>,
  },
  {
    header: "Amount (FC)",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm">{fmtNumber(row.amount_fc)}</span>
    ),
  },
  {
    header: "Rate",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm">{fmtNumber(row.exchange_rate)}</span>
    ),
  },
  {
    header: "Amount (INR)",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm">{fmtMoney(row.amount_inr)}</span>
    ),
  },
  {
    header: "Received (FC)",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm">{fmtNumber(row.received_fc)}</span>
    ),
  },
  {
    header: "Outstanding (FC)",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm font-medium">
        {fmtNumber(receivableOutstandingFc(row))}
      </span>
    ),
  },
  {
    header: "Status",
    cell: (row) => (
      <StatusPill tone={receivableStatusTone(row.status)}>
        {STATUS_LABELS[row.status]}
      </StatusPill>
    ),
  },
];

export default async function ReceivablesPage() {
  await requirePermission("finance", "view");

  const [receivables, aging, buyers, shipments, currencies] = await Promise.all([
    listReceivables(),
    getReceivableAging(),
    getBuyers(),
    getShipmentsForPicker(),
    getCurrencies(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Receivables"
        description="Foreign-currency invoices and aging analysis"
      />

      {/* Aging summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {AGING_BUCKETS.map((bucket) => (
          <Stat
            key={bucket}
            label={AGING_BUCKET_LABELS[bucket]}
            value={fmtMoney(aging[bucket])}
            tone={AGING_TONES[bucket]}
          />
        ))}
      </div>

      <NewReceivableForm
        buyers={buyers}
        shipments={shipments}
        currencies={currencies}
      />

      <DataTable
        columns={columns}
        rows={receivables}
        getKey={(row) => row.id}
        empty="No receivables yet. Create an invoice above."
      />
    </div>
  );
}
