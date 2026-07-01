import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { listRfqs, getBudgetsForPicker } from "@/lib/purchase/po-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { NewRfqForm } from "./new-rfq-form";
import type { Rfq, RfqStatus } from "@/lib/purchase/types";

function rfqStatusTone(status: RfqStatus): StatusTone {
  switch (status) {
    case "open":
      return "info";
    case "closed":
      return "neutral";
    case "awarded":
      return "success";
  }
}

const RFQ_STATUS_LABELS: Record<RfqStatus, string> = {
  open: "Open",
  closed: "Closed",
  awarded: "Awarded",
};

const columns: Column<Rfq>[] = [
  {
    header: "Code",
    cell: (r) => (
      <Link
        href={`/purchase/rfq/${r.id}`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {r.code ?? "—"}
      </Link>
    ),
  },
  {
    header: "Title",
    cell: (r) => <span className="text-sm">{r.title}</span>,
  },
  {
    header: "Status",
    cell: (r) => (
      <StatusPill tone={rfqStatusTone(r.status)}>
        {RFQ_STATUS_LABELS[r.status]}
      </StatusPill>
    ),
  },
  {
    header: "Created",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtDate(r.created_at)}</span>
    ),
  },
];

export default async function RfqPage() {
  await requirePermission("materials_purchase", "view");

  const [rfqs, budgets, canCreate] = await Promise.all([
    listRfqs(),
    getBudgetsForPicker(),
    can("materials_purchase", "create"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="RFQ"
        description="Request quotations from vendors and award."
      />

      {canCreate && <NewRfqForm budgets={budgets} />}

      <DataTable
        columns={columns}
        rows={rfqs}
        getKey={(r) => r.id}
        empty="No RFQs yet. Create one above."
      />
    </div>
  );
}
