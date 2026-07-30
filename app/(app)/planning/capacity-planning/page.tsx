import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { listCapacityPlans } from "@/lib/planning/production-planning-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { CapacityPlan, PpStatus } from "@/lib/planning/production-planning-types";
import { DATE_TYPE_LABELS } from "@/lib/planning/production-planning-types";

const STATUS_LABELS: Record<PpStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

function statusTone(status: PpStatus): StatusTone {
  switch (status) {
    case "draft":     return "neutral";
    case "submitted": return "warning";
    case "approved":  return "success";
    case "rejected":  return "danger";
  }
}

const columns: Column<CapacityPlan>[] = [
  {
    header: "Code",
    cell: (r) => (
      <Link
        href={`/planning/capacity-planning/${r.id}`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {r.code ?? "\u2014"}
      </Link>
    ),
  },
  {
    header: "Plan Date",
    cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.plan_date)}</span>,
  },
  {
    header: "Date Type",
    cell: (r) => <span className="text-sm">{DATE_TYPE_LABELS[r.date_type ?? "E"] ?? r.date_type ?? "\u2014"}</span>,
  },
  {
    header: "From",
    cell: (r) => <span className="tabular-nums text-sm">{r.from_date ? fmtDate(r.from_date) : "\u2014"}</span>,
  },
  {
    header: "To",
    cell: (r) => <span className="tabular-nums text-sm">{r.to_date ? fmtDate(r.to_date) : "\u2014"}</span>,
  },
  {
    header: "Status",
    cell: (r) => (
      <StatusPill tone={statusTone(r.status)}>
        {STATUS_LABELS[r.status]}
      </StatusPill>
    ),
  },
];

export default async function CapacityPlanningPage() {
  await requirePermission("planning", "view");

  const [plans, canCreate] = await Promise.all([
    listCapacityPlans(),
    can("planning", "create"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Capacity Planning"
        description="Pre-production capacity allocation across lines and teams."
        actions={
          canCreate ? (
            <Link
              href="/planning/capacity-planning/new"
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
        empty="No capacity plans yet."
      />
    </div>
  );
}
