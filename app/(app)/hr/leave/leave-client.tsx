"use client";

import { useState, useTransition } from "react";
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
import { createLeave, approveLeave, rejectLeave, cancelLeave, deleteLeave } from "@/lib/hr/extras-actions";
import {
  LEAVE_TYPES,
  LEAVE_TYPE_LABELS,
  LEAVE_STATUS_LABELS,
  EMPLOYEE_TYPE_LABELS,
  type LeaveType,
  type LeaveStatus,
} from "@/lib/hr/extras-types";
import type { HrLeave } from "@/lib/hr/extras-types";
import type { EmployeeOption } from "@/lib/hr/extras-service";

function tone(s: LeaveStatus): StatusTone {
  switch (s) {
    case "pending":
      return "info";
    case "approved":
      return "success";
    case "rejected":
    case "cancelled":
      return "danger";
  }
}

interface Props {
  rows: HrLeave[];
  employees: EmployeeOption[];
  canCreate: boolean;
  canEdit: boolean;
  canApprove: boolean;
  canDelete: boolean;
}

export function LeaveClient({ rows, employees, canCreate, canEdit, canApprove, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [empKey, setEmpKey] = useState("");
  const [leaveType, setLeaveType] = useState<LeaveType>("casual");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [days, setDays] = useState("");
  const [encash, setEncash] = useState(false);
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
      const r = await createLeave({
        employee_type: emp.type,
        employee_id: emp.id,
        employee_name: emp.name,
        leave_type: leaveType,
        from_date: fromDate || null,
        to_date: toDate || null,
        days: parseFloat(days) || 0,
        is_encashment: encash,
        reason: reason || null,
      });
      if (r.ok) {
        success("Leave created");
        setEmpKey(""); setLeaveType("casual"); setFromDate(""); setToDate(""); setDays(""); setEncash(false); setReason("");
        setOpen(false);
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<HrLeave>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Employee", cell: (r) => <span className="text-sm">{r.employee_name ?? "—"} <span className="text-xs text-muted-foreground">({EMPLOYEE_TYPE_LABELS[r.employee_type]})</span></span> },
    { header: "Type", cell: (r) => <span className="text-sm">{LEAVE_TYPE_LABELS[r.leave_type]}{r.is_encashment ? " · encash" : ""}</span> },
    { header: "Period", cell: (r) => <span className="text-sm tabular-nums">{[fmtDate(r.from_date), fmtDate(r.to_date)].join(" → ")}</span> },
    { header: "Days", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.days)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{LEAVE_STATUS_LABELS[r.status]}</StatusPill> },
    {
      header: "Actions",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {canApprove && r.status === "pending" && (
            <>
              <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending} onClick={() => run(() => approveLeave(r.id), "Approved")}>Approve</Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending} onClick={() => run(() => rejectLeave(r.id), "Rejected")}>Reject</Button>
            </>
          )}
          {canEdit && r.status === "pending" && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={isPending} onClick={() => run(() => cancelLeave(r.id), "Cancelled")}>Cancel</Button>
          )}
          {canDelete && (r.status === "pending" || r.status === "cancelled" || r.status === "rejected") && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending} onClick={() => run(() => deleteLeave(r.id), "Deleted")}>Del</Button>
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
              <CardTitle>New leave / encashment</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Label htmlFor="lv-emp">Employee</Label>
                    <Select id="lv-emp" value={empKey} onChange={(e) => setEmpKey(e.target.value)}>
                      <option value="">— select employee —</option>
                      {employees.map((x) => <option key={`${x.type}:${x.id}`} value={`${x.type}:${x.id}`}>[{EMPLOYEE_TYPE_LABELS[x.type]}] {x.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="lv-type">Leave type</Label>
                    <Select id="lv-type" value={leaveType} onChange={(e) => setLeaveType(e.target.value as LeaveType)}>
                      {LEAVE_TYPES.map((k) => <option key={k} value={k}>{LEAVE_TYPE_LABELS[k]}</option>)}
                    </Select>
                  </div>
                  <div><Label htmlFor="lv-from">From</Label><Input id="lv-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
                  <div><Label htmlFor="lv-to">To</Label><Input id="lv-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
                  <div><Label htmlFor="lv-days">Days</Label><Input id="lv-days" type="number" min="0" step="0.5" value={days} onChange={(e) => setDays(e.target.value)} /></div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={encash} onChange={(e) => setEncash(e.target.checked)} /> EL encashment
                    </label>
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3"><Label htmlFor="lv-reason">Reason</Label><Input id="lv-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Create"}</Button>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : (
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New leave</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No leave records yet." />
    </div>
  );
}
