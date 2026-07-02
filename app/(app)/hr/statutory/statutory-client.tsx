"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtDate } from "@/lib/format";
import { createStatutory, fileStatutory, deleteStatutory } from "@/lib/hr/extras-actions";
import {
  STATUTORY_FORM_TYPES,
  STATUTORY_FORM_LABELS,
  EMPLOYEE_TYPE_LABELS,
  type StatutoryFormType,
} from "@/lib/hr/extras-types";
import type { HrStatutoryDoc } from "@/lib/hr/extras-types";
import type { EmployeeOption } from "@/lib/hr/extras-service";

interface Props {
  rows: HrStatutoryDoc[];
  employees: EmployeeOption[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export function StatutoryClient({ rows, employees, canCreate, canEdit, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [empKey, setEmpKey] = useState("");
  const [formType, setFormType] = useState<StatutoryFormType>("esi_form3");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");

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
      const r = await createStatutory({
        employee_type: emp.type,
        employee_id: emp.id,
        employee_name: emp.name,
        form_type: formType,
        reference_no: reference || null,
        doc_date: date || null,
        notes: notes || null,
      });
      if (r.ok) {
        success("Document created");
        setEmpKey(""); setFormType("esi_form3"); setReference(""); setDate(""); setNotes("");
        setOpen(false);
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<HrStatutoryDoc>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Employee", cell: (r) => <span className="text-sm">{r.employee_name ?? "—"} <span className="text-xs text-muted-foreground">({EMPLOYEE_TYPE_LABELS[r.employee_type]})</span></span> },
    { header: "Form", cell: (r) => <span className="text-sm">{STATUTORY_FORM_LABELS[r.form_type]}</span> },
    { header: "Reference", cell: (r) => <span className="text-sm">{r.reference_no ?? "—"}</span> },
    { header: "Date", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.doc_date)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={r.status === "filed" ? "success" : "neutral"}>{r.status === "filed" ? "Filed" : "Draft"}</StatusPill> },
    {
      header: "Actions",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {canEdit && r.status === "draft" && (
            <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending} onClick={() => run(() => fileStatutory(r.id), "Marked filed")}>File</Button>
          )}
          {canDelete && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending} onClick={() => run(() => deleteStatutory(r.id), "Deleted")}>Del</Button>
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
              <CardTitle>New statutory document</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Label htmlFor="st-emp">Employee</Label>
                    <Select id="st-emp" value={empKey} onChange={(e) => setEmpKey(e.target.value)}>
                      <option value="">— select employee —</option>
                      {employees.map((x) => <option key={`${x.type}:${x.id}`} value={`${x.type}:${x.id}`}>[{EMPLOYEE_TYPE_LABELS[x.type]}] {x.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="st-form">Form type</Label>
                    <Select id="st-form" value={formType} onChange={(e) => setFormType(e.target.value as StatutoryFormType)}>
                      {STATUTORY_FORM_TYPES.map((f) => <option key={f} value={f}>{STATUTORY_FORM_LABELS[f]}</option>)}
                    </Select>
                  </div>
                  <div><Label htmlFor="st-ref">Reference no.</Label><Input id="st-ref" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
                  <div><Label htmlFor="st-date">Date</Label><Input id="st-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                  <div className="sm:col-span-2 lg:col-span-3"><Label htmlFor="st-notes">Notes</Label><Input id="st-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Create"}</Button>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : (
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New document</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No statutory documents yet." />
    </div>
  );
}
