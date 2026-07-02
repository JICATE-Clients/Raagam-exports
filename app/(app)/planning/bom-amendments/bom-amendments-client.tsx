"use client";

import { useState, useTransition } from "react";
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
  const [open, setOpen] = useState(false);

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
      cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span>,
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
    </div>
  );
}
