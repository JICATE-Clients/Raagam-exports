import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { listBomTransfers } from "@/lib/planning/bom-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { BomTransferRow } from "@/lib/planning/bom-service";

type TransferStatus = "draft" | "submitted" | "approved";

const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
};

function transferStatusTone(status: TransferStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "submitted":
      return "warning";
    case "approved":
      return "success";
  }
}

const columns: Column<BomTransferRow>[] = [
  {
    header: "Code",
    cell: (r) => (
      <Link
        href={`/planning/bom-transfer/${r.id}`}
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
    header: "From",
    cell: (r) => <span className="text-sm">{r.transfer_from ?? "\u2014"}</span>,
  },
  {
    header: "To",
    cell: (r) => <span className="text-sm">{r.transfer_to ?? "\u2014"}</span>,
  },
  {
    header: "Status",
    cell: (r) => (
      <StatusPill tone={transferStatusTone(r.status)}>
        {TRANSFER_STATUS_LABELS[r.status]}
      </StatusPill>
    ),
  },
  {
    header: "Date",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtDate(r.created_at)}</span>
    ),
  },
];

export default async function BomTransferPage() {
  await requirePermission("planning", "view");

  const [transfers, canCreate] = await Promise.all([
    listBomTransfers(),
    can("planning", "create"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="BOM Transfer"
        description="Transfer BOM materials between orders / groups."
        actions={
          canCreate ? (
            <Link
              href="/planning/bom-transfer/new"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
            >
              New
            </Link>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        rows={transfers}
        getKey={(r) => r.id}
        empty="No BOM transfers yet."
      />
    </div>
  );
}
