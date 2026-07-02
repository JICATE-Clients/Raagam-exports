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
  raiseOverBudget,
  submitOverBudget,
  approveOverBudget,
  rejectOverBudget,
} from "@/lib/purchase/extras-actions";
import {
  PUR_APPROVAL_STATUS_LABELS,
  variancePct,
  type PurApprovalStatus,
} from "@/lib/purchase/extras-types";
import type { OverBudgetWithRefs, PoOption } from "@/lib/purchase/extras-service";

function tone(s: PurApprovalStatus): StatusTone {
  return s === "draft" ? "neutral" : s === "submitted" ? "info" : s === "approved" ? "success" : "danger";
}

interface Props {
  rows: OverBudgetWithRefs[];
  pos: PoOption[];
  canCreate: boolean;
  canEdit: boolean;
  canApprove: boolean;
}

export function OverBudgetClient({ rows, pos, canCreate, canEdit, canApprove }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [poId, setPoId] = useState("");
  const [description, setDescription] = useState("");
  const [budgetRate, setBudgetRate] = useState("");
  const [quotedRate, setQuotedRate] = useState("");
  const [reason, setReason] = useState("");

  const preview = variancePct(parseFloat(budgetRate) || 0, parseFloat(quotedRate) || 0);

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
    startTransition(async () => {
      const r = await raiseOverBudget({
        purchase_order_id: poId || null,
        description,
        budget_rate: parseFloat(budgetRate) || 0,
        quoted_rate: parseFloat(quotedRate) || 0,
        reason: reason || null,
      });
      if (r.ok) {
        success("Confirmation raised");
        setPoId(""); setDescription(""); setBudgetRate(""); setQuotedRate(""); setReason("");
        setOpen(false);
        router.refresh();
      } else toastError(r.error);
    });
  }

  const columns: Column<OverBudgetWithRefs>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "PO", cell: (r) => <span className="text-sm">{r.po_code ?? "—"}</span> },
    { header: "Description", cell: (r) => <span className="text-sm">{r.description}</span> },
    { header: "Budget", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.budget_rate)}</span> },
    { header: "Quoted", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.quoted_rate)}</span> },
    { header: "Variance", align: "right", cell: (r) => <span className="tabular-nums text-sm font-semibold text-danger">{fmtNumber(r.variance_pct)}%</span> },
    { header: "Status", cell: (r) => <StatusPill tone={tone(r.status)}>{PUR_APPROVAL_STATUS_LABELS[r.status]}</StatusPill> },
    {
      header: "Actions",
      cell: (r) => (
        <div className="flex flex-wrap gap-1">
          {canEdit && r.status === "draft" && (
            <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending}
              onClick={() => run(() => submitOverBudget(r.id), "Submitted")}>Submit</Button>
          )}
          {canApprove && r.status === "submitted" && (
            <>
              <Button size="sm" variant="subtle" className="h-7 px-2 text-xs" disabled={isPending}
                onClick={() => run(() => approveOverBudget(r.id), "Approved")}>Approve</Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-danger hover:border-danger" disabled={isPending}
                onClick={() => run(() => rejectOverBudget(r.id), "Rejected")}>Reject</Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const submitted = rows.filter((r) => r.status === "submitted");
  const Table = ({ data }: { data: OverBudgetWithRefs[] }) => (
    <DataTable columns={columns} rows={data} getKey={(r) => r.id} empty="Nothing here." />
  );

  return (
    <div className="space-y-4">
      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>Raise over-budget confirmation</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </CardHeader>
            <CardBody>
              <form onSubmit={handleRaise} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label htmlFor="ob-po">Purchase order (optional)</Label>
                    <Select id="ob-po" value={poId} onChange={(e) => setPoId(e.target.value)}>
                      <option value="">— none —</option>
                      {pos.map((p) => <option key={p.id} value={p.id}>{p.code ?? p.id.slice(0, 8)}{p.vendor_name ? ` — ${p.vendor_name}` : ""}</option>)}
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="ob-desc">Description</Label>
                    <Input id="ob-desc" value={description} onChange={(e) => setDescription(e.target.value)} required />
                  </div>
                  <div>
                    <Label htmlFor="ob-budget">Budget rate</Label>
                    <Input id="ob-budget" type="number" min="0" step="0.01" value={budgetRate} onChange={(e) => setBudgetRate(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="ob-quoted">Quoted rate</Label>
                    <Input id="ob-quoted" type="number" min="0" step="0.01" value={quotedRate} onChange={(e) => setQuotedRate(e.target.value)} />
                  </div>
                  <div>
                    <Label>Variance (auto)</Label>
                    <div className="flex h-9 items-center px-2 text-sm font-semibold tabular-nums text-danger">
                      {fmtNumber(preview)}%
                    </div>
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <Label htmlFor="ob-reason">Reason</Label>
                    <Input id="ob-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : "Raise"}</Button>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : (
          <div className="flex justify-end"><Button onClick={() => setOpen(true)}>Raise confirmation</Button></div>
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
