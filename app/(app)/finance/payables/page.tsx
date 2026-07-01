import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import {
  listPayables,
  getPosForPicker,
  getGrnsForPicker,
  getVendorsForPicker,
} from "@/lib/finance/ap-service";
import { getLocationsForPicker } from "@/lib/finance/gl-service";
import { fmtMoney, fmtDate } from "@/lib/format";
import { payableOutstanding } from "@/lib/finance/calc";
import { summariseAging, AGING_BUCKETS } from "@/lib/finance/calc";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { NewBillForm } from "./new-bill-form";
import type { PayableWithVendor } from "@/lib/finance/ap-service";
import type { PayableStatus, MatchStatus } from "@/lib/finance/types";

function payableStatusTone(s: PayableStatus): StatusTone {
  switch (s) {
    case "draft": return "neutral";
    case "approved": return "info";
    case "partially_paid": return "warning";
    case "paid": return "success";
    case "cancelled": return "neutral";
  }
}

const PAYABLE_STATUS_LABELS: Record<PayableStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  partially_paid: "Partially paid",
  paid: "Paid",
  cancelled: "Cancelled",
};

function matchStatusTone(s: MatchStatus): StatusTone {
  switch (s) {
    case "unmatched": return "neutral";
    case "matched": return "success";
    case "exception": return "danger";
  }
}

const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  unmatched: "Unmatched",
  matched: "Matched",
  exception: "Exception",
};

const columns: Column<PayableWithVendor>[] = [
  {
    header: "Code",
    cell: (r) => (
      <Link
        href={`/finance/payables/${r.id}`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {r.code ?? "—"}
      </Link>
    ),
  },
  {
    header: "Vendor",
    cell: (r) => <span className="text-sm">{r.vendor_name ?? "—"}</span>,
  },
  {
    header: "Bill date",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtDate(r.bill_date)}</span>
    ),
  },
  {
    header: "Due date",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtDate(r.due_date)}</span>
    ),
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
    header: "Paid",
    align: "right",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtMoney(r.paid_amount, r.currency_code)}</span>
    ),
  },
  {
    header: "Outstanding",
    align: "right",
    cell: (r) => {
      const outstanding = payableOutstanding(r);
      return (
        <span
          className={
            outstanding > 0
              ? "tabular-nums text-sm font-semibold text-danger"
              : "tabular-nums text-sm"
          }
        >
          {fmtMoney(outstanding, r.currency_code)}
        </span>
      );
    },
  },
  {
    header: "3-way",
    cell: (r) => (
      <StatusPill tone={matchStatusTone(r.match_status)}>
        {MATCH_STATUS_LABELS[r.match_status]}
      </StatusPill>
    ),
  },
  {
    header: "Status",
    cell: (r) => (
      <StatusPill tone={payableStatusTone(r.status)}>
        {PAYABLE_STATUS_LABELS[r.status]}
      </StatusPill>
    ),
  },
];

const AGING_BUCKET_LABELS: Record<string, string> = {
  current: "Current",
  "1-30": "1–30 days",
  "31-60": "31–60 days",
  "61-90": "61–90 days",
  "90+": "90+ days",
};

const AGING_BUCKET_TONES: Record<string, StatusTone> = {
  current: "info",
  "1-30": "neutral",
  "31-60": "warning",
  "61-90": "danger",
  "90+": "danger",
};

export default async function PayablesPage() {
  await requirePermission("finance", "view");

  const [payables, vendors, pos, grns, locations, canCreate] = await Promise.all([
    listPayables(),
    getVendorsForPicker(),
    getPosForPicker(),
    getGrnsForPicker(),
    getLocationsForPicker(),
    can("finance", "create"),
  ]);

  // Build aging from outstanding bills only
  const agingItems = payables
    .filter((p) => p.status !== "paid" && p.status !== "cancelled")
    .map((p) => ({
      dueDate: p.due_date,
      outstanding: payableOutstanding(p),
    }));
  const aging = summariseAging(agingItems);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Accounts Payable"
        description="Vendor bills, aging, 3-way match."
      />

      {/* Aging stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {AGING_BUCKETS.map((bucket) => (
          <Stat
            key={bucket}
            label={AGING_BUCKET_LABELS[bucket]}
            value={fmtMoney(aging[bucket])}
            tone={aging[bucket] > 0 ? AGING_BUCKET_TONES[bucket] : "neutral"}
          />
        ))}
      </div>

      {canCreate && (
        <NewBillForm vendors={vendors} pos={pos} grns={grns} locations={locations} />
      )}

      <DataTable
        columns={columns}
        rows={payables}
        getKey={(r) => r.id}
        empty="No vendor bills yet. Create one above."
      />
    </div>
  );
}
