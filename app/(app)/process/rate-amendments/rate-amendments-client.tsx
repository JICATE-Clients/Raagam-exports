"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import {
  createRateAmendment,
  approveRateAmendment,
  rejectRateAmendment,
} from "@/lib/process/rate-amendments/actions";
import {
  PRA_STATUS_LABELS,
  praStatusTone,
} from "@/lib/process/rate-amendments/types";
import type {
  RateAmendmentRow,
  ConfirmedRfqOption,
} from "@/lib/process/rate-amendments/service";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtNumber } from "@/lib/format";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";

interface Props {
  amendments: RateAmendmentRow[];
  confirmedRfqs: ConfirmedRfqOption[];
  canCreate: boolean;
  canApprove: boolean;
  canExport?: boolean;
}

export function RateAmendmentsClient({
  amendments,
  confirmedRfqs,
  canCreate,
  canApprove,
  canExport = false,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [formOpen, setFormOpen] = useState(false);
  useCreateIntent(() => setFormOpen(true));
  const [rfqId, setRfqId] = useState("");
  const [newRate, setNewRate] = useState("");
  const [reason, setReason] = useState("");
  const [rejectForm, setRejectForm] = useState<{ id: string; reason: string } | null>(null);

  const selectedRfq = confirmedRfqs.find((r) => r.id === rfqId);

  function resetForm() {
    setRfqId("");
    setNewRate("");
    setReason("");
    setFormOpen(false);
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createRateAmendment({
        process_rfq_id: rfqId,
        new_rate: Number(newRate) || 0,
        reason: reason.trim() || null,
      });
      if (result.ok) {
        success("Amendment raised");
        resetForm();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleApprove(id: string) {
    startTransition(async () => {
      const result = await approveRateAmendment(id);
      if (result.ok) {
        success("Approved — new rate applied");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleReject() {
    if (!rejectForm) return;
    const { id, reason } = rejectForm;
    startTransition(async () => {
      const result = await rejectRateAmendment(id, reason);
      if (result.ok) {
        success("Amendment rejected");
        setRejectForm(null);
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<RateAmendmentRow>[] = [
    { header: "Code", cell: (a) => <span className="font-mono text-xs font-medium">{a.code ?? "—"}</span> },
    { header: "Process order", cell: (a) => <span className="font-mono text-xs">{a.process_rfqs?.code ?? "—"}</span> },
    {
      header: "Rate change",
      align: "right",
      cell: (a) => (
        <span className="tabular-nums text-sm">
          {a.old_rate != null ? fmtNumber(a.old_rate) : "—"}
          <span className="mx-1 text-muted-foreground">→</span>
          <strong>{fmtNumber(a.new_rate)}</strong>
        </span>
      ),
    },
    { header: "Reason", cell: (a) => <span className="text-sm text-muted-foreground">{a.reason ?? "—"}</span> },
    { header: "Status", cell: (a) => <StatusPill tone={praStatusTone(a.status)}>{PRA_STATUS_LABELS[a.status]}</StatusPill> },
    ...(canApprove
      ? [
          {
            header: "Action",
            cell: (a: RateAmendmentRow) => {
              if (a.status !== "pending") return null;
              if (rejectForm?.id === a.id) {
                return (
                  <div className="flex flex-col gap-1.5">
                    <Input
                      placeholder="Reason for rejection"
                      value={rejectForm.reason}
                      onChange={(e) => setRejectForm((f) => (f ? { ...f, reason: e.target.value } : null))}
                      className="h-7 w-44 text-xs"
                      autoFocus
                    />
                    <div className="flex gap-1">
                      <Button size="sm" variant="danger" onClick={handleReject} disabled={isPending} className="h-7 text-xs">
                        Confirm
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRejectForm(null)} className="h-7 text-xs">
                        Cancel
                      </Button>
                    </div>
                  </div>
                );
              }
              return (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="subtle" onClick={() => handleApprove(a.id)} disabled={isPending} className="h-7 text-xs">
                    Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRejectForm({ id: a.id, reason: "" })} className="h-7 text-xs">
                    Reject
                  </Button>
                </div>
              );
            },
          } satisfies Column<RateAmendmentRow>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <DataIoToolbar entityKey="process_rate_amendments" rows={amendments} canExport={canExport} />
      {canCreate && (
        <div className="flex justify-end">
          {formOpen ? (
            <Button variant="outline" size="sm" onClick={resetForm}>
              Cancel
            </Button>
          ) : (
            <Button onClick={() => setFormOpen(true)}>New amendment</Button>
          )}
        </div>
      )}

      {canCreate && formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>New rate amendment</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="ra-rfq">Confirmed process order *</Label>
                <Select id="ra-rfq" value={rfqId} onChange={(e) => setRfqId(e.target.value)} required>
                  <option value="">— select —</option>
                  {confirmedRfqs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code ?? r.id.slice(0, 8)} — {r.process_type} (@{r.confirmed_rate ?? 0})
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="ra-rate">
                  New rate {selectedRfq ? `(was ${selectedRfq.confirmed_rate ?? 0})` : ""}
                </Label>
                <Input id="ra-rate" type="number" min="0" step="0.0001" value={newRate} onChange={(e) => setNewRate(e.target.value)} placeholder="0.00" required />
              </div>
              <div>
                <Label htmlFor="ra-reason">Reason</Label>
                <Input id="ra-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={isPending || !rfqId}>
                  {isPending ? "Saving…" : "Raise amendment"}
                </Button>
              </div>
            </form>
            {confirmedRfqs.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                No confirmed process orders yet — confirm a Process RFQ first.
              </p>
            )}
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={amendments}
        getKey={(a) => a.id}
        empty="No rate amendments yet."
      />
    </div>
  );
}
