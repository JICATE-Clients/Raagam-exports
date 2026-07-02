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
import { fmtNumber } from "@/lib/format";
import { createAdjustment, endAdjustment, deleteAdjustment } from "@/lib/hr/extras-actions";
import {
  ADJUSTMENT_KINDS,
  ADJUSTMENT_KIND_LABELS,
  EMPLOYEE_TYPE_LABELS,
  type AdjustmentKind,
} from "@/lib/hr/extras-types";
import type { HrAdjustment } from "@/lib/hr/extras-types";
import type { EmployeeOption } from "@/lib/hr/extras-service";

interface Props {
  rows: HrAdjustment[];
  employees: EmployeeOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function AdjustmentsClient({ rows, employees, canCreate, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [empKey, setEmpKey] = useState("");
  const [kind, setKind] = useState<AdjustmentKind>("allowance");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [month, setMonth] = useState("");
  const [recurring, setRecurring] = useState(false);

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
      const r = await createAdjustment({
        employee_type: emp.type,
        employee_id: emp.id,
        employee_name: emp.name,
        kind,
        label,
        amount: parseFloat(amount) || 0,
        effective_month: month || null,
        recurring,
      });
      if (r.ok) {
        success("Adjustment created");
        setEmpKey(""); setKind("allowance"); setLabel(""); setAmount(""); setMonth(""); setRecurring(false);
        setOpen(false);
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<HrAdjustment>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Employee", cell: (r) => <span className="text-sm">{r.employee_name ?? "—"} <span className="text-xs text-muted-foreground">({EMPLOYEE_TYPE_LABELS[r.employee_type]})</span></span> },
    { header: "Kind", cell: (r) => <span className="text-sm">{ADJUSTMENT_KIND_LABELS[r.kind]}</span> },
    { header: "Label", cell: (r) => <span className="text-sm">{r.label}{r.recurring ? " · recurring" : ""}</span> },
    { header: "Amount", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.amount)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={r.status === "active" ? "success" : "neutral"}>{r.status === "active" ? "Active" : "Ended"}</StatusPill> },
    {
      header: "Actions",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {canEdit && r.status === "active" && (
            <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending} onClick={() => run(() => endAdjustment(r.id), "Ended")}>End</Button>
          )}
          {canDelete && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending} onClick={() => run(() => deleteAdjustment(r.id), "Deleted")}>Del</Button>
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
              <CardTitle>New allowance / deduction</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Label htmlFor="aj-emp">Employee</Label>
                    <Select id="aj-emp" value={empKey} onChange={(e) => setEmpKey(e.target.value)}>
                      <option value="">— select employee —</option>
                      {employees.map((x) => <option key={`${x.type}:${x.id}`} value={`${x.type}:${x.id}`}>[{EMPLOYEE_TYPE_LABELS[x.type]}] {x.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="aj-kind">Kind</Label>
                    <Select id="aj-kind" value={kind} onChange={(e) => setKind(e.target.value as AdjustmentKind)}>
                      {ADJUSTMENT_KINDS.map((k) => <option key={k} value={k}>{ADJUSTMENT_KIND_LABELS[k]}</option>)}
                    </Select>
                  </div>
                  <div><Label htmlFor="aj-label">Label</Label><Input id="aj-label" placeholder="e.g. HRA, Uniform" value={label} onChange={(e) => setLabel(e.target.value)} required /></div>
                  <div><Label htmlFor="aj-amt">Amount</Label><Input id="aj-amt" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                  <div><Label htmlFor="aj-month">Effective month</Label><Input id="aj-month" type="date" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} /> Recurring
                    </label>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Create"}</Button>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : (
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New adjustment</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No allowances/deductions yet." />
    </div>
  );
}
