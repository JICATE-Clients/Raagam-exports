import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { listMaterialExcessPlans } from "@/lib/planning/material-planning-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { MaterialExcessPlanRow } from "@/lib/planning/material-planning-types";
import type { MpStatus } from "@/lib/planning/material-planning-types";

const MP_STATUS_LABELS: Record<MpStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function mpStatusTone(status: MpStatus): StatusTone {
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

const columns: Column<MaterialExcessPlanRow>[] = [
  {
    header: "Code",
    cell: (r) => (
      <Link
        href={`/planning/material-excess-plan/${r.id}`}
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
    header: "Group No",
    cell: (r) => <span className="text-sm">{r.group_no ?? "\u2014"}</span>,
  },
  {
    header: "Date",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtDate(r.entry_date)}</span>
    ),
  },
  {
    header: "Status",
    cell: (r) => (
      <StatusPill tone={mpStatusTone(r.status)}>
        {MP_STATUS_LABELS[r.status]}
      </StatusPill>
    ),
  },
];

export default async function MaterialExcessPlanPage() {
  await requirePermission("planning", "view");

  const [plans, canCreate] = await Promise.all([
    listMaterialExcessPlans(),
    can("planning", "create"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Material Excess Plan"
        description="Excess allowance planning for BOM items."
        actions={
          canCreate ? (
            <Link
              href="/planning/material-excess-plan/new"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
            >
              New
            </Link>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        rows={plans}
        getKey={(r) => r.id}
        empty="No material excess plan records yet."
      />
    </div>
  );
}
