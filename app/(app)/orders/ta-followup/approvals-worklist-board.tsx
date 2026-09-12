"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  History,
  RotateCcw,
  Send,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { acquireBusy } from "@/lib/reload-guard";
import { fmtDate } from "@/lib/format";
import { today } from "@/lib/calendar";
import { cn } from "@/lib/utils";
import type { StatusTone } from "@/lib/ui/tone";
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
/**
 * Same tone/accent-bar/status-box treatment as `ta-worklist/worklist-board.tsx`
 * (2026-09-10 port — operator: "same issue for ta followup"). One extra
 * branch here: an `approved` row reads `success` outright, resolved rows
 * having already left the daysLate question behind.
 */
function rowTone(row: ApprovalWorklistRow): StatusTone {
  if (row.status === "approved") return "success";
  if (row.daysLate > 0) return row.escalated ? "danger" : "warning";
  if (row.daysLate === 0) return "info";
  return "neutral";
}

const TONE_EDGE: Record<StatusTone, string> = {
  success: "border-l-success",
  warning: "border-l-warning",
  danger: "border-l-danger",
  info: "border-l-info",
  neutral: "border-l-border-strong",
};

const STATUS_BOX: Record<StatusTone, string> = {
  success: "border-success/30 bg-success-soft/60",
  warning: "border-warning/30 bg-warning-soft/60",
  danger: "border-danger/30 bg-danger-soft/60",
  info: "border-info/30 bg-info-soft/60",
  neutral: "border-border bg-surface-muted/60",
};

const STATUS_ICON_COLOR: Record<StatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  neutral: "text-muted-foreground",
};

function StatusIcon({ row, className }: { row: ApprovalWorklistRow; className?: string }) {
  const tone = rowTone(row);
  const cls = cn(STATUS_ICON_COLOR[tone], className);
  if (tone === "success") return <CheckCircle2 className={cls} aria-hidden />;
  if (tone === "danger" || tone === "warning") return <AlertTriangle className={cls} aria-hidden />;
  if (tone === "info") return <Clock className={cls} aria-hidden />;
  return <CalendarClock className={cls} aria-hidden />;
}

function slipLabel(row: ApprovalWorklistRow): string {
  if (row.daysLate > 0) return `${row.daysLate} ${row.daysLate === 1 ? "day" : "days"} late`;
  if (row.daysLate === 0) return "Due today";
  return `in ${-row.daysLate} ${row.daysLate === -1 ? "day" : "days"}`;
}

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
  const [dispatchRow, setDispatchRow] = useState<ApprovalWorklistRow | null>(null);
  const { toast, success, error } = useToast();

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

  /**
   * The Dispatch modal's confirm handler (doc/ui/order/tafollowup.md §2).
   * The file upload happens first, same as before this modal existed —
   * `markApprovalSent` only ever needs the storage PATH, never the file
   * itself, and a failed upload must not still flip the row to `sent`.
   */
  async function dispatch(
    row: ApprovalWorklistRow,
    opts: { sentDate: string; sentTime: string; proofReference: string; file: File | null },
  ) {
    setBusyId(row.id);
    startTransition(async () => {
      let proof: { path: string; mimeType: string | null; sizeBytes: number | null } | undefined;
      if (opts.file) {
        const supabase = createClient();
        const ext = opts.file.name.split(".").pop() ?? "bin";
        const path = `${row.amendmentId}/${row.approvalId ?? "unknown"}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, opts.file, { upsert: false, contentType: opts.file.type });
        if (upErr) {
          setBusyId(null);
          error(`Upload failed: ${upErr.message}`);
          return;
        }
        proof = { path, mimeType: opts.file.type || null, sizeBytes: opts.file.size };
      }
      const res = await markApprovalSent(row.id, opts.sentDate, opts.sentTime, opts.proofReference, proof);
      setBusyId(null);
      if (res.ok) {
        success(proof ? "Marked sent, proof attached" : "Marked sent");
        // No Review Lead Days configured for this buyer — Expected Approval
        // Date could not be recomputed (markApprovalSent's own header).
        if (res.warning) toast(res.warning, "info");
      } else {
        error(res.error ?? "Could not save");
      }
    });
  }

  return (
    <>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li
            key={row.id}
            className={cn(
              // Same compact pass + left accent bar as `ta-worklist/worklist-
              // board.tsx` (2026-09-10 port) — a full-card border only fired
              // for `escalated`, so every other row looked unstated; now every
              // bucket gets a consistent stripe off the same `rowTone()`.
              "rounded-lg border border-border bg-surface p-2.5 sm:p-3",
              "border-l-[3px]",
              TONE_EDGE[rowTone(row)],
            )}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
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
                {/* Chips, not a "·"-joined sentence — same reasoning as the
                    qty/style/department chips on `ta-worklist`. */}
                {(row.department || row.requiresProof || row.proofPath || row.proofReference || row.actualSentDate) && (
                  <div className="flex flex-wrap items-center gap-1">
                    {row.department && (
                      <StatusPill tone="neutral" className="border border-border/60 px-1.5 py-0.5">
                        {row.department}
                      </StatusPill>
                    )}
                    {row.requiresProof && (
                      <StatusPill tone="neutral" className="border border-border/60 px-1.5 py-0.5">
                        Proof required
                      </StatusPill>
                    )}
                    {row.proofPath && (
                      <StatusPill tone="success" className="border border-success/30 px-1.5 py-0.5">
                        Proof attached
                      </StatusPill>
                    )}
                    {/* File and reference are independent (either satisfies
                        Dispatch Proof Enforcement) — both chips can show
                        together, one, or neither. */}
                    {row.proofReference && (
                      <StatusPill tone="success" className="border border-success/30 px-1.5 py-0.5">
                        Ref: {row.proofReference}
                      </StatusPill>
                    )}
                    {row.actualSentDate && (
                      <span className="text-xs text-muted-foreground">
                        Sent {fmtDate(row.actualSentDate)}
                        {row.actualSentTime && ` · ${row.actualSentTime.slice(0, 5)}`}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {/* ONE tinted badge for date+lateness, same as
                      `ta-worklist` — only for a row still being chased.
                      A resolved row already says everything in its green
                      "Approved" pill below; boxing a plain date next to it
                      would be a second badge for the same fact. */}
                  {row.bucket !== "resolved" ? (
                    <div
                      className={cn(
                        "flex items-center gap-1 rounded-md border px-1.5 py-0.5",
                        STATUS_BOX[rowTone(row)],
                      )}
                    >
                      <StatusIcon row={row} className="size-3.5 shrink-0" />
                      <span className="tabular-nums text-xs text-muted-foreground">
                        {fmtDate(row.targetDate)}
                      </span>
                      <span className={cn("text-xs font-semibold", STATUS_ICON_COLOR[rowTone(row)])}>
                        {slipLabel(row)}
                      </span>
                    </div>
                  ) : (
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {fmtDate(row.targetDate)}
                    </span>
                  )}
                  <StatusPill
                    tone={row.status === "sent" ? "info" : row.status === "approved" ? "success" : "neutral"}
                  >
                    {row.status === "pending" ? "Pending" : row.status === "sent" ? "Sent" : row.status === "approved" ? "Approved" : row.status}
                  </StatusPill>
                  <DelayPills row={row} />
                </div>

                {canComplete && row.status === "pending" && (
                  <Button
                    variant={row.requiresProof ? "primary" : "outline"}
                    size="sm"
                    disabled={busyId === row.id}
                    onClick={() => setDispatchRow(row)}
                  >
                    <Send aria-hidden /> Mark Sent
                  </Button>
                )}

                {canComplete && row.status === "sent" && (
                  <div className="flex items-center gap-1">
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

      {dispatchRow && (
        <DispatchModal
          row={dispatchRow}
          disabled={busyId === dispatchRow.id}
          onClose={() => setDispatchRow(null)}
          onConfirm={(opts) => {
            setDispatchRow(null);
            void dispatch(dispatchRow, opts);
          }}
        />
      )}
    </>
  );
}

/**
 * The dispatch modal (doc/ui/order/tafollowup.md §2) — Send Date (defaults to
 * today, editable), Send Time (optional — courier dispatch is often only
 * known to the day), and a Courier Proof/Reference that is EITHER a typed
 * tracking number OR an uploaded file, never both required.
 *
 * Dispatch Proof Enforcement (spec §4.1) still stands: when the approval
 * `requiresProof`, Confirm stays disabled until a file OR a reference is
 * given. `markApprovalSent` re-checks this server-side (see its own header);
 * this is the courtesy half, not the guard.
 *
 * `Sheet size="sm"`, matching this same file's `HistorySheet` — a small
 * action popup on a top-level worklist screen, not a master-detail editor,
 * so it skips `Field`/`DetailSection` for the same plain `<label>` + `<Input>`
 * shape `ReworkForm` already uses a few lines up.
 */
function DispatchModal({
  row,
  disabled,
  onClose,
  onConfirm,
}: {
  row: ApprovalWorklistRow;
  disabled: boolean;
  onClose: () => void;
  onConfirm: (opts: { sentDate: string; sentTime: string; proofReference: string; file: File | null }) => void;
}) {
  const [sentDate, setSentDate] = useState(today());
  const [sentTime, setSentTime] = useState("");
  const [proofReference, setProofReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const proofSatisfied = !row.requiresProof || !!file || !!proofReference.trim();

  return (
    <Sheet open onClose={onClose} title={`Mark Sent — ${row.approval}`} size="sm">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1 text-xs font-medium text-foreground" htmlFor="dispatch-date">
            Send Date
            <Input
              id="dispatch-date"
              type="date"
              value={sentDate}
              onChange={(e) => setSentDate(e.target.value)}
            />
          </label>
          <label className="block space-y-1 text-xs font-medium text-foreground" htmlFor="dispatch-time">
            Send Time (optional)
            <Input
              id="dispatch-time"
              type="time"
              value={sentTime}
              onChange={(e) => setSentTime(e.target.value)}
            />
          </label>
        </div>

        <label className="block space-y-1 text-xs font-medium text-foreground" htmlFor="dispatch-ref">
          Courier Reference / Tracking No. {!row.requiresProof && "(optional)"}
          <Input
            id="dispatch-ref"
            value={proofReference}
            onChange={(e) => setProofReference(e.target.value)}
            placeholder="e.g. waybill or tracking number"
          />
        </label>

        <div className="space-y-1">
          <input
            ref={fileRef}
            type="file"
            hidden
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload aria-hidden /> {file ? file.name : "Attach a proof file"}
          </Button>
          {row.requiresProof && (
            <p className="text-xs text-muted-foreground">
              A proof file or a typed reference is required before this approval can be marked sent.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-1.5 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={disabled || !sentDate || !proofSatisfied}
            onClick={() =>
              onConfirm({ sentDate, sentTime, proofReference: proofReference.trim(), file })
            }
          >
            <Send aria-hidden /> Mark Sent
          </Button>
        </div>
      </div>
    </Sheet>
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
                Sent {e.actualSentDate ? fmtDate(e.actualSentDate) : "—"}
                {e.actualSentTime && ` · ${e.actualSentTime.slice(0, 5)}`} · Rejected{" "}
                {e.actualReceivedDate ? fmtDate(e.actualReceivedDate) : "—"}
              </p>
              {e.proofReference && (
                <p className="text-xs text-muted-foreground">Ref: {e.proofReference}</p>
              )}
              {e.remarks && <p className="mt-1 text-xs text-foreground">{e.remarks}</p>}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

