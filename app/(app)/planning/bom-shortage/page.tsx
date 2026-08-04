import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { listBomShortages } from "@/lib/planning/bom-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { BomShortageRow } from "@/lib/planning/bom-service";
import type { BomStatus } from "@/lib/planning/bom-types";
import { withCreatedColumns } from "@/components/ui/created-columns";

const BOM_STATUS_LABELS: Record<BomStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function bomStatusTone(status: BomStatus): StatusTone {
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

const columns: Column<BomShortageRow>[] = [
  {
    header: "Code",
    cell: (r) => (
      <Link
        href={`/planning/bom-shortage/${r.id}`}
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
    header: "Order",
    cell: (r) => <span className="text-sm">{r.order_code ?? "\u2014"}</span>,
  },
  {
    header: "Req No",
    cell: (r) => <span className="text-sm">{r.req_no ?? "\u2014"}</span>,
  },
  {
    header: "Req Date",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtDate(r.req_date)}</span>
    ),
  },
  {
    header: "Status",
    cell: (r) => (
      <StatusPill tone={bomStatusTone(r.status)}>
        {BOM_STATUS_LABELS[r.status]}
      </StatusPill>
    ),
  },
  {
    header: "Due Date",
    cell: (r) => (
      <span className="tabular-nums text-sm">
        {r.required_date ? fmtDate(r.required_date) : "\u2014"}
      </span>
    ),
  },
];

export default async function BomShortagePage() {
  await requirePermission("planning", "view");

  const [shortages, canCreate] = await Promise.all([
    listBomShortages(),
    can("planning", "create"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="BOM Shortage"
        description="Material shortage requisitions against BOMs."
        actions={
          canCreate ? (
            <Link
              href="/planning/bom-shortage/new"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
            >
              New
            </Link>
          ) : undefined
        }
      />

      <DataTable
        columns={withCreatedColumns(columns, shortages)}
        rows={shortages}
        getKey={(r) => r.id}
        empty="No BOM shortage requisitions yet."
      />
    </div>
  );
}
