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
import { createAdvance, recordRepayment, cancelAdvance, deleteAdvance } from "@/lib/hr/extras-actions";
import { ADVANCE_STATUS_LABELS, EMPLOYEE_TYPE_LABELS, type AdvanceStatus } from "@/lib/hr/extras-types";
import type { HrAdvance } from "@/lib/hr/extras-types";
import type { EmployeeOption } from "@/lib/hr/extras-service";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";

function tone(s: AdvanceStatus): StatusTone {
  switch (s) {
    case "open":
      return "warning";
    case "repaying":
      return "info";
    case "closed":
      return "success";
    case "cancelled":
      return "danger";
  }
}

interface Props {
  rows: HrAdvance[];
  employees: EmployeeOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExport?: boolean;
}

export function AdvancesClient({ rows, employees, canCreate, canEdit, canDelete, canExport = false }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [empKey, setEmpKey] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");

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
      const r = await createAdvance({
        employee_type: emp.type,
        employee_id: emp.id,
        employee_name: emp.name,
        amount: parseFloat(amount) || 0,
        reason: reason || null,
        advance_date: date || null,
      });
      if (r.ok) {
        success("Advance created");
        setEmpKey(""); setAmount(""); setReason(""); setDate("");
        setOpen(false);
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<HrAdvance>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Employee", cell: (r) => <span className="text-sm">{r.employee_name ?? "—"} <span className="text-xs text-muted-foreground">({EMPLOYEE_TYPE_LABELS[r.employee_type]})</span></span> },
    { header: "Amount", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.amount)}</span> },
    { header: "Repaid", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.repaid_amount)}</span> },
    { header: "Date", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.advance_date)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{ADVANCE_STATUS_LABELS[r.status]}</StatusPill> },
    {
      header: "Actions",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {canEdit && (r.status === "open" || r.status === "repaying") && (
            <>
              <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending}
                onClick={() => run(() => recordRepayment(r.id, r.amount - r.repaid_amount), "Repaid in full")}>Repay full</Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={isPending}
                onClick={() => run(() => cancelAdvance(r.id), "Cancelled")}>Cancel</Button>
            </>
          )}
          {canDelete && (r.status === "open" || r.status === "cancelled") && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending}
              onClick={() => run(() => deleteAdvance(r.id), "Deleted")}>Del</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <DataIoToolbar entityKey="hr_advances" rows={rows} canExport={canExport} />
      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>New advance</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="sm:col-span-2">
                    <Label htmlFor="ad-emp">Employee</Label>
                    <Select id="ad-emp" value={empKey} onChange={(e) => setEmpKey(e.target.value)}>
                      <option value="">— select employee —</option>
                      {employees.map((x) => <option key={`${x.type}:${x.id}`} value={`${x.type}:${x.id}`}>[{EMPLOYEE_TYPE_LABELS[x.type]}] {x.name}</option>)}
                    </Select>
                  </div>
                  <div><Label htmlFor="ad-amt">Amount</Label><Input id="ad-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                  <div><Label htmlFor="ad-date">Date</Label><Input id="ad-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                  <div className="sm:col-span-2 lg:col-span-4"><Label htmlFor="ad-reason">Reason</Label><Input id="ad-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Create"}</Button>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : (
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New advance</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No advances yet." />
    </div>
  );
}
