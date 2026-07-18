"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtDate } from "@/lib/format";
import {
  raiseBomAmendment,
  submitBomAmendment,
  approveBomAmendment,
  rejectBomAmendment,
  addBomAmendmentLine,
} from "@/lib/planning/amendment-actions";
import {
  AMENDMENT_STATUS_LABELS,
  BOM_KIND_LABELS,
  type AmendmentStatus,
} from "@/lib/planning/types";
import type {
  BomAmendmentWithRefs,
  BomPickerOption,
} from "@/lib/planning/amendment-service";

function statusTone(status: AmendmentStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "submitted":
      return "info";
    case "approved":
      return "success";
    case "rejected":
      return "danger";
  }
}

interface Props {
  amendments: BomAmendmentWithRefs[];
  boms: BomPickerOption[];
  canCreate: boolean;
  canEdit: boolean;
  canApprove: boolean;
}

export function BomAmendmentsClient({
  amendments,
  boms,
  canCreate,
  canEdit,
  canApprove,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingLine, setAddingLine] = useState(false);
  const [lineForm, setLineForm] = useState({ item_description: "", uom_id: "", original_qty: "", transfer_qty: "", transfer_wt: "", notes: "" });
  const [open, setOpen] = useState(false);
  useCreateIntent(() => setOpen(true));

  // bomKey encodes "kind:bom_id" so a single select can pick either family
  const [bomKey, setBomKey] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [reason, setReason] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        success(ok);
        router.refresh();
      } else {
        toastError(result.error ?? "Action failed");
      }
    });
  }

  function handleRaise(e: React.FormEvent) {
    e.preventDefault();
    const bom = boms.find((b) => `${b.bom_kind}:${b.bom_id}` === bomKey);
    if (!bom) {
      toastError("Select a BOM");
      return;
    }
    startTransition(async () => {
      const result = await raiseBomAmendment({
        bom_kind: bom.bom_kind,
        fabric_bom_id: bom.bom_kind === "fabric" ? bom.bom_id : null,
        material_bom_id: bom.bom_kind === "material" ? bom.bom_id : null,
        sales_order_id: bom.sales_order_id,
        change_summary: changeSummary,
        reason: reason || null,
      });
      if (result.ok) {
        success("Amendment raised");
        setBomKey("");
        setChangeSummary("");
        setReason("");
        setOpen(false);
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<BomAmendmentWithRefs>[] = [
    {
      header: "Amendment #",
      cell: (r) => <button type="button" className="font-mono text-xs font-medium text-primary hover:underline" onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}>{r.code ?? "—"}</button>,
    },
    {
      header: "BOM",
      cell: (r) => <span className="text-sm">{BOM_KIND_LABELS[r.bom_kind]}</span>,
    },
    {
      header: "Order",
      cell: (r) => (
        <span className="text-sm">{r.order_number ?? <span className="text-muted-foreground">—</span>}</span>
      ),
    },
    {
      header: "Change",
      cell: (r) => <span className="text-sm">{r.change_summary}</span>,
    },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={statusTone(r.status)}>{AMENDMENT_STATUS_LABELS[r.status]}</StatusPill>,
    },
    {
      header: "Raised",
      cell: (r) => <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(r.created_at)}</span>,
    },
    {
      header: "Actions",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {canEdit && r.status === "draft" && (
            <Button
              size="sm"
              variant="subtle"
              className="h-7 px-2 text-xs"
              disabled={isPending}
              onClick={() => run(() => submitBomAmendment(r.id), "Submitted")}
            >
              Submit
            </Button>
          )}
          {canApprove && r.status === "submitted" && (
            <>
              <Button
                size="sm"
                variant="subtle"
                className="h-7 px-2 text-xs"
                disabled={isPending}
                onClick={() => run(() => approveBomAmendment(r.id), "Approved")}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs text-danger hover:border-danger"
                disabled={isPending}
                onClick={() => run(() => rejectBomAmendment(r.id), "Rejected")}
              >
                Reject
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const submitted = amendments.filter((a) => a.status === "submitted");

  function TableFor({ rows }: { rows: BomAmendmentWithRefs[] }) {
    return <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No amendments in this view." />;
  }

  return (
    <div className="space-y-4">
      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>Raise a BOM amendment</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </CardHeader>
            <CardBody>
              {boms.length === 0 ? (
                <p className="text-sm text-muted-foreground">No BOMs available to amend.</p>
              ) : (
                <form onSubmit={handleRaise} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="bm-bom">BOM</Label>
                      <Select id="bm-bom" value={bomKey} onChange={(e) => setBomKey(e.target.value)}>
                        <option value="">— select BOM —</option>
                        {boms.map((b) => (
                          <option key={`${b.bom_kind}:${b.bom_id}`} value={`${b.bom_kind}:${b.bom_id}`}>
                            {BOM_KIND_LABELS[b.bom_kind]}
                            {b.order_number ? ` — ${b.order_number}` : ` — ${b.bom_id.slice(0, 8)}`}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="bm-summary">Change summary</Label>
                      <Input
                        id="bm-summary"
                        placeholder="e.g. Rib GSM 220 → 240, +5% loss on collar"
                        value={changeSummary}
                        onChange={(e) => setChangeSummary(e.target.value)}
                        required
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="bm-reason">Reason / notes</Label>
                      <Textarea
                        id="bm-reason"
                        rows={2}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={isPending}>
                      {isPending ? "Saving…" : "Raise amendment"}
                    </Button>
                  </div>
                </form>
              )}
            </CardBody>
          </Card>
        ) : (
          <div className="flex justify-end">
            <Button onClick={() => setOpen(true)}>Raise amendment</Button>
          </div>
        ))}

      <Tabs
        items={[
          { key: "toapprove", label: `To approve (${submitted.length})`, content: <TableFor rows={submitted} /> },
          { key: "all", label: `All (${amendments.length})`, content: <TableFor rows={amendments} /> },
        ]}
        defaultKey="toapprove"
      />

      {/* Amendment lines detail panel */}
      {selectedId && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Transfer Lines for: {amendments.find(a => a.id === selectedId)?.code ?? "—"}</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddingLine(!addingLine)}>{addingLine ? "Cancel" : "+ Add Line"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>Close</Button>
            </div>
          </div>
          {addingLine && (
            <div className="flex gap-2 items-end flex-wrap rounded border border-border p-3">
              <div><Label>Item</Label><Input className="w-32" value={lineForm.item_description} onChange={(e) => setLineForm({ ...lineForm, item_description: e.target.value })} /></div>
              <div><Label>UOM</Label><Input className="w-14" value={lineForm.uom_id} onChange={(e) => setLineForm({ ...lineForm, uom_id: e.target.value })} /></div>
              <div><Label>Orig Qty</Label><Input className="w-16" type="number" value={lineForm.original_qty} onChange={(e) => setLineForm({ ...lineForm, original_qty: e.target.value })} /></div>
              <div><Label>Xfr Qty</Label><Input className="w-16" type="number" value={lineForm.transfer_qty} onChange={(e) => setLineForm({ ...lineForm, transfer_qty: e.target.value })} /></div>
              <div><Label>Xfr Wt</Label><Input className="w-16" type="number" value={lineForm.transfer_wt} onChange={(e) => setLineForm({ ...lineForm, transfer_wt: e.target.value })} /></div>
              <div><Label>Notes</Label><Input className="w-24" value={lineForm.notes} onChange={(e) => setLineForm({ ...lineForm, notes: e.target.value })} /></div>
              <Button size="sm" disabled={isPending} onClick={() => startTransition(async () => {
                const res = await addBomAmendmentLine(selectedId, {
                  item_description: lineForm.item_description || null,
                  uom_id: lineForm.uom_id || null,
                  original_qty: Number(lineForm.original_qty) || 0,
                  transfer_qty: Number(lineForm.transfer_qty) || 0,
                  transfer_wt: Number(lineForm.transfer_wt) || 0,
                  notes: lineForm.notes || null,
                });
                if (res.ok) { success("Line added."); setAddingLine(false); setLineForm({ item_description: "", uom_id: "", original_qty: "", transfer_qty: "", transfer_wt: "", notes: "" }); router.refresh(); }
                else toastError(res.error);
              })}>{isPending ? "Adding…" : "Add"}</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
