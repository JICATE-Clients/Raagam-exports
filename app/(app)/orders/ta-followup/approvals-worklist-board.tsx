"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Copy,
  History,
  Mail,
  RotateCcw,
  Send,
  Upload,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { getApprovalLinkInfo, resendApprovalLink, sendApprovalLink } from "@/lib/ta/approval-links-actions";
import {
  APPROVAL_LINK_BUCKET,
  LINK_STATUS_LABEL,
  type ApprovalLinkFile,
  type ApprovalLinkInfo,
  type MarkSentLinkChoice,
} from "@/lib/ta/approval-links-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FIELD_WIDTH } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { acquireBusy } from "@/lib/reload-guard";
import { fmtDate, fmtTime } from "@/lib/format";
import { nowTime, today } from "@/lib/calendar";
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

/** The Mark Sent dialog's answer — `link` set when "Email approval link to buyer" is ticked (0672). */
type DispatchOpts = {
  sentDate: string;
  sentTime: string;
  proofReference: string;
  file: File | null;
  link?: MarkSentLinkChoice;
};

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
  const [linkRow, setLinkRow] = useState<ApprovalWorklistRow | null>(null);
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
  async function dispatch(row: ApprovalWorklistRow, opts: DispatchOpts) {
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
      const res = await markApprovalSent(row.id, opts.sentDate, opts.sentTime, opts.proofReference, proof, opts.link);
      setBusyId(null);
      if (res.ok) {
        success(proof ? "Marked sent, proof attached" : "Marked sent");
        // No Review Lead Days configured for this buyer — Expected Approval
        // Date could not be recomputed (markApprovalSent's own header).
        if (res.warning) toast(res.warning, "info");
        // What happened to the buyer link (0672) — sent, created, or failed.
        if (res.linkNote) toast(res.linkNote, res.linkNote.includes("failed") ? "error" : "info");
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
                        {row.actualSentTime && ` · ${fmtTime(row.actualSentTime)}`}
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
                  <div className="flex items-center gap-1">
                    {/* A reworked row (v2+) may carry the buyer's answer from
                        the email link — comment and attached photos (0672).
                        The sheet shows it read-only on a pending row. */}
                    {row.activeVersion > 1 && (
                      <Button variant="ghost" size="sm" disabled={busyId === row.id} onClick={() => setLinkRow(row)}>
                        <Mail aria-hidden /> Buyer&apos;s reply
                      </Button>
                    )}
                    <Button
                      variant={row.requiresProof ? "primary" : "outline"}
                      size="sm"
                      disabled={busyId === row.id}
                      onClick={() => setDispatchRow(row)}
                    >
                      <Send aria-hidden /> Mark Sent
                    </Button>
                  </div>
                )}

                {canComplete && row.status === "sent" && (
                  <div className="flex items-center gap-1">
                    {/* Buyer approval by link (0668): the buyer answers from an
                        email, no login, and this row updates itself. */}
                    <Button variant="ghost" size="sm" disabled={busyId === row.id} onClick={() => setLinkRow(row)}>
                      <Mail aria-hidden /> Email buyer link
                    </Button>
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

      {linkRow && <BuyerLinkSheet row={linkRow} onClose={() => setLinkRow(null)} />}

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
  onConfirm: (opts: DispatchOpts) => void;
}) {
  const [sentDate, setSentDate] = useState(today());
  // The time NOW (user 2026-10-01: "fetch auto time"), read-only and kept
  // current while the dialog stays open ("not editable, make it readonly").
  const [sentTime, setSentTime] = useState(() => nowTime());
  useEffect(() => {
    const tick = window.setInterval(() => setSentTime(nowTime()), 15_000);
    return () => window.clearInterval(tick);
  }, []);
  const [proofReference, setProofReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // THE BUYER LINK, IN THE SAME STEP (user 2026-10-01, screenshot 3195). The
  // recipient comes straight from the Customer master's contacts; ticked by
  // default when the customer has an email, so the usual case is one click.
  const [info, setInfo] = useState<ApprovalLinkInfo | null>(null);
  const [sendLink, setSendLink] = useState(false);
  const [linkEmail, setLinkEmail] = useState("");
  const [linkName, setLinkName] = useState("");
  const [autoNext, setAutoNext] = useState(true);
  useEffect(() => {
    let cancelled = false;
    getApprovalLinkInfo(row.id).then((res) => {
      if (cancelled || "error" in res) return;
      setInfo(res);
      const first = res.contacts[0];
      if (first) {
        setLinkEmail(first.email);
        setLinkName(first.name ?? "");
        setSendLink(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  const proofSatisfied = !row.requiresProof || !!file || !!proofReference.trim();
  const linkSatisfied = !sendLink || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(linkEmail.trim());

  return (
    <Sheet open onClose={onClose} title={`Mark Sent — ${row.approval}`} size="sm">
      <div className="space-y-3">
        {/* COMPACT (user 2026-10-01): each field at its own width from the
            vocabulary (lib/ui/sizes.ts) — the date and its picker icon fit
            `code` (144px), "1:05 PM" fits `range` (112px) — not half the
            dialog each. */}
        <div className="flex flex-wrap items-end gap-3">
          <label className={cn("block space-y-1 text-xs font-medium text-foreground", FIELD_WIDTH.code)} htmlFor="dispatch-date">
            Send Date
            <Input
              id="dispatch-date"
              type="date"
              value={sentDate}
              onChange={(e) => setSentDate(e.target.value)}
            />
          </label>
          <label className={cn("block space-y-1 text-xs font-medium text-foreground", FIELD_WIDTH.range)} htmlFor="dispatch-time">
            Send Time
            {/* STAMPED, NOT TYPED (user 2026-10-01: "not editable, make it
                readonly"). The clock reads the factory's time now and keeps
                ticking while the dialog is open, so what is saved is the moment
                Mark Sent is pressed. Shown 12-hour ("not railway format"); the
                value stays 24-hour "HH:MM" for the database. `readOnly` also
                takes it off the Tab path (Input's own rule). */}
            <Input id="dispatch-time" readOnly value={fmtTime(sentTime).toUpperCase()} />
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

        <div className="space-y-2 rounded-md border border-border p-2.5">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={sendLink}
              onChange={(e) => setSendLink(e.target.checked)}
              className="size-4 accent-[var(--primary)]"
            />
            <Mail className="size-4 text-muted-foreground" aria-hidden /> Email approval link to buyer
          </label>
          {sendLink && (
            <div className="space-y-2 pl-6">
              <label className="block space-y-1 text-xs font-medium text-foreground" htmlFor="dispatch-link-email">
                Buyer email <span className="text-danger">*</span>
                <Input
                  id="dispatch-link-email"
                  type="email"
                  value={linkEmail}
                  onChange={(e) => setLinkEmail(e.target.value)}
                />
              </label>
              {info && info.contacts.length > 1 && (
                <div className="flex flex-wrap gap-1">
                  {info.contacts.map((c) => (
                    <button
                      key={c.email}
                      type="button"
                      tabIndex={-1}
                      className={cn(
                        "rounded border px-1.5 py-0.5 text-xs hover:bg-surface-muted",
                        c.email === linkEmail ? "border-primary text-primary" : "border-border",
                      )}
                      onClick={() => {
                        setLinkEmail(c.email);
                        setLinkName(c.name ?? "");
                      }}
                    >
                      {c.name ? `${c.name} · ` : ""}
                      {c.email}
                    </button>
                  ))}
                </div>
              )}
              {info && info.contacts.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  This customer has no email on the Customer master (General tab or Contacts) — type one, or add it there to have it filled
                  in next time.
                </p>
              )}
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={autoNext}
                  onChange={(e) => setAutoNext(e.target.checked)}
                  className="mt-0.5 size-3.5 accent-[var(--primary)]"
                />
                <span>
                  When the buyer approves, send the <b>next approval&apos;s</b> link to them automatically
                </span>
              </label>
              {info && !info.emailConfigured && (
                <p className="text-xs text-warning">
                  Email is not set up yet — the link will be created; copy it from &ldquo;Email buyer link&rdquo; to send
                  it yourself.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-1.5 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={disabled || !sentDate || !proofSatisfied || !linkSatisfied}
            onClick={() =>
              onConfirm({
                sentDate,
                sentTime,
                proofReference: proofReference.trim(),
                file,
                link: sendLink ? { email: linkEmail.trim(), name: linkName.trim(), autoNext } : undefined,
              })
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
        Buyer&apos;s feedback (required)
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
                {e.actualSentTime && ` · ${fmtTime(e.actualSentTime)}`} · Rejected{" "}
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


/**
 * "Email buyer link" (0668, doc/order/digitalisation-plan.md §4) — the buyer
 * answers Approve / Rework from the email with no login, and this row updates
 * itself. Recipient is prefilled from the Customer master's contacts; files
 * attached here are what the buyer sees (the dispatch proof is a courier slip,
 * not the sample). When email is not set up, the link is shown once to copy —
 * only its hash is stored, so it cannot be shown again later.
 */
function BuyerLinkSheet({ row, onClose }: { row: ApprovalWorklistRow; onClose: () => void }) {
  const { success, error } = useToast();
  const [info, setInfo] = useState<ApprovalLinkInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [autoNext, setAutoNext] = useState(true);
  const [sent, setSent] = useState<{ url: string; emailed: boolean; note: string | null } | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    getApprovalLinkInfo(row.id).then((res) => {
      if (cancelled) return;
      if ("error" in res) {
        setLoadError(res.error);
        return;
      }
      setInfo(res);
      const first = res.contacts[0];
      if (first) {
        setEmail(first.email);
        setName(first.name ?? "");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  const send = () =>
    startTransition(async () => {
      const uploaded: ApprovalLinkFile[] = [];
      if (files.length) {
        const supabase = createClient();
        for (const f of files) {
          const ext = f.name.split(".").pop() ?? "bin";
          const path = `${row.amendmentId}/${row.id}/links/${crypto.randomUUID()}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from(APPROVAL_LINK_BUCKET)
            .upload(path, f, { upsert: false, contentType: f.type });
          if (upErr) {
            error(`Upload failed: ${upErr.message}`);
            return;
          }
          uploaded.push({ path, name: f.name, mime: f.type || null });
        }
      }
      const res = await sendApprovalLink({ approvalRowId: row.id, email, name, message, files: uploaded, autoNext });
      if (!res.ok) {
        error(res.error);
        return;
      }
      setSent({ url: res.url, emailed: res.emailed, note: res.emailNote });
      if (res.emailed) success(`Link emailed to ${email}`);
    });

  // RESEND (0672): same buyer, message, files and chain choice, fresh link.
  const resend = () =>
    startTransition(async () => {
      const res = await resendApprovalLink(row.id);
      if (!res.ok) {
        error(res.error);
        return;
      }
      setSent({ url: res.url, emailed: res.emailed, note: res.emailNote });
      if (res.emailed) success(`Link resent to ${info?.latest?.recipientEmail ?? "the buyer"}`);
    });

  const copy = async () => {
    if (!sent) return;
    try {
      await navigator.clipboard.writeText(sent.url);
      success("Link copied");
    } catch {
      error("Could not copy — select the link and copy it by hand");
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={`${row.status === "sent" ? "Email buyer link" : "Buyer's reply"} — ${row.approval}`}
      size="sm"
    >
      {loadError ? (
        <p className="text-sm text-danger">{loadError}</p>
      ) : !info ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : sent ? (
        <div className="space-y-3">
          <p className="text-sm">
            {sent.emailed ? `Emailed to ${email}. ` : ""}The buyer can open this link with no login. It works for 14
            days.
          </p>
          {sent.note && <p className="text-sm text-warning">{sent.note}</p>}
          {/* caps-input: exempt -- a URL path is case-sensitive; the token breaks if capitalised */}
          <Input readOnly value={sent.url} uppercase={false} onFocus={(e) => e.currentTarget.select()} />
          <div className="flex justify-end gap-1.5">
            <Button variant="outline" size="sm" onClick={copy}>
              <Copy aria-hidden /> Copy link
            </Button>
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {info.latest && (
            <div className="space-y-1.5 rounded-md border border-border bg-surface-muted/60 p-2 text-xs">
              <p>
                Last link: <span className="font-medium">{LINK_STATUS_LABEL[info.latest.status]}</span> ·{" "}
                {info.latest.recipientEmail} · {fmtDate(info.latest.createdAt)}
                {info.latest.decidedByName && ` · ${info.latest.decidedByName}`}
                {info.latest.autoNext && " · next approval follows automatically"}
              </p>
              {info.latest.decisionComment && <p className="text-foreground">“{info.latest.decisionComment}”</p>}
              {/* What the buyer attached with a Rework (0672). */}
              {info.latest.buyerFiles.length > 0 && (
                <ul className="flex flex-wrap gap-x-3 gap-y-1">
                  {info.latest.buyerFiles.map((f) =>
                    f.url ? (
                      <li key={f.path}>
                        <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
                          {f.name}
                        </a>
                      </li>
                    ) : (
                      <li key={f.path} className="text-muted-foreground">
                        {f.name}
                      </li>
                    ),
                  )}
                </ul>
              )}
              {info.latest.status === "open" && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Still waiting. Resend it, or send a new link below.</span>
                  <Button variant="outline" size="sm" disabled={pending} onClick={resend}>
                    <RotateCcw aria-hidden /> Resend link
                  </Button>
                </div>
              )}
            </div>
          )}
          {/* READ-ONLY on a row that is not Sent (a reworked row opened from
              "Buyer's reply"): a link is only for an item the buyer has in
              hand, so the form appears once it is marked Sent again. */}
          {row.status !== "sent" ? (
            <div className="space-y-2">
              {!info.latest && <p className="text-sm text-muted-foreground">No buyer link has been sent for this approval.</p>}
              <p className="text-xs text-muted-foreground">Mark it Sent again to send the buyer a new link.</p>
              <div className="flex justify-end">
                <Button size="sm" onClick={onClose}>
                  Close
                </Button>
              </div>
            </div>
          ) : (
          <>
          {!info.emailConfigured && (
            <p className="text-xs text-warning">
              Email is not set up yet. The link will be shown here to copy and send yourself (for example on WhatsApp).
            </p>
          )}
          <label className="block space-y-1 text-xs font-medium text-foreground" htmlFor="link-email">
            Buyer email <span className="text-danger">*</span>
            <Input id="link-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {info.contacts.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {info.contacts.map((c) => (
                <button
                  key={c.email}
                  type="button"
                  tabIndex={-1}
                  className="rounded border border-border px-1.5 py-0.5 text-xs hover:bg-surface-muted"
                  onClick={() => {
                    setEmail(c.email);
                    setName(c.name ?? "");
                  }}
                >
                  {c.name ? `${c.name} · ` : ""}
                  {c.email}
                </button>
              ))}
            </div>
          )}
          {info.contacts.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No contact email on this customer yet — add one on the Customer master to have it filled in next time.
            </p>
          )}
          <label className="block space-y-1 text-xs font-medium text-foreground" htmlFor="link-name">
            Buyer name (optional)
            <Input id="link-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </label>
          <label className="block space-y-1 text-xs font-medium text-foreground" htmlFor="link-message">
            Message (optional)
            <Textarea id="link-message" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
          </label>
          <div className="space-y-1">
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 10))}
            />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload aria-hidden /> {files.length ? `${files.length} file(s) attached` : "Attach photos / PDF for the buyer"}
            </Button>
          </div>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={autoNext}
              onChange={(e) => setAutoNext(e.target.checked)}
              className="mt-0.5 size-3.5 accent-[var(--primary)]"
            />
            <span>
              When the buyer approves, send the <b>next approval&apos;s</b> link to them automatically
            </span>
          </label>
          <div className="flex justify-end gap-1.5 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" disabled={pending || !email.trim()} onClick={send}>
              <Mail aria-hidden /> {info.emailConfigured ? "Send link" : "Create link"}
            </Button>
          </div>
          </>
          )}
        </div>
      )}
    </Sheet>
  );
}
