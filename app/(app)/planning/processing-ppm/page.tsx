import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { listProcessingPpms } from "@/lib/planning/ppm-service";
import { fmtDate, fmtMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { ProcessingPpmRow } from "@/lib/planning/ppm-types";
import type { PpmStatus } from "@/lib/planning/ppm-types";
import { withCreatedColumns } from "@/components/ui/created-columns";

const PPM_STATUS_LABELS: Record<PpmStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function ppmStatusTone(status: PpmStatus): StatusTone {
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

const columns: Column<ProcessingPpmRow>[] = [
  {
    header: "Code",
    cell: (r) => (
      <Link
        href={`/planning/processing-ppm/${r.id}`}
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
    header: "SQ No",
    cell: (r) => <span className="text-sm">{r.group_no ?? "\u2014"}</span>,
  },
  {
    header: "Date",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtDate(r.ppm_date)}</span>
    ),
  },
  {
    header: "Net Value",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtMoney(r.net_value)}</span>
    ),
  },
  {
    header: "Status",
    cell: (r) => (
      <StatusPill tone={ppmStatusTone(r.status)}>
        {PPM_STATUS_LABELS[r.status]}
      </StatusPill>
    ),
  },
];

export default async function ProcessingPpmPage() {
  await requirePermission("planning", "view");

  const [ppms, canCreate] = await Promise.all([
    listProcessingPpms(),
    can("planning", "create"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Processing PPM"
        description="Processing/fabric PPM orders."
        actions={
          canCreate ? (
            <Link
              href="/planning/processing-ppm/new"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
            >
              New
            </Link>
          ) : undefined
        }
      />

      <DataTable
        columns={withCreatedColumns(columns, ppms)}
        rows={ppms}
        getKey={(r) => r.id}
        empty="No processing PPM records yet."
      />
    </div>
  );
}
