"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtDate, fmtNumber } from "@/lib/format";
import { issueJob, recordReceipt, closeJob } from "@/lib/process/actions";
import {
  QUALITY_STATUSES,
  processLoss,
  lossVarianceVsBom,
  type ProcessJobReceipt,
  type QualityStatus,
} from "@/lib/process/types";
import type { StatusTone } from "@/components/ui/status-pill";

// ---------- receipt row type (plain, serialisable from server) ----------

type ReceiptRow = ProcessJobReceipt;

// ---------- helpers ----------

function qualityTone(qs: QualityStatus): StatusTone {
  switch (qs) {
    case "passed":
      return "success";
    case "failed":
      return "danger";
    case "partial":
      return "warning";
  }
}

const QUALITY_LABELS: Record<QualityStatus, string> = {
  passed: "Passed",
  failed: "Failed",
  partial: "Partial",
};

// ---------- main component ----------

interface Props {
  jobId: string;
  sentQty: number;
  plannedLossPct: number;
  receipts: ReceiptRow[];
  canIssue: boolean;
  canRecordReceipt: boolean;
  canClose: boolean;
}

export function JobActions({
  jobId,
  sentQty,
  plannedLossPct,
  receipts,
  canIssue,
  canRecordReceipt,
  canClose,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [receiptFormOpen, setReceiptFormOpen] = useState(false);

  // receipt form state
  const [receivedDate, setReceivedDate] = useState("");
  const [receivedQty, setReceivedQty] = useState("");
  const [goodQty, setGoodQty] = useState("");
  const [rejectedQty, setRejectedQty] = useState("");
  const [qualityStatus, setQualityStatus] = useState<QualityStatus>("passed");
  const [qualityNotes, setQualityNotes] = useState("");

  function resetReceiptForm() {
    setReceivedDate("");
    setReceivedQty("");
    setGoodQty("");
    setRejectedQty("");
    setQualityStatus("passed");
    setQualityNotes("");
  }

  // Build receipt columns with cumulative running total for loss display
  type ReceiptWithCumulative = ReceiptRow & { _cumulative: number };
  const receiptsWithCumulative: ReceiptWithCumulative[] = receipts.reduce<
    ReceiptWithCumulative[]
  >((acc, r) => {
    const prev = acc.length > 0 ? acc[acc.length - 1]._cumulative : 0;
    acc.push({ ...r, _cumulative: prev + (r.received_qty ?? 0) });
    return acc;
  }, []);

  const receiptColumns: Column<ReceiptWithCumulative>[] = [
    {
      header: "Received date",
      cell: (r) => (
        <span className="tabular-nums text-sm">{fmtDate(r.received_date)}</span>
      ),
    },
    {
      header: "Received qty",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">{fmtNumber(r.received_qty)}</span>
      ),
    },
    {
      header: "Good qty",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">{fmtNumber(r.good_qty)}</span>
      ),
    },
    {
      header: "Rejected qty",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">{fmtNumber(r.rejected_qty)}</span>
      ),
    },
    {
      header: "Quality",
      cell: (r) => (
        <StatusPill tone={qualityTone(r.quality_status)}>
          {QUALITY_LABELS[r.quality_status]}
        </StatusPill>
      ),
    },
    {
      header: "Loss qty (vs BOM)",
      align: "right",
      cell: (r) => {
        const lossQty = processLoss(sentQty, r._cumulative);
        const variance = lossVarianceVsBom(sentQty, lossQty, plannedLossPct);
        return (
          <span
            className={`tabular-nums text-sm${variance > 0 ? " font-medium text-danger" : ""}`}
          >
            {fmtNumber(lossQty)}
            {variance > 0 && (
              <span className="ml-1 text-xs">
                (+{variance.toFixed(1)}%)
              </span>
            )}
          </span>
        );
      },
    },
    {
      header: "Notes",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">{r.quality_notes ?? "—"}</span>
      ),
    },
  ];

  // ---------- handlers ----------

  function handleIssue() {
    startTransition(async () => {
      const result = await issueJob(jobId);
      if (result.ok) {
        success("Job issued to processor");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleClose() {
    startTransition(async () => {
      const result = await closeJob(jobId);
      if (result.ok) {
        success("Job closed");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  function handleRecordReceipt(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await recordReceipt({
        process_job_id: jobId,
        received_date: receivedDate || null,
        received_qty: parseFloat(receivedQty) || 0,
        good_qty: parseFloat(goodQty) || 0,
        rejected_qty: parseFloat(rejectedQty) || 0,
        quality_status: qualityStatus,
        quality_notes: qualityNotes || null,
      });
      if (result.ok) {
        success("Receipt recorded");
        resetReceiptForm();
        setReceiptFormOpen(false);
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Receipts card */}
      <Card>
        <CardHeader>
          <CardTitle>Receipts ({receipts.length})</CardTitle>
          {canRecordReceipt && !receiptFormOpen && (
            <Button
              size="sm"
              variant="subtle"
              onClick={() => setReceiptFormOpen(true)}
            >
              + Record receipt
            </Button>
          )}
        </CardHeader>
        <CardBody className="p-0">
          <DataTable
            columns={receiptColumns}
            rows={receiptsWithCumulative}
            getKey={(r) => r.id}
            empty="No receipts yet — record one when material returns from the processor."
          />
        </CardBody>
      </Card>

      {/* Record receipt form */}
      {receiptFormOpen && canRecordReceipt && (
        <Card>
          <CardHeader>
            <CardTitle>Record receipt</CardTitle>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleRecordReceipt} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <Label htmlFor="rc-date">Received date</Label>
                  <Input
                    id="rc-date"
                    type="date"
                    value={receivedDate}
                    onChange={(e) => setReceivedDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="rc-rcvd">Received qty</Label>
                  <Input
                    id="rc-rcvd"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0"
                    value={receivedQty}
                    onChange={(e) => setReceivedQty(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="rc-good">Good qty</Label>
                  <Input
                    id="rc-good"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0"
                    value={goodQty}
                    onChange={(e) => setGoodQty(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="rc-rej">Rejected qty</Label>
                  <Input
                    id="rc-rej"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0"
                    value={rejectedQty}
                    onChange={(e) => setRejectedQty(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="rc-quality">Quality status</Label>
                  <Select
                    id="rc-quality"
                    value={qualityStatus}
                    onChange={(e) => setQualityStatus(e.target.value as QualityStatus)}
                  >
                    {QUALITY_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {QUALITY_LABELS[s]}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor="rc-notes">Quality notes</Label>
                <Textarea
                  id="rc-notes"
                  placeholder="Any observations or quality remarks…"
                  value={qualityNotes}
                  onChange={(e) => setQualityNotes(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending ? "Saving…" : "Record receipt"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setReceiptFormOpen(false);
                    resetReceiptForm();
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {/* Issue / Close action buttons */}
      {(canIssue || canClose) && (
        <div className="flex gap-2">
          {canIssue && (
            <Button onClick={handleIssue} disabled={isPending}>
              {isPending ? "Issuing…" : "Issue to processor"}
            </Button>
          )}
          {canClose && (
            <Button variant="outline" onClick={handleClose} disabled={isPending}>
              {isPending ? "Closing…" : "Close job"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
