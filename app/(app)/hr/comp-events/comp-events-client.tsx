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
import { fmtNumber, fmtDate } from "@/lib/format";
import { createCompEvent, approveCompEvent, rejectCompEvent, deleteCompEvent } from "@/lib/hr/extras-actions";
import {
  COMP_KINDS,
  COMP_KIND_LABELS,
  COMP_STATUS_LABELS,
  EMPLOYEE_TYPE_LABELS,
  type CompKind,
  type CompStatus,
} from "@/lib/hr/extras-types";
import type { HrCompEvent } from "@/lib/hr/extras-types";
import type { EmployeeOption } from "@/lib/hr/extras-service";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";

function tone(s: CompStatus): StatusTone {
  return s === "draft" ? "info" : s === "approved" ? "success" : "danger";
}

interface Props {
  rows: HrCompEvent[];
  employees: EmployeeOption[];
  canCreate: boolean;
  canApprove: boolean;
  canDelete: boolean;
  canExport?: boolean;
}

export function CompEventsClient({ rows, employees, canCreate, canApprove, canDelete, canExport = false }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [empKey, setEmpKey] = useState("");
  const [kind, setKind] = useState<CompKind>("bonus");
  const [amount, setAmount] = useState("");
  const [newRate, setNewRate] = useState("");
  const [date, setDate] = useState("");
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
      const r = await createCompEvent({
        employee_type: emp.type,
        employee_id: emp.id,
        employee_name: emp.name,
        kind,
        amount: parseFloat(amount) || 0,
        new_rate: newRate ? parseFloat(newRate) : null,
        effective_date: date || null,
        reason: reason || null,
      });
      if (r.ok) {
        success("Event created");
        setEmpKey(""); setKind("bonus"); setAmount(""); setNewRate(""); setDate(""); setReason("");
        setOpen(false);
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<HrCompEvent>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Employee", cell: (r) => <span className="text-sm">{r.employee_name ?? "—"} <span className="text-xs text-muted-foreground">({EMPLOYEE_TYPE_LABELS[r.employee_type]})</span></span> },
    { header: "Kind", cell: (r) => <span className="text-sm">{COMP_KIND_LABELS[r.kind]}</span> },
    { header: "Amount / rate", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.kind === "increment" && r.new_rate != null ? fmtNumber(r.new_rate) : fmtNumber(r.amount)}</span> },
    { header: "Effective", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.effective_date)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{COMP_STATUS_LABELS[r.status]}</StatusPill> },
    {
      header: "Actions",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {canApprove && r.status === "draft" && (
            <>
              <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending} onClick={() => run(() => approveCompEvent(r.id), "Approved")}>Approve</Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending} onClick={() => run(() => rejectCompEvent(r.id), "Rejected")}>Reject</Button>
            </>
          )}
          {canDelete && (r.status === "draft" || r.status === "rejected") && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending} onClick={() => run(() => deleteCompEvent(r.id), "Deleted")}>Del</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <DataIoToolbar entityKey="hr_comp_events" rows={rows} canExport={canExport} />
      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>New bonus / increment</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Label htmlFor="cm-emp">Employee</Label>
                    <Select id="cm-emp" value={empKey} onChange={(e) => setEmpKey(e.target.value)}>
                      <option value="">— select employee —</option>
                      {employees.map((x) => <option key={`${x.type}:${x.id}`} value={`${x.type}:${x.id}`}>[{EMPLOYEE_TYPE_LABELS[x.type]}] {x.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="cm-kind">Kind</Label>
                    <Select id="cm-kind" value={kind} onChange={(e) => setKind(e.target.value as CompKind)}>
                      {COMP_KINDS.map((k) => <option key={k} value={k}>{COMP_KIND_LABELS[k]}</option>)}
                    </Select>
                  </div>
                  {kind === "bonus" ? (
                    <div><Label htmlFor="cm-amt">Bonus amount</Label><Input id="cm-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                  ) : (
                    <div><Label htmlFor="cm-rate">New rate/salary</Label><Input id="cm-rate" type="number" min="0" step="0.01" value={newRate} onChange={(e) => setNewRate(e.target.value)} /></div>
                  )}
                  <div><Label htmlFor="cm-date">Effective date</Label><Input id="cm-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                  <div className="sm:col-span-2 lg:col-span-3"><Label htmlFor="cm-reason">Reason</Label><Input id="cm-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
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
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No bonus/increment events yet." />
    </div>
  );
}
