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
import {
  createPieceRate,
  submitPieceRate,
  approvePieceRate,
  rejectPieceRate,
  deletePieceRate,
} from "@/lib/production/extras-actions";
import { PIECE_RATE_STATUS_LABELS, type PieceRateStatus } from "@/lib/production/extras-types";
import type { PieceRateWithRefs, ContractorOption, WorkTypeOption } from "@/lib/production/extras-service";

function tone(s: PieceRateStatus): StatusTone {
  return s === "draft" ? "neutral" : s === "submitted" ? "info" : s === "approved" ? "success" : "danger";
}

interface Props {
  rows: PieceRateWithRefs[];
  contractors: ContractorOption[];
  workTypes: WorkTypeOption[];
  canCreate: boolean;
  canEdit: boolean;
  canApprove: boolean;
  canDelete: boolean;
}

export function PieceRatesClient({ rows, contractors, workTypes, canCreate, canEdit, canApprove, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [contractorId, setContractorId] = useState("");
  const [workTypeId, setWorkTypeId] = useState("");
  const [operation, setOperation] = useState("");
  const [rate, setRate] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");

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
    startTransition(async () => {
      const r = await createPieceRate({
        contractor_id: contractorId || null,
        work_type_id: workTypeId || null,
        operation: operation || null,
        rate: parseFloat(rate) || 0,
        effective_date: effectiveDate || null,
      });
      if (r.ok) {
        success("Piece rate created");
        setContractorId(""); setWorkTypeId(""); setOperation(""); setRate(""); setEffectiveDate("");
        setOpen(false);
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<PieceRateWithRefs>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Contractor", cell: (r) => <span className="text-sm">{r.contractor_name ?? "—"}</span> },
    { header: "Work type / op", cell: (r) => <span className="text-sm">{r.work_type_name ?? r.operation ?? "—"}</span> },
    { header: "Rate", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.rate)}</span> },
    { header: "Effective", cell: (r) => <span className="tabular-nums text-sm">{fmtDate(r.effective_date)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{PIECE_RATE_STATUS_LABELS[r.status]}</StatusPill> },
    {
      header: "Actions",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {canEdit && r.status === "draft" && (
            <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending} onClick={() => run(() => submitPieceRate(r.id), "Submitted")}>Submit</Button>
          )}
          {canApprove && r.status === "submitted" && (
            <>
              <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending} onClick={() => run(() => approvePieceRate(r.id), "Approved")}>Approve</Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending} onClick={() => run(() => rejectPieceRate(r.id), "Rejected")}>Reject</Button>
            </>
          )}
          {canDelete && (r.status === "draft" || r.status === "rejected") && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending} onClick={() => run(() => deletePieceRate(r.id), "Deleted")}>Del</Button>
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
              <CardTitle>New piece rate</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label htmlFor="pr-contractor">Contractor</Label>
                    <Select id="pr-contractor" value={contractorId} onChange={(e) => setContractorId(e.target.value)}>
                      <option value="">— none —</option>
                      {contractors.map((c) => <option key={c.id} value={c.id}>{c.code ? `${c.code} — ` : ""}{c.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="pr-wt">Work type</Label>
                    <Select id="pr-wt" value={workTypeId} onChange={(e) => setWorkTypeId(e.target.value)}>
                      <option value="">— none —</option>
                      {workTypes.map((w) => <option key={w.id} value={w.id}>{w.code ? `${w.code} — ` : ""}{w.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="pr-op">Operation (free text)</Label>
                    <Input id="pr-op" value={operation} onChange={(e) => setOperation(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="pr-rate">Rate</Label>
                    <Input id="pr-rate" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="pr-date">Effective date</Label>
                    <Input id="pr-date" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
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
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New piece rate</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No piece rates yet." />
    </div>
  );
}
