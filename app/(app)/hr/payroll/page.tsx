import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { listRuns, getLocations } from "@/lib/hr/payroll-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { NewRunForm } from "./new-run-form";
import type { RunRow } from "@/lib/hr/payroll-service";
import type { PayrollStatus } from "@/lib/hr/types";
import type { StatusTone } from "@/components/ui/status-pill";
import { withCreatedColumns } from "@/components/ui/created-columns";
import { statusTone } from "@/lib/ui/status-tone";

const RUN_STATUS_TONE_OVERRIDES = {
  calculated: "info", // this module's own word — not in the shared table
  // Approved is a step in this document's life, not its end — work still follows it (was warning before the shared table, kept).
  approved: "warning",
  // Locked is the finished, signed-off state here (was success before the shared table, kept).
  locked: "success",
} as const;

function runStatusTone(status: PayrollStatus): StatusTone {
  return statusTone(status, RUN_STATUS_TONE_OVERRIDES);
}

const STATUS_LABELS: Record<PayrollStatus, string> = {
  draft: "Draft",
  calculated: "Calculated",
  approved: "Approved",
  locked: "Locked",
  paid: "Paid",
};

const RUN_KIND_LABELS: Record<string, string> = {
  worker: "Worker",
  staff: "Staff",
};

const columns: Column<RunRow>[] = [
  {
    header: "Code",
    cell: (row) => (
      <Link
        href={`/hr/payroll/${row.id}`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {row.code ?? "—"}
      </Link>
    ),
  },
  {
    header: "Kind",
    cell: (row) => (
      <span className="text-sm">{RUN_KIND_LABELS[row.run_kind] ?? row.run_kind}</span>
    ),
  },
  {
    header: "Period",
    cell: (row) => (
      <span className="tabular-nums text-sm">
        {fmtDate(row.period_start)} – {fmtDate(row.period_end)}
      </span>
    ),
  },
  {
    header: "Location",
    cell: (row) => (
      <span className="text-sm text-muted-foreground">{row.location_name ?? "All"}</span>
    ),
  },
  {
    header: "Status",
    cell: (row) => (
      <StatusPill tone={runStatusTone(row.status)}>
        {STATUS_LABELS[row.status]}
      </StatusPill>
    ),
  },
  {
    header: "Created",
    cell: (row) => (
      <span className="tabular-nums text-xs text-muted-foreground">
        {fmtDate(row.created_at)}
      </span>
    ),
  },
];

export default async function PayrollPage() {
  await requirePermission("hr_payroll", "view");

  const [runs, locations] = await Promise.all([listRuns(), getLocations()]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payroll runs"
        description="Manage worker and staff payroll"
        actions={<NewRunForm locations={locations} />}
      />

      <DataTable
        columns={withCreatedColumns(columns, runs)}
        rows={runs}
        getKey={(row) => row.id}
        empty="No payroll runs yet. Use 'New run' to create one."
        onRowHref={(row) => `/hr/payroll/${row.id}`}
      />
    </div>
  );
}
