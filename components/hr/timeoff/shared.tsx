"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { VoiceTextarea } from "@/components/ui/voice-textarea";
import { ApprovalTimeline } from "@/components/approvals/approval-timeline";
import { ApprovalActionBar } from "@/components/approvals/approval-action-bar";
import { forwardTimeoff, type loadTimeoffPanel } from "@/lib/hr/timeoff-actions";
import { fmtDate } from "@/lib/format";
import { hhmm, type TimeoffRequest } from "@/lib/hr/timeoff-types";

/** Shared pieces of the HR ▸ Time Off screens (0770). */

/** One label/value line of a record summary. */
export function Fact({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-36 shrink-0 text-muted-foreground">{label}</dt>
      <dd className={className}>{children}</dd>
    </div>
  );
}

/** The leave type's colour, as a dot before its name. */
export function TypeDot({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

/** "12/11/2026", "12/11/2026 (1st half)", "12/11/2026 10:00–11:30", "12/11 → 14/11/2026". */
export function whenOf(r: Pick<TimeoffRequest, "start_date" | "end_date" | "day_part" | "start_time" | "end_time">): string {
  if (r.day_part === "hourly") return `${fmtDate(r.start_date)} ${hhmm(r.start_time)}–${hhmm(r.end_time)}`;
  if (r.start_date === r.end_date) {
    if (r.day_part === "first_half") return `${fmtDate(r.start_date)} (1st half)`;
    if (r.day_part === "second_half") return `${fmtDate(r.start_date)} (2nd half)`;
    return fmtDate(r.start_date);
  }
  return `${fmtDate(r.start_date)} → ${fmtDate(r.end_date)}`;
}

/**
 * A small sheet that asks for a reason before a consequential step — withdraw,
 * cancel, revoke, reject. The reason is mandatory everywhere it is used, as in
 * the database.
 */
export function ReasonSheet({
  open,
  title,
  intro,
  confirmLabel,
  danger = false,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  intro: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Sheet
      open={open}
      onClose={() => {
        setReason("");
        onClose();
      }}
      title={title}
      asPage
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={busy || !reason.trim()}
            onClick={() => {
              onConfirm(reason);
              setReason("");
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <div>{intro}</div>
        <Field label="Reason" required>
          <VoiceTextarea rows={2} value={reason} onValueChange={setReason} />
        </Field>
      </div>
    </Sheet>
  );
}

export type TimeoffPanel = Awaited<ReturnType<typeof loadTimeoffPanel>>;

/**
 * THE APPROVAL TRAIL OF ONE REQUEST (user 2026-11-05: "if I click a leave it
 * should show all the details and the flow"). Every request walks Department
 * HOD → HR Manager → ED (0817); this says where it is, who signed each stage
 * and when, who it waits for by name, and — when it was rejected or withdrawn
 * part-way — that it stopped there and the later stages were never reached.
 * The approver on the current step gets Approve / Reject under it.
 *
 * One component for the three places a request is opened (its own list, the
 * encashment list, the Approvals queue), so they cannot describe it three ways.
 */
export function ApprovalTrail({
  panel,
  subjectPath,
  onDone,
  decide = true,
}: {
  panel: TimeoffPanel;
  subjectPath: string;
  onDone?: () => void;
  /** false where the screen draws its own Approve / Reject (the Approvals queue). */
  decide?: boolean;
}) {
  const [sending, startSending] = useTransition();
  const [sendError, setSendError] = useState<string | null>(null);
  const run = panel.run;
  if (!run) return null;
  /* An ESCALATION, not three signatures (0820, user 2026-11-06): whoever has
     it approves or rejects and that closes it; "Send to …" is the only way it
     climbs to the HR Manager, then the ED. */
  const at = run.steps_snapshot[run.current_step - 1]?.step_label ?? `Step ${run.current_step}`;
  const next = run.status === "in_progress" ? panel.next : null;
  const summary =
    run.status === "in_progress"
      ? `With the ${at} — waiting for ${panel.waiting.length ? panel.waiting.join(", ") : at}`
      : run.status === "completed"
        ? `Approved by the ${at} — closed`
        : run.status === "rejected"
          ? `Rejected by the ${at} — closed`
          : `Withdrawn while with the ${at} — closed`;
  const kind =
    run.subject_table === "timeoff_encashments"
      ? "encashment"
      : run.subject_table === "timeoff_comp_off_credits"
        ? "claim"
        : "request";
  function sendOn() {
    if (!run) return;
    setSendError(null);
    startSending(async () => {
      const r = await forwardTimeoff(kind, run.subject_id, "");
      if (!r.ok) setSendError(r.error);
      else onDone?.();
    });
  }
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Approval flow</h3>
      <p className="text-sm font-medium">{summary}</p>
      <ApprovalTimeline
        rows={panel.timeline}
        resolveUserName={(id) => panel.names[id]}
        closed={run.status !== "in_progress"}
        waitingOn={panel.waiting}
      />
      {decide && panel.verdict && <ApprovalActionBar run={run} verdict={panel.verdict} subjectPath={subjectPath} onDone={onDone} />}
      {decide && panel.verdict?.can_act && next && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={sending} onClick={sendOn}>
            {sending ? "Sending…" : `Send to ${next}`}
          </Button>
          <span className="text-xs text-muted-foreground">if it needs the {next}&apos;s attention</span>
          {sendError && <span className="text-xs text-danger">{sendError}</span>}
        </div>
      )}
    </section>
  );
}
