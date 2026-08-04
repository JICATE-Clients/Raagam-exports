import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { listPpmCancels } from "@/lib/planning/ppm-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { PpmCancelRow } from "@/lib/planning/ppm-types";
import type { PpmStatus } from "@/lib/planning/ppm-types";
import { CANCEL_TYPE_LABELS } from "@/lib/planning/ppm-types";
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

const columns: Column<PpmCancelRow>[] = [
  {
    header: "Code",
    cell: (r) => (
      <Link
        href={`/planning/ppm-cancel/${r.id}`}
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
    header: "PPM ID",
    cell: (r) => <span className="text-sm font-mono">{r.ppm_id ?? "\u2014"}</span>,
  },
  {
    header: "Cancel Type",
    cell: (r) => (
      <span className="text-sm">
        {CANCEL_TYPE_LABELS[r.cancel_type] ?? r.cancel_type}
      </span>
    ),
  },
  {
    header: "Date",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtDate(r.cancel_date)}</span>
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

export default async function PpmCancelPage() {
  await requirePermission("planning", "view");

  const [cancels, canCreate] = await Promise.all([
    listPpmCancels(),
    can("planning", "create"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="PPM Cancel"
        description="Purchase/processing PPM cancellations."
        actions={
          canCreate ? (
            <Link
              href="/planning/ppm-cancel/new"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
            >
              New
            </Link>
          ) : undefined
        }
      />

      <DataTable
        columns={withCreatedColumns(columns, cancels)}
        rows={cancels}
        getKey={(r) => r.id}
        empty="No PPM cancellation records yet."
      />
    </div>
  );
}
