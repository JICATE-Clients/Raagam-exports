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
import { fmtNumber, fmtDate } from "@/lib/format";
import {
  raiseBudgetAmendment,
  submitBudgetAmendment,
  approveBudgetAmendment,
  rejectBudgetAmendment,
} from "@/lib/planning/amendment-actions";
import {
  AMENDMENT_STATUS_LABELS,
  type AmendmentStatus,
} from "@/lib/planning/types";
import type {
  BudgetAmendmentWithRefs,
  ApprovedBudgetOption,
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
  amendments: BudgetAmendmentWithRefs[];
  budgets: ApprovedBudgetOption[];
  canCreate: boolean;
  canEdit: boolean;
  canApprove: boolean;
}

export function BudgetAmendmentsClient({
  amendments,
  budgets,
  canCreate,
  canEdit,
  canApprove,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [budgetId, setBudgetId] = useState("");
  const [revisedTotal, setRevisedTotal] = useState("");
  const [reason, setReason] = useState("");

  const selectedBudget = budgets.find((b) => b.id === budgetId) ?? null;

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
    if (!budgetId) {
      toastError("Select a budget");
      return;
    }
    startTransition(async () => {
      const result = await raiseBudgetAmendment({
        budget_id: budgetId,
        revised_total: parseFloat(revisedTotal) || 0,
        reason,
      });
      if (result.ok) {
        success("Amendment raised");
        setBudgetId("");
        setRevisedTotal("");
        setReason("");
        setOpen(false);
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  const columns: Column<BudgetAmendmentWithRefs>[] = [
    {
      header: "Amendment #",
      cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span>,
    },
    {
      header: "Budget",
      cell: (r) => (
        <span className="text-sm">
          {r.budget_code ? `${r.budget_code} — ` : ""}
          {r.budget_name ?? "—"}
        </span>
      ),
    },
    {
      header: "Previous",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.previous_total)}</span>,
    },
    {
      header: "Revised",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm font-semibold">{fmtNumber(r.revised_total)}</span>,
    },
    {
      header: "Δ",
      align: "right",
      cell: (r) => {
        const delta = r.revised_total - r.previous_total;
        const tone = delta > 0 ? "text-danger" : delta < 0 ? "text-success" : "text-muted-foreground";
        return (
          <span className={`tabular-nums text-sm ${tone}`}>
            {delta > 0 ? "+" : ""}
            {fmtNumber(delta)}
          </span>
        );
      },
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
              onClick={() => run(() => submitBudgetAmendment(r.id), "Submitted")}
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
                onClick={() => run(() => approveBudgetAmendment(r.id), "Approved — budget total updated")}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs text-danger hover:border-danger"
                disabled={isPending}
                onClick={() => run(() => rejectBudgetAmendment(r.id), "Rejected")}
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

  function TableFor({ rows }: { rows: BudgetAmendmentWithRefs[] }) {
    return <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No amendments in this view." />;
  }

  return (
    <div className="space-y-4">
      {canCreate &&
        (open ? (
          <Card>
            <CardHeader>
              <CardTitle>Raise a budget amendment</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </CardHeader>
            <CardBody>
              {budgets.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No approved budgets available to amend.
                </p>
              ) : (
                <form onSubmit={handleRaise} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <Label htmlFor="ba-budget">Approved budget</Label>
                      <Select id="ba-budget" value={budgetId} onChange={(e) => setBudgetId(e.target.value)}>
                        <option value="">— select budget —</option>
                        {budgets.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.code ? `${b.code} — ` : ""}{b.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label>Current total</Label>
                      <div className="flex h-9 items-center px-2 text-sm tabular-nums text-muted-foreground">
                        {selectedBudget ? fmtNumber(selectedBudget.total_amount) : "—"}
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="ba-revised">Revised total</Label>
                      <Input
                        id="ba-revised"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={revisedTotal}
                        onChange={(e) => setRevisedTotal(e.target.value)}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label htmlFor="ba-reason">Reason</Label>
                      <Input
                        id="ba-reason"
                        placeholder="Why revise?"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        required
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
