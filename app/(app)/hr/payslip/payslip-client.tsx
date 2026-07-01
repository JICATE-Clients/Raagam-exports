"use client";

import { useState, useTransition } from "react";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import type { WorkerOption, RunOption, LineWithName } from "@/lib/hr/payroll-service";

async function fetchPayslipLine(runId: string, workerId: string): Promise<LineWithName | null> {
  // We call a server action defined in a separate file to fetch the line
  const { getLineForPayslipAction } = await import("./payslip-actions");
  return getLineForPayslipAction(runId, workerId);
}

export function PayslipClient({
  workers,
  runs,
}: {
  workers: WorkerOption[];
  runs: RunOption[];
}) {
  const [workerId, setWorkerId] = useState<string>("");
  const [runId, setRunId] = useState<string>("");
  const [line, setLine] = useState<LineWithName | null | undefined>(undefined);
  const [run, setRun] = useState<RunOption | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const [notFound, setNotFound] = useState(false);

  function handleLoad() {
    if (!workerId || !runId) return;
    const selectedRun = runs.find((r) => r.id === runId);
    setRun(selectedRun);
    setNotFound(false);

    startTransition(async () => {
      const result = await fetchPayslipLine(runId, workerId);
      if (!result) {
        setNotFound(true);
        setLine(null);
      } else {
        setNotFound(false);
        setLine(result);
      }
    });
  }

  const worker = workers.find((w) => w.id === workerId);

  const details = line?.details as Record<string, unknown> | null | undefined;
  const shiftPay = typeof details?.shiftPay === "number" ? details.shiftPay : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Select worker and run</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="worker_id">Worker</Label>
              <Select
                id="worker_id"
                value={workerId}
                onChange={(e) => setWorkerId(e.target.value)}
              >
                <option value="">Select worker…</option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code ? `${w.code} — ` : ""}{w.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor="run_id">Payroll run</Label>
              <Select
                id="run_id"
                value={runId}
                onChange={(e) => setRunId(e.target.value)}
              >
                <option value="">Select run…</option>
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code ?? "Run"} · {fmtDate(r.period_start)} – {fmtDate(r.period_end)} ({r.status})
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex items-end">
              <Button
                onClick={handleLoad}
                disabled={!workerId || !runId || pending}
              >
                {pending ? "Loading…" : "View payslip"}
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {notFound && (
        <Card>
          <CardBody>
            <p className="text-sm text-muted-foreground text-center py-4">
              No payroll record found for this worker in the selected run.
            </p>
          </CardBody>
        </Card>
      )}

      {line && run && worker && (
        <Card>
          <CardHeader>
            <CardTitle>Payslip — {worker.name}</CardTitle>
            <span className="text-xs text-muted-foreground">
              Run: {run.code ?? "—"} · {fmtDate(run.period_start)} to {fmtDate(run.period_end)}
            </span>
          </CardHeader>
          <CardBody className="space-y-5">
            {/* header */}
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Worker</p>
                <p className="font-semibold">{worker.name}</p>
              </div>
              {worker.code && (
                <div>
                  <p className="text-xs text-muted-foreground">Code</p>
                  <p className="font-mono font-medium">{worker.code}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground">Period</p>
                <p className="tabular-nums font-medium">
                  {fmtDate(run.period_start)} – {fmtDate(run.period_end)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Days present</p>
                <p className="tabular-nums font-medium">{fmtNumber(line.days_worked)}</p>
              </div>
            </div>

            <hr className="border-border" />

            {/* A/C 1 — Actual wage */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">
                Account 1 — Actual Wage
              </p>
              <div className="rounded-md border border-blue-200 bg-blue-50/40 p-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span>Shift pay ({fmtNumber(line.days_worked)} days)</span>
                  <span className="tabular-nums font-medium">
                    {shiftPay != null ? fmtMoney(shiftPay) : fmtMoney(line.actual_gross)}
                  </span>
                </div>
                {line.ot_hours > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>OT pay ({fmtNumber(line.ot_hours)} hrs × 2×)</span>
                    <span className="tabular-nums font-medium">{fmtMoney(line.ot_wage)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-semibold border-t border-blue-200 pt-1 mt-1">
                  <span>Gross (A/C 1)</span>
                  <span className="tabular-nums">{fmtMoney(line.actual_gross)}</span>
                </div>
                {line.esi > 0 && (
                  <div className="flex justify-between text-sm text-danger">
                    <span>ESI deduction</span>
                    <span className="tabular-nums">({fmtMoney(line.esi)})</span>
                  </div>
                )}
                {line.pf > 0 && (
                  <div className="flex justify-between text-sm text-danger">
                    <span>PF deduction</span>
                    <span className="tabular-nums">({fmtMoney(line.pf)})</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold border-t border-blue-300 pt-1 mt-1">
                  <span>Net (A/C 1)</span>
                  <span className="tabular-nums">{fmtMoney(line.actual_net)}</span>
                </div>
              </div>
            </div>

            {/* A/C 2 — Extra wage */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-600">
                Account 2 — Extra Wage (no deductions)
              </p>
              <div className="rounded-md border border-amber-200 bg-amber-50/40 p-3 space-y-1">
                {line.pieces > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>Pieces produced</span>
                    <span className="tabular-nums font-medium">{fmtNumber(line.pieces)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold">
                  <span>Extra wage (A/C 2)</span>
                  <span className="tabular-nums">
                    {line.extra_wage > 0 ? fmtMoney(line.extra_wage) : "—"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  No ESI / PF deducted on A/C 2
                </p>
              </div>
            </div>

            <hr className="border-border" />

            {/* Grand total */}
            <div className="flex items-center justify-between rounded-md bg-surface-muted px-4 py-3">
              <span className="font-semibold text-foreground">Grand total (A/C 1 + A/C 2)</span>
              <span className="tabular-nums text-xl font-bold text-foreground">
                {fmtMoney(line.total_net)}
              </span>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
