import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getRun,
  getRunLines,
  getContractorPayroll,
} from "@/lib/hr/payroll-service";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Stat } from "@/components/ui/stat";
import { RunActions } from "./run-actions";
import { countPendingFinesInPeriod } from "@/lib/hr/fines-service";
import Link from "next/link";
import type { LineWithName, ContractorPayrollWithName } from "@/lib/hr/payroll-service";
import type { PayrollStatus } from "@/lib/hr/types";
import type { StatusTone } from "@/components/ui/status-pill";

function runStatusTone(status: PayrollStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "calculated":
      return "info";
    case "approved":
      return "warning";
    case "locked":
      return "success";
    case "paid":
      return "success";
  }
}


const WORKER_TYPE_LABELS: Record<string, string> = {
  shift: "Shift",
  contractor_piece: "Piece (Contractor)",
  company_piece: "Piece (Company)",
};

// worker payroll lines table (dual A/C columns)
const workerColumns: Column<LineWithName>[] = [
  {
    header: "Worker",
    cell: (row) => <span className="font-medium text-sm">{row.worker_name ?? "—"}</span>,
  },
  {
    header: "Type",
    cell: (row) => (
      <span className="text-xs text-muted-foreground">
        {WORKER_TYPE_LABELS[row.worker_type ?? ""] ?? row.worker_type ?? "—"}
      </span>
    ),
  },
  {
    header: "Days",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm">{fmtNumber(row.days_worked)}</span>
    ),
  },
  {
    header: "OT hrs",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm">{fmtNumber(row.ot_hours)}</span>
    ),
  },
  // A/C 1 group
  {
    header: "A/C 1 Gross",
    align: "right",
    className: "bg-blue-50/60",
    cell: (row) => (
      <span className="tabular-nums text-sm font-medium">{fmtMoney(row.actual_gross)}</span>
    ),
  },
  {
    header: "ESI",
    align: "right",
    className: "bg-blue-50/60",
    cell: (row) => (
      <span className="tabular-nums text-sm text-danger">{row.esi > 0 ? `(${fmtMoney(row.esi)})` : "—"}</span>
    ),
  },
  {
    header: "PF",
    align: "right",
    className: "bg-blue-50/60",
    cell: (row) => (
      <span className="tabular-nums text-sm text-danger">{row.pf > 0 ? `(${fmtMoney(row.pf)})` : "—"}</span>
    ),
  },
  {
    header: "A/C 1 Net",
    align: "right",
    className: "bg-blue-50/60",
    cell: (row) => (
      <span className="tabular-nums text-sm font-semibold">{fmtMoney(row.actual_net)}</span>
    ),
  },
  // A/C 2 group
  {
    header: "Pieces",
    align: "right",
    className: "bg-amber-50/60",
    cell: (row) => (
      <span className="tabular-nums text-sm">{row.pieces > 0 ? fmtNumber(row.pieces) : "—"}</span>
    ),
  },
  {
    header: "A/C 2 Extra",
    align: "right",
    className: "bg-amber-50/60",
    cell: (row) => (
      <span className="tabular-nums text-sm font-medium">
        {row.extra_wage > 0 ? fmtMoney(row.extra_wage) : "—"}
      </span>
    ),
  },
  {
    header: "Total net",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm font-bold">{fmtMoney(row.total_net)}</span>
    ),
  },
];

const staffColumns: Column<LineWithName>[] = [
  {
    header: "Staff",
    cell: (row) => <span className="font-medium text-sm">{row.staff_name ?? "—"}</span>,
  },
  {
    header: "Gross",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm font-medium">{fmtMoney(row.actual_gross)}</span>
    ),
  },
  {
    header: "ESI",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm text-danger">{row.esi > 0 ? `(${fmtMoney(row.esi)})` : "—"}</span>
    ),
  },
  {
    header: "PF",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm text-danger">{row.pf > 0 ? `(${fmtMoney(row.pf)})` : "—"}</span>
    ),
  },
  /* 0629 — approved fines (capped), and the flag when the cap bit. The net
     beside it is already net of the deducted part. */
  {
    header: "Fines",
    align: "right",
    cell: (row) => (
      <span className="inline-flex flex-col items-end">
        <span className="tabular-nums text-sm text-danger">
          {Number(row.fine_deduction) > 0 ? `(${fmtMoney(row.fine_deduction)})` : "—"}
        </span>
        {row.fine_review && (
          <span className="text-xs font-medium text-warning">
            Review · {fmtMoney(row.fine_over_cap)} over cap, not deducted
          </span>
        )}
      </span>
    ),
  },
  {
    header: "Net",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm font-bold">{fmtMoney(row.actual_net)}</span>
    ),
  },
];

const contractorColumns: Column<ContractorPayrollWithName>[] = [
  {
    header: "Contractor",
    cell: (row) => <span className="font-medium text-sm">{row.contractor_name ?? "—"}</span>,
  },
  {
    header: "Total pieces",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm">{fmtNumber(row.total_pieces)}</span>
    ),
  },
  {
    header: "Piece value",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm font-medium">{fmtMoney(row.piece_amount)}</span>
    ),
  },
  {
    header: "− Worker wages",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm text-danger">({fmtMoney(row.sum_actual_wages)})</span>
    ),
  },
  {
    header: "= Extra (A/C 2)",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm font-bold text-success">{fmtMoney(row.extra_wage)}</span>
    ),
  },
];

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  await requirePermission("hr_payroll", "view");
  const { runId } = await params;

  const [run, lines, contractorRows, canEdit, canApprove] = await Promise.all([
    getRun(runId),
    getRunLines(runId),
    getContractorPayroll(runId),
    can("hr_payroll", "edit"),
    can("hr_payroll", "approve"),
  ]);

  if (!run) notFound();

  const isWorkerRun = run.run_kind === "worker";
  const pendingFines = isWorkerRun ? 0 : await countPendingFinesInPeriod(run.period_start, run.period_end);
  const totalFines = lines.reduce((s, l) => s + Number(l.fine_deduction || 0), 0);
  const flaggedLines = lines.filter((l) => l.fine_review).length;

  // summary totals
  const totalActualGross = lines.reduce((s, l) => s + l.actual_gross, 0);
  const totalEsi = lines.reduce((s, l) => s + l.esi, 0);
  const totalPf = lines.reduce((s, l) => s + l.pf, 0);
  const totalActualNet = lines.reduce((s, l) => s + l.actual_net, 0);
  const totalExtraWage = lines.reduce((s, l) => s + l.extra_wage, 0);
  const totalNet = lines.reduce((s, l) => s + l.total_net, 0);

  const STATUS_LABELS_MAP: Record<PayrollStatus, string> = {
    draft: "Draft",
    calculated: "Calculated",
    approved: "Approved",
    locked: "Locked",
    paid: "Paid",
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={run.code ?? "Payroll run"}
        description={`${run.run_kind === "worker" ? "Worker" : "Staff"} · ${fmtDate(run.period_start)} – ${fmtDate(run.period_end)}${run.location_name ? ` · ${run.location_name}` : ""}`}
        actions={
          <div className="flex items-center gap-3">
            <StatusPill tone={runStatusTone(run.status as PayrollStatus)}>
              {STATUS_LABELS_MAP[run.status as PayrollStatus]}
            </StatusPill>
            <RunActions
              runId={run.id}
              status={run.status as PayrollStatus}
              canEdit={canEdit}
              canApprove={canApprove}
            />
          </div>
        }
      />

      {/* run meta strip */}
      <Card>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Period type</dt>
              <dd className="font-medium capitalize">{run.period_type}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Location</dt>
              <dd className="font-medium">{run.location_name ?? "All"}</dd>
            </div>
            {run.approved_by && (
              <div>
                <dt className="text-xs text-muted-foreground">Approved at</dt>
                <dd className="tabular-nums font-medium">{fmtDate(run.approved_at)}</dd>
              </div>
            )}
            {run.notes && (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Notes</dt>
                <dd className="font-medium">{run.notes}</dd>
              </div>
            )}
          </dl>
        </CardBody>
      </Card>

      {/* summary stats */}
      {lines.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="A/C 1 Gross"
            value={fmtMoney(totalActualGross)}
            hint="Shift + OT wages"
            tone="neutral"
          />
          <Stat
            label="A/C 1 Net"
            value={fmtMoney(totalActualNet)}
            hint="After ESI + PF"
            tone="neutral"
          />
          {isWorkerRun && (
            <Stat
              label="A/C 2 Extra"
              value={fmtMoney(totalExtraWage)}
              hint="No deductions"
              tone="neutral"
            />
          )}
          <Stat
            label={isWorkerRun ? "Total net (all A/Cs)" : "Total net"}
            value={fmtMoney(totalNet)}
            tone="neutral"
          />
          {!isWorkerRun && (
            <Stat label="Total fines" value={fmtMoney(totalFines)} hint="Approved fines deducted" tone="neutral" />
          )}
          <Stat label="Total ESI" value={fmtMoney(totalEsi)} tone="neutral" />
          <Stat label="Total PF" value={fmtMoney(totalPf)} tone="neutral" />
        </div>
      )}

      {/* 0629 — fines that change this run's figures, said before approval */}
      {!isWorkerRun && (pendingFines > 0 || flaggedLines > 0) && (
        <Card>
          <CardBody className="space-y-1 text-sm">
            {pendingFines > 0 && (
              <p>
                <span className="font-medium text-warning">{pendingFines} fine{pendingFines === 1 ? "" : "s"} awaiting approval</span>{" "}
                for this period. Once approved they are deducted from the staff line automatically while this run is
                draft or calculated; after the run is approved they are refused for this month.{" "}
                <Link href="/hr/fines" className="text-primary underline-offset-2 hover:underline">Open Fines &amp; Deductions</Link>
              </p>
            )}
            {flaggedLines > 0 && (
              <p>
                <span className="font-medium text-warning">{flaggedLines} line{flaggedLines === 1 ? "" : "s"} flagged for review</span>{" "}
                — approved fines exceed the cap set in Payroll Settings, so only the capped amount was deducted.
              </p>
            )}
          </CardBody>
        </Card>
      )}

      {/* payroll lines */}
      <Card>
        <CardHeader>
          <CardTitle>
            {isWorkerRun ? "Worker payroll lines" : "Staff payroll lines"}
          </CardTitle>
          {isWorkerRun && (
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded bg-blue-100" />
                A/C 1 — Actual wage (shift + OT, ESI/PF deducted)
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded bg-amber-100" />
                A/C 2 — Extra wage (no deductions)
              </span>
            </div>
          )}
        </CardHeader>
        <CardBody className="p-0">
          {lines.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {run.status === "draft"
                ? "Click 'Calculate' to compute payroll."
                : "No lines found."}
            </p>
          ) : (
            <DataTable paginate={false}
              columns={isWorkerRun ? workerColumns : staffColumns}
              rows={lines}
              getKey={(row) => row.id}
            />
          )}
        </CardBody>
      </Card>

      {/* contractor netting — worker runs only */}
      {isWorkerRun && (
        <Card>
          <CardHeader>
            <CardTitle>Contractor payroll (netting)</CardTitle>
            <span className="text-xs text-muted-foreground">
              Piece value − Σ worker wages = extra paid to contractor (A/C 2)
            </span>
          </CardHeader>
          <CardBody className="p-0">
            {contractorRows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                No contractor piece workers in this run.
              </p>
            ) : (
              <DataTable paginate={false}
                columns={contractorColumns}
                rows={contractorRows}
                getKey={(row) => row.id}
              />
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
