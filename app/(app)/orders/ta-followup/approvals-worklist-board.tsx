"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, History, RotateCcw, Send, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { acquireBusy } from "@/lib/reload-guard";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  markApprovalSent,
  markApprovalApproved,
  markApprovalRework,
  getApprovalHistory,
  type ApprovalHistoryEntry,
} from "@/lib/ta/approvals-worklist-actions";
import type { ApprovalWorklistRow } from "@/lib/ta/approvals-worklist";

const BUCKET = "order-approval-docs";

/**
 * The Approvals Worklist's rows — same shape as `ta-worklist`'s own board
 * (a card is an instruction, not a table row; buttons, not a form; no
 * keyboard-contract surface because nothing here is typed except the Rework
 * remarks, which gets its own small inline control). See that file's header
 * for the full reasoning; this one only records what is DIFFERENT.
 *
 * WHAT'S DIFFERENT: three actions instead of three-plus-undo (Sent, Approved,
 * Rework — there is no "undo Sent" because a rejected sample is REWORK, not a
 * mistake to unclick), an optional file attached on Sent, and a History link
 * once `activeVersion > 1`.
 */
export function ApprovalsWorklistBoard({
  rows,
  canComplete,
}: {
  rows: ApprovalWorklistRow[];
  canComplete: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reworkId, setReworkId] = useState<string | null>(null);
  const [historyRow, setHistoryRow] = useState<ApprovalWorklistRow | null>(null);
  const { success, error } = useToast();

  useEffect(() => {
    if (!pending) return;
    return acquireBusy();
  }, [pending]);

  const run = (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusyId(id);
    startTransition(async () => {
      const res = await fn();
      setBusyId(null);
      if (res.ok) success(done);
      else error(res.error ?? "Could not save");
    });
  };

  async function sendWithOptionalProof(row: ApprovalWorklistRow, file: File | null) {
    if (!file) {
      run(row.id, () => markApprovalSent(row.id), "Marked sent");
      return;
    }
    setBusyId(row.id);
    startTransition(async () => {
      const supabase = createClient();
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `${row.amendmentId}/${row.approvalId ?? "unknown"}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) {
        setBusyId(null);
        error(`Upload failed: ${upErr.message}`);
        return;
      }
      const res = await markApprovalSent(row.id, undefined, {
        path,
        mimeType: file.type || null,
        sizeBytes: file.size,
      });
      setBusyId(null);
      if (res.ok) success("Marked sent, proof attached");
      else error(res.error ?? "Could not save");
    });
  }

  return (
    <>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className={cn(
              "rounded-lg border border-border bg-surface p-3 sm:p-4",
              row.escalated && "border-danger/50",
            )}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-sm font-medium">
                  <span>{row.approval}</span>
                  {row.orderRef && (
                    <>
                      <span className="text-muted-foreground"> for </span>
                      <Link
                        href="/orders/amendments"
                        className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                        title={row.amendmentCode ? `Amendment ${row.amendmentCode}` : undefined}
                      >
                        {row.orderRef}
                      </Link>
                    </>
                  )}
                  {row.buyer && <span className="text-muted-foreground"> · {row.buyer}</span>}
                  {row.activeVersion > 1 && (
                    <button
                      type="button"
                      className="ml-2 inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                      onClick={() => setHistoryRow(row)}
                    >
                      <History className="size-3" aria-hidden /> v{row.activeVersion}
                    </button>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {row.department && <span>{row.department}</span>}
                  {row.requiresProof && <span> · Proof required</span>}
                  {row.proofPath && <span className="text-foreground"> · Proof attached</span>}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="tabular-nums text-xs text-muted-foreground">{fmtDate(row.targetDate)}</span>
                  {row.bucket !== "resolved" && <SlipPill row={row} />}
                  <StatusPill
                    tone={row.status === "sent" ? "info" : row.status === "approved" ? "success" : "neutral"}
                  >
                    {row.status === "pending" ? "Pending" : row.status === "sent" ? "Sent" : row.status === "approved" ? "Approved" : row.status}
                  </StatusPill>
                  <DelayPills row={row} />
                </div>

                {canComplete && row.status === "pending" && (
                  <SendControl row={row} disabled={busyId === row.id} onSend={sendWithOptionalProof} />
                )}

                {canComplete && row.status === "sent" && (
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyId === row.id}
                      onClick={() => setReworkId(reworkId === row.id ? null : row.id)}
                    >
                      <RotateCcw aria-hidden /> Rework
                    </Button>
                    <Button
                      size="sm"
                      disabled={busyId === row.id}
                      onClick={() =>
                        run(row.id, () => markApprovalApproved(row.id), "Marked approved")
                      }
                    >
                      <CheckCircle2 aria-hidden /> Approved
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {reworkId === row.id && (
              <ReworkForm
                disabled={busyId === row.id}
                onCancel={() => setReworkId(null)}
                onConfirm={(remarks) => {
                  setReworkId(null);
                  run(row.id, () => markApprovalRework(row.id, undefined, remarks), "Sent back for rework");
                }}
              />
            )}
          </li>
        ))}
      </ul>

      {historyRow && (
        <HistorySheet row={historyRow} onClose={() => setHistoryRow(null)} />
      )}
    </>
  );
}

/** "Mark Sent", with an optional file attached in the same click. */
/**
 * Dispatch Proof Enforcement (spec §4.1). `requiresProof` approvals drop the
 * no-file "Mark Sent" button entirely — the file input opens on the SAME
 * click as "Attach & Send", so there is no keystroke that reaches SENT
 * without a file chosen. `markApprovalSent` re-checks this server-side (see
 * its own header); this is the courtesy half, not the guard.
 */
function SendControl({
  row,
  disabled,
  onSend,
}: {
  row: ApprovalWorklistRow;
  disabled: boolean;
  onSend: (row: ApprovalWorklistRow, file: File | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-1.5">
      <input
        ref={fileRef}
        type="file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          e.target.value = "";
          onSend(row, file);
        }}
      />
      <Button
        variant={row.requiresProof ? "primary" : "outline"}
        size="sm"
        disabled={disabled}
        onClick={() => fileRef.current?.click()}
        title="Attach a proof file and mark sent"
      >
        <Upload aria-hidden /> Attach & Send
      </Button>
      {!row.requiresProof && (
        <Button size="sm" disabled={disabled} onClick={() => onSend(row, null)}>
          <Send aria-hidden /> Mark Sent
        </Button>
      )}
    </div>
  );
}

/**
 * Delay Attribution Engine (spec §5) — read-only pills, shown only once the
 * fact they measure has happened (see `approvals-worklist.ts` for why both
 * can be null). Merchandiser delay is always shown once a dispatch is late;
 * buyer delay only shows when it is actually > 0 — a buyer who replied
 * within their agreed lead time has nothing to be flagged for, and showing
 * "0 days" on every resolved row would bury the ones that matter.
 */
function DelayPills({ row }: { row: ApprovalWorklistRow }) {
  return (
    <>
      {!!row.merchandiserDelayDays && (
        <span title="Dispatched later than the target send date">
          <StatusPill tone="warning">Dispatch +{row.merchandiserDelayDays}d</StatusPill>
        </span>
      )}
      {!!row.buyerDelayDays && (
        <span title={`Buyer took longer than the agreed ${row.masterLeadDays}-day review`}>
          <StatusPill tone="danger">Buyer +{row.buyerDelayDays}d</StatusPill>
        </span>
      )}
    </>
  );
}

/** The remarks box a Rework needs before it can be confirmed — mandatory, per markApprovalRework's own refusal. */
function ReworkForm({
  disabled,
  onCancel,
  onConfirm,
}: {
  disabled: boolean;
  onCancel: () => void;
  onConfirm: (remarks: string) => void;
}) {
  const [remarks, setRemarks] = useState("");
  return (
    <div className="mt-3 space-y-2 rounded-md border border-warning/40 bg-warning-soft/40 p-2.5">
      <label className="block text-xs font-medium text-foreground" htmlFor={`rework-remarks`}>
        Buyer's feedback (required)
      </label>
      <Input
        id="rework-remarks"
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
        placeholder="e.g. Sleeve width too narrow, revise pattern"
        autoFocus
      />
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={disabled || !remarks.trim()}
          onClick={() => onConfirm(remarks.trim())}
        >
          Confirm Rework
        </Button>
      </div>
    </div>
  );
}

function HistorySheet({ row, onClose }: { row: ApprovalWorklistRow; onClose: () => void }) {
  const [entries, setEntries] = useState<ApprovalHistoryEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getApprovalHistory(row.id).then((rows) => {
      if (!cancelled) setEntries(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  return (
    <Sheet open onClose={onClose} title={`${row.approval} — history`} size="sm">
      {entries === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No prior rejections recorded.</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => (
            <li key={e.version} className="rounded-md border border-border p-2.5 text-sm">
              <p className="font-medium">Version {e.version} — rejected</p>
              <p className="text-xs text-muted-foreground">
                Sent {e.actualSentDate ? fmtDate(e.actualSentDate) : "—"} · Rejected{" "}
                {e.actualReceivedDate ? fmtDate(e.actualReceivedDate) : "—"}
              </p>
              {e.remarks && <p className="mt-1 text-xs text-foreground">{e.remarks}</p>}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function SlipPill({ row }: { row: ApprovalWorklistRow }) {
  if (row.daysLate > 0) {
    return (
      <StatusPill tone={row.escalated ? "danger" : "warning"}>
        {row.daysLate} {row.daysLate === 1 ? "day" : "days"} late
      </StatusPill>
    );
  }
  if (row.daysLate === 0) return <StatusPill tone="info">Due today</StatusPill>;
  return (
    <StatusPill tone="neutral">
      in {-row.daysLate} {row.daysLate === -1 ? "day" : "days"}
    </StatusPill>
  );
}
