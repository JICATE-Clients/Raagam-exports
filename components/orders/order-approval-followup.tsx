"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, History, RotateCcw, Send, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const BUCKET = "order-approval-docs";

/**
 * ORDER ENTRY'S OWN "TA Followup" TAB — the customer-approval lifecycle for
 * ONE order, acted on in place rather than only from the standalone
 * `/orders/ta-followup` board (operator request, 2026-09-10).
 *
 * This is a DELIBERATE reversal of `AmendmentTaApproval`'s own long-standing
 * comment ("entered on the merchandiser board, never on this screen") — see
 * that type's updated note. The four writes below are the SAME four actions
 * that screen calls (`lib/ta/approvals-worklist-actions.ts`), imported
 * directly rather than re-implemented, so there is exactly one place that
 * knows how to mark an approval Sent/Approved/Rework — never two answers
 * about the same table.
 *
 * A NEW, SMALLER COMPONENT RATHER THAN A SHARED ONE WITH `ApprovalsWorklistBoard`
 * (that screen's own board). Its row shape (`ApprovalWorklistRow`) carries
 * cross-order display fields — buyer, order ref, escalation bucket — that
 * make no sense once already inside the one order they belong to, and this
 * screen's own row count per order is small (a handful of approvals, not a
 * company-wide queue). The INTERACTION pieces (send-with-proof, the mandatory
 * rework remarks, the history sheet) are intentionally the same shapes and
 * words as that board, so an operator who has used one recognises the other.
 *
 * `router.refresh()` after every write — the actions' own `revalidatePath`
 * only targets `/orders/ta-followup`, which does nothing for a page open on
 * `/orders/garment-orders`. This does not touch the ORDER's own unsaved
 * fields: refreshing re-runs Server Components, and this screen's own draft
 * state (`taRows`, `form`, …) is untouched React state, not re-derived from
 * the refreshed props — only `AmendmentFormData`-sourced values change.
 */
export interface OrderApprovalRow {
  /** The saved DB row's id, or null when this approval was only just added
   *  to the grid and has never been saved — such a row has nothing to act
   *  on yet, and the UI says so rather than hiding it. */
  id: string | null;
  rowUid: string;
  approvalId: string | null;
  approvalName: string;
  department: string | null;
  requiresProof: boolean;
  targetDate: string | null;
  /** `pending` | `sent` | `approved` | `rework` — `rework` is transient: the
   *  action that sets it also resets the live row to `pending` in the same
   *  write, so it is never actually read back as a resting status. */
  status: string;
  actualSentDate: string | null;
  actualReceivedDate: string | null;
  proofPath: string | null;
  activeVersion: number;
}

export function OrderApprovalFollowup({
  amendmentId,
  rows,
  canAct,
}: {
  /** Needed only for the upload path (`${amendmentId}/${approvalId}/…`),
   *  matching the standalone board's own convention exactly — the storage
   *  bucket's RLS does not care, but a reader resolving "which order is this
   *  file under" by path alone must see the same shape from both screens. */
  amendmentId: string | null;
  rows: OrderApprovalRow[];
  /** `orders:edit` — same permission the standalone board's `canComplete` reads. */
  canAct: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reworkId, setReworkId] = useState<string | null>(null);
  const [historyRow, setHistoryRow] = useState<OrderApprovalRow | null>(null);
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
      if (res.ok) {
        success(done);
        router.refresh();
      } else {
        error(res.error ?? "Could not save");
      }
    });
  };

  async function sendWithOptionalProof(row: OrderApprovalRow, file: File | null) {
    if (!row.id) return;
    const id = row.id;
    if (!file) {
      run(id, () => markApprovalSent(id), "Marked sent");
      return;
    }
    setBusyId(id);
    startTransition(async () => {
      const supabase = createClient();
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `${amendmentId ?? "unknown"}/${row.approvalId ?? "unknown"}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: false, contentType: file.type });
      if (upErr) {
        setBusyId(null);
        error(`Upload failed: ${upErr.message}`);
        return;
      }
      const res = await markApprovalSent(id, undefined, {
        path,
        mimeType: file.type || null,
        sizeBytes: file.size,
      });
      setBusyId(null);
      if (res.ok) {
        success("Marked sent, proof attached");
        router.refresh();
      } else {
        error(res.error ?? "Could not save");
      }
    });
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No approvals declared on this order yet — add them on the T&amp;A tab&apos;s
        Approvals grid first.
      </p>
    );
  }

  /* Either the whole order has never been saved (`amendmentId` null) or one
     row was just added to the grid and has no saved counterpart yet — both
     read as "nothing here can be acted on until a save happens". */
  const anyUnsaved = !amendmentId || rows.some((r) => !r.id);

  /**
   * THREE COLUMNS, NOT FOUR — Pending / Sent / Approved, GROUPED RATHER THAN
   * LISTED (2026-09-10 UI pass, matching the redesign mockup the operator
   * approved). No "Rework" column: `markApprovalRework` (`lib/ta/approvals-
   * worklist-actions.ts`) never leaves a row resting at `status: 'rework'` —
   * in the same write that archives the old attempt it resets the LIVE row
   * to `'pending'` and bumps `activeVersion`, so a reworked approval is a
   * `pending` row again, waiting to be re-sent. A fourth column keyed off a
   * status this table never actually holds would be empty by construction;
   * a `rework` group in a design mockup is a reasonable first guess at the
   * state machine and the real one, checked here, says otherwise.
   *
   * WHAT MARKS A REWORKED ROW APART, THEN, IS `activeVersion > 1` — still a
   * `pending` row, still in the Pending column, but flagged "Reopened" so it
   * does not read identically to a milestone nobody has sent yet. The
   * existing "vN · History" control (unchanged) is how the buyer's remark
   * is actually read; this badge is only the "look here" signal.
   */
  const pendingRows = rows.filter((r) => r.status !== "sent" && r.status !== "approved");
  const sentRows = rows.filter((r) => r.status === "sent");
  const approvedRows = rows.filter((r) => r.status === "approved");
  const columns: {
    key: string;
    label: string;
    toneClass: string;
    rows: OrderApprovalRow[];
  }[] = [
    { key: "pending", label: "Pending", toneClass: "text-muted-foreground", rows: pendingRows },
    { key: "sent", label: "Sent", toneClass: "text-info", rows: sentRows },
    { key: "approved", label: "Approved", toneClass: "text-success", rows: approvedRows },
  ];

  return (
    <>
      {anyUnsaved && (
        <div className="mb-3 rounded-md border border-warning/40 bg-warning-soft/60 px-3 py-2 text-xs text-warning">
          Save the order once to enable Send / Approve / Rework on these approvals.
        </div>
      )}

      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg bg-border sm:grid-cols-3">
        {columns.map((col) => (
          <div key={col.key} className="flex flex-col gap-2 bg-surface p-2.5">
            <div className="flex items-center justify-between">
              <span className={cn("text-[10px] font-bold uppercase tracking-wide", col.toneClass)}>
                {col.label}
              </span>
              <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">
                {col.rows.length}
              </span>
            </div>

            {col.rows.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">Nothing here</p>
            ) : (
              col.rows.map((row) => (
                <div
                  key={row.rowUid}
                  className={cn(
                    "rounded-md border-l-[3px] bg-surface-muted p-2.5",
                    col.key === "sent" && "border-l-info",
                    col.key === "approved" && "border-l-success",
                    col.key === "pending" && "border-l-border-strong",
                  )}
                >
                  <p className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
                    {row.approvalName}
                    {row.activeVersion > 1 && (
                      <span className="rounded border border-warning/40 bg-warning-soft px-1 py-0.5 text-[9px] font-semibold text-warning">
                        Reopened · v{row.activeVersion}
                      </span>
                    )}
                  </p>
                  {row.department && (
                    <p className="mt-0.5 text-[9.5px] uppercase tracking-wide text-muted-foreground">
                      {row.department}
                    </p>
                  )}
                  <p className="mt-1 text-[10.5px] text-muted-foreground">
                    {row.targetDate ? (
                      <>
                        Target <span className="tabular-nums">{fmtDate(row.targetDate)}</span>
                      </>
                    ) : (
                      "No target date"
                    )}
                    {row.requiresProof && <span> · Proof required</span>}
                    {row.proofPath && <span className="text-foreground"> · Proof attached</span>}
                  </p>

                  {row.activeVersion > 1 && (
                    <button
                      type="button"
                      className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-medium text-primary hover:underline"
                      onClick={() => setHistoryRow(row)}
                    >
                      <History className="size-3" aria-hidden /> View history
                    </button>
                  )}

                  {canAct && row.id && row.status === "pending" && (
                    <div className="mt-2">
                      <SendControl row={row} disabled={busyId === row.id} onSend={sendWithOptionalProof} />
                    </div>
                  )}

                  {canAct && row.id && row.status === "sent" && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Button
                        size="sm"
                        disabled={busyId === row.id}
                        onClick={() => {
                          const id = row.id!;
                          run(id, () => markApprovalApproved(id), "Marked approved");
                        }}
                      >
                        <CheckCircle2 aria-hidden /> Approve
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === row.id}
                        onClick={() => setReworkId(reworkId === row.id ? null : row.id)}
                      >
                        <RotateCcw aria-hidden /> Rework
                      </Button>
                    </div>
                  )}

                  {reworkId === row.id && row.id && (
                    <ReworkForm
                      disabled={busyId === row.id}
                      onCancel={() => setReworkId(null)}
                      onConfirm={(remarks) => {
                        const id = row.id!;
                        setReworkId(null);
                        run(id, () => markApprovalRework(id, undefined, remarks), "Sent back for rework");
                      }}
                    />
                  )}
                </div>
              ))
            )}
          </div>
        ))}
      </div>

      {historyRow && (
        <HistorySheet row={historyRow} onClose={() => setHistoryRow(null)} />
      )}
    </>
  );
}

/** "Mark Sent", with an optional file attached in the same click — same
 *  Dispatch Proof enforcement as the standalone board's own `SendControl`:
 *  a `requiresProof` approval drops the no-file button entirely, and
 *  `markApprovalSent` re-checks this server-side regardless. */
function SendControl({
  row,
  disabled,
  onSend,
}: {
  row: OrderApprovalRow;
  disabled: boolean;
  onSend: (row: OrderApprovalRow, file: File | null) => void;
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
        <Upload aria-hidden /> Attach &amp; Send
      </Button>
      {!row.requiresProof && (
        <Button size="sm" disabled={disabled} onClick={() => onSend(row, null)}>
          <Send aria-hidden /> Mark Sent
        </Button>
      )}
    </div>
  );
}

/** The remarks box a Rework needs before it can be confirmed — mandatory,
 *  per `markApprovalRework`'s own server-side refusal. */
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
      <label className="block text-xs font-medium text-foreground" htmlFor="order-approval-rework-remarks">
        Buyer&apos;s feedback (required)
      </label>
      <Input
        id="order-approval-rework-remarks"
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

function HistorySheet({ row, onClose }: { row: OrderApprovalRow; onClose: () => void }) {
  const [entries, setEntries] = useState<ApprovalHistoryEntry[] | null>(null);

  useEffect(() => {
    if (!row.id) return;
    let cancelled = false;
    getApprovalHistory(row.id).then((rows) => {
      if (!cancelled) setEntries(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  return (
    <Sheet open onClose={onClose} title={`${row.approvalName} — history`} size="sm">
      {entries === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No prior rejections recorded.</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => (
            <li key={e.version} className={cn("rounded-md border border-border p-2.5 text-sm")}>
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
