"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtDate } from "@/lib/format";
import { createLifecycle, completeLifecycle, cancelLifecycle, deleteLifecycle } from "@/lib/hr/extras-actions";
import {
  LIFECYCLE_KINDS,
  LIFECYCLE_KIND_LABELS,
  LIFECYCLE_STATUS_LABELS,
  EMPLOYEE_TYPE_LABELS,
  type LifecycleKind,
  type LifecycleStatus,
} from "@/lib/hr/extras-types";
import type { HrLifecycleEvent } from "@/lib/hr/extras-types";
import type { EmployeeOption } from "@/lib/hr/extras-service";

function tone(s: LifecycleStatus): StatusTone {
  return s === "draft" ? "info" : s === "completed" ? "success" : "danger";
}

interface Props {
  rows: HrLifecycleEvent[];
  employees: EmployeeOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function LifecycleClient({ rows, employees, canCreate, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [empKey, setEmpKey] = useState("");
  const [kind, setKind] = useState<LifecycleKind>("transfer");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [fromLoc, setFromLoc] = useState("");
  const [toLoc, setToLoc] = useState("");
  const [lwd, setLwd] = useState("");
  const [settlement, setSettlement] = useState("");
  const [reason, setReason] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        success(ok);
        router.refresh();
      } else toastError(r.error ?? "Action failed");
    });
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const emp = employees.find((x) => `${x.type}:${x.id}` === empKey);
    if (!emp) {
      toastError("Select an employee");
      return;
    }
    startTransition(async () => {
      const r = await createLifecycle({
        employee_type: emp.type,
        employee_id: emp.id,
        employee_name: emp.name,
        kind,
        effective_date: effectiveDate || null,
        from_location: kind === "transfer" ? fromLoc || null : null,
        to_location: kind === "transfer" ? toLoc || null : null,
        last_working_day: kind === "resignation" ? lwd || null : null,
        settlement_amount: kind === "settlement" && settlement ? parseFloat(settlement) : null,
        reason: reason || null,
      });
      if (r.ok) {
        success("Event created");
        setEmpKey(""); setKind("transfer"); setEffectiveDate(""); setFromLoc(""); setToLoc(""); setLwd(""); setSettlement(""); setReason("");
        setOpen(false);
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<HrLifecycleEvent>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Employee", cell: (r) => <span className="text-sm">{r.employee_name ?? "—"} <span className="text-xs text-muted-foreground">({EMPLOYEE_TYPE_LABELS[r.employee_type]})</span></span> },
    { header: "Kind", cell: (r) => <span className="text-sm">{LIFECYCLE_KIND_LABELS[r.kind]}</span> },
    { header: "Effective", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.effective_date)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{LIFECYCLE_STATUS_LABELS[r.status]}</StatusPill> },
    {
      header: "Actions",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {canEdit && r.status === "draft" && (
            <>
              <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending} onClick={() => run(() => completeLifecycle(r.id), "Completed")}>Complete</Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={isPending} onClick={() => run(() => cancelLifecycle(r.id), "Cancelled")}>Cancel</Button>
            </>
          )}
          {canDelete && (r.status === "draft" || r.status === "cancelled") && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending} onClick={() => run(() => deleteLifecycle(r.id), "Deleted")}>Del</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>New lifecycle event</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Label htmlFor="lc-emp">Employee</Label>
                    <Select id="lc-emp" value={empKey} onChange={(e) => setEmpKey(e.target.value)}>
                      <option value="">— select employee —</option>
                      {employees.map((x) => <option key={`${x.type}:${x.id}`} value={`${x.type}:${x.id}`}>[{EMPLOYEE_TYPE_LABELS[x.type]}] {x.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="lc-kind">Kind</Label>
                    <Select id="lc-kind" value={kind} onChange={(e) => setKind(e.target.value as LifecycleKind)}>
                      {LIFECYCLE_KINDS.map((k) => <option key={k} value={k}>{LIFECYCLE_KIND_LABELS[k]}</option>)}
                    </Select>
                  </div>
                  <div><Label htmlFor="lc-eff">Effective date</Label><Input id="lc-eff" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} /></div>
                  {kind === "transfer" && (
                    <>
                      <div><Label htmlFor="lc-from">From location</Label><Input id="lc-from" value={fromLoc} onChange={(e) => setFromLoc(e.target.value)} /></div>
                      <div><Label htmlFor="lc-to">To location</Label><Input id="lc-to" value={toLoc} onChange={(e) => setToLoc(e.target.value)} /></div>
                    </>
                  )}
                  {kind === "resignation" && (
                    <div><Label htmlFor="lc-lwd">Last working day</Label><Input id="lc-lwd" type="date" value={lwd} onChange={(e) => setLwd(e.target.value)} /></div>
                  )}
                  {kind === "settlement" && (
                    <div><Label htmlFor="lc-set">Settlement amount</Label><Input id="lc-set" type="number" min="0" step="0.01" value={settlement} onChange={(e) => setSettlement(e.target.value)} /></div>
                  )}
                  <div className="sm:col-span-2 lg:col-span-3"><Label htmlFor="lc-reason">Reason / notes</Label><Input id="lc-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Create"}</Button>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : (
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New event</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No lifecycle events yet." />
    </div>
  );
}
