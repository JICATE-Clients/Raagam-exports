"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtNumber } from "@/lib/format";
import {
  raiseRateAmendment,
  submitRateAmendment,
  approveRateAmendment,
  rejectRateAmendment,
} from "@/lib/purchase/extras-actions";
import {
  PUR_APPROVAL_STATUS_LABELS,
  type PurApprovalStatus,
} from "@/lib/purchase/extras-types";
import type { RateAmendmentWithRefs, PoWithLines } from "@/lib/purchase/extras-service";

function tone(s: PurApprovalStatus): StatusTone {
  return s === "draft" ? "neutral" : s === "submitted" ? "info" : s === "approved" ? "success" : "danger";
}

interface Props {
  rows: RateAmendmentWithRefs[];
  pos: PoWithLines[];
  canCreate: boolean;
  canEdit: boolean;
  canApprove: boolean;
}

export function RateAmendmentsClient({ rows, pos, canCreate, canEdit, canApprove }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [poId, setPoId] = useState("");
  const [lineId, setLineId] = useState("");
  const [revisedRate, setRevisedRate] = useState("");
  const [reason, setReason] = useState("");

  const selectedPo = pos.find((p) => p.id === poId) ?? null;
  const selectedLine = selectedPo?.lines.find((l) => l.id === lineId) ?? null;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        success(ok);
        router.refresh();
      } else toastError(r.error ?? "Action failed");
    });
  }

  function handleRaise(e: React.FormEvent) {
    e.preventDefault();
    if (!poId || !lineId) {
      toastError("Select a PO and line");
      return;
    }
    startTransition(async () => {
      const r = await raiseRateAmendment({
        purchase_order_id: poId,
        po_line_item_id: lineId,
        revised_rate: parseFloat(revisedRate) || 0,
        reason,
      });
      if (r.ok) {
        success("Amendment raised");
        setPoId(""); setLineId(""); setRevisedRate(""); setReason("");
        setOpen(false);
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<RateAmendmentWithRefs>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "PO", cell: (r) => <span className="text-sm">{r.po_code ?? "—"}</span> },
    { header: "Previous", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.previous_rate)}</span> },
    { header: "Revised", align: "right", cell: (r) => <span className="tabular-nums text-sm font-semibold">{fmtNumber(r.revised_rate)}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{PUR_APPROVAL_STATUS_LABELS[r.status]}</StatusPill> },
    {
      header: "Actions",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {canEdit && r.status === "draft" && (
            <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending}
              onClick={() => run(() => submitRateAmendment(r.id), "Submitted")}>Submit</Button>
          )}
          {canApprove && r.status === "submitted" && (
            <>
              <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending}
                onClick={() => run(() => approveRateAmendment(r.id), "Approved — PO updated")}>Approve</Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending}
                onClick={() => run(() => rejectRateAmendment(r.id), "Rejected")}>Reject</Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const submitted = rows.filter((r) => r.status === "submitted");
  const Table = ({ data }: { data: RateAmendmentWithRefs[] }) => (
    <DataTable columns={columns} rows={data} getKey={(r) => r.id} empty="Nothing here." />
  );

  return (
    <div className="space-y-4">
      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>Raise rate amendment</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              {pos.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active POs with lines to amend.</p>
              ) : (
                <form onSubmit={handleRaise} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <Label htmlFor="ra-po">Purchase order</Label>
                      <Select id="ra-po" value={poId} onChange={(e) => { setPoId(e.target.value); setLineId(""); }}>
                        <option value="">— select PO —</option>
                        {pos.map((p) => <option key={p.id} value={p.id}>{p.code ?? p.id.slice(0, 8)}</option>)}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="ra-line">Line</Label>
                      <Select id="ra-line" value={lineId} onChange={(e) => setLineId(e.target.value)} disabled={!selectedPo}>
                        <option value="">— select line —</option>
                        {(selectedPo?.lines ?? []).map((l) => <option key={l.id} value={l.id}>{l.description}</option>)}
                      </Select>
                    </div>
                    <div>
                      <Label>Current rate</Label>
                      <div className="flex h-9 items-center px-2 text-sm tabular-nums text-muted-foreground">
                        {selectedLine ? fmtNumber(selectedLine.unit_price) : "—"}
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="ra-rate">Revised rate</Label>
                      <Input id="ra-rate" type="number" min="0" step="0.01" value={revisedRate} onChange={(e) => setRevisedRate(e.target.value)} />
                    </div>
                    <div className="sm:col-span-2 lg:col-span-4">
                      <Label htmlFor="ra-reason">Reason</Label>
                      <Input id="ra-reason" value={reason} onChange={(e) => setReason(e.target.value)} required />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Raise"}</Button>
                  </div>
                </form>
              )}
            </CardBody>
          </Card>
        ) : (
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>Raise amendment</Button></div>
        ))}

      <Tabs
        items={[
          { key: "toapprove", label: `To approve (${submitted.length})`, content: <Table data={submitted} /> },
          { key: "all", label: `All (${rows.length})`, content: <Table data={rows} /> },
        ]}
        defaultKey="toapprove"
      />
    </div>
  );
}
