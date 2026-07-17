"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import {
  createPpmCancellation,
  approvePpmCancellation,
  rejectPpmCancellation,
  deletePpmCancellation,
} from "@/lib/planning/extras-actions";
import {
  PPM_CANCELLATION_STATUS_LABELS,
  type PpmCancellationStatus,
} from "@/lib/planning/types";
import type {
  PpmCancellationWithRefs,
  PpmPickerOption,
} from "@/lib/planning/extras-service";

function tone(s: PpmCancellationStatus): StatusTone {
  return s === "approved" ? "success" : s === "rejected" ? "danger" : "neutral";
}

interface Props {
  rows: PpmCancellationWithRefs[];
  ppms: PpmPickerOption[];
  canCreate: boolean;
  canApprove: boolean;
  canDelete: boolean;
}

export function PpmCancellationsClient({ rows, ppms, canCreate, canApprove, canDelete }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  const [ppmId, setPpmId] = useState("");
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
    startTransition(async () => {
      const r = await createPpmCancellation({ ppm_issue_id: ppmId, reason });
      if (r.ok) {
        success("Cancellation raised");
        setPpmId(""); setReason(""); setOpen(false);
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<PpmCancellationWithRefs>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "PPM", cell: (r) => <span className="font-mono text-xs">{r.ppm_code ?? "—"}</span> },
    { header: "Reason", cell: (r) => <span className="text-sm">{r.reason}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{PPM_CANCELLATION_STATUS_LABELS[r.status]}</StatusPill> },
    {
      header: "Actions",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {canApprove && r.status === "draft" && (
            <>
              <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending}
                onClick={() => run(() => approvePpmCancellation(r.id), "Approved — PPM cancelled")}>Approve</Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={isPending}
                onClick={() => run(() => rejectPpmCancellation(r.id), "Rejected")}>Reject</Button>
            </>
          )}
          {canDelete && (r.status === "draft" || r.status === "rejected") && (
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending}
              onClick={() => run(() => deletePpmCancellation(r.id), "Deleted")}>Del</Button>
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
              <CardTitle>New PPM cancellation</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="pc-ppm">Issued PPM</Label>
                    <Select id="pc-ppm" value={ppmId} onChange={(e) => setPpmId(e.target.value)} required>
                      <option value="">— select —</option>
                      {ppms.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code ?? p.id.slice(0, 8)}{p.order_number ? ` · ${p.order_number}` : ""}
                        </option>
                      ))}
                    </Select>
                    {ppms.length === 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">No issued PPMs available to cancel.</p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="pc-reason">Reason</Label>
                    <Textarea id="pc-reason" value={reason} onChange={(e) => setReason(e.target.value)} required rows={2} />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={isPending || ppms.length === 0}>{isPending ? "Saving…" : "Raise"}</Button>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : (
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>New cancellation</Button></div>
        ))}
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No PPM cancellations yet." />
    </div>
  );
}
