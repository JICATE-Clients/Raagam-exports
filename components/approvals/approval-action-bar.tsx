"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, FileX, RotateCcw, X, TriangleAlert } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { FILE_NOT_RECEIVED } from "@/lib/sales/pd-requests/words";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { actOnRun } from "@/lib/approvals/actions";
import type { ApprovalRun, CanActVerdict, RunAction } from "@/lib/approvals/types";

/**
 * APPROVE / RETURN / REJECT for the current step of one run.
 *
 * Mount it unconditionally on a document's detail screen — it renders NOTHING
 * unless the server said this user may act, so there is no permission check to
 * write at the call site and none to get wrong.
 *
 * ## TWO THINGS ARE LOAD-BEARING. Do not "simplify" either.
 *
 * 1. `lock_version` IS READ FROM THE RUN AND SENT BACK WITH EVERY ACTION. It is
 *    required all the way down to SQL, with no default anywhere. Two approvers
 *    with the page open at once is the normal case, not the exotic one; without
 *    this the second click silently double-advances the run past a step nobody
 *    approved. The second approver gets "someone else acted on this while you
 *    had it open", which is the correct answer.
 *
 * 2. WHETHER THE BAR RENDERS AT ALL COMES FROM `approval_can_act` — the SAME
 *    predicate the inbox queue is built from. Deriving it here from a role check
 *    is precisely how a queue and a gate drift apart: the request appears in
 *    someone's list and then refuses them when they open it, or worse, offers a
 *    button to someone the database will reject.
 *
 * ## THE VERDICT IS FETCHED BY THE PAGE, NOT BY THIS COMPONENT
 *
 * `canAct()` is `server-only`. The page awaits it and passes it down, which also
 * means the bar has no loading state to flicker through — on a server-rendered
 * screen the answer is already there when the markup is.
 */
/**
 * THE THREE FIELDS THIS BAR ACTUALLY READS.
 *
 * Widened from `ApprovalRun` (0601) so the approvals INBOX can mount the bar
 * too: a queue row already carries `run_id`, `lock_version` and — by being in
 * the queue at all — `in_progress`, and fetching the whole run per row to
 * satisfy a type would be three extra round trips per card for fields nothing
 * renders. A full `ApprovalRun` still satisfies this, so no existing call site
 * changes.
 *
 * `lock_version` is the one that must keep coming from a fresh read — see the
 * numbered note above. A queue row IS a fresh read; a cached one is not.
 */
export type ActionBarRun = Pick<ApprovalRun, "id" | "lock_version" | "status">;

export function ApprovalActionBar({
  run,
  verdict,
  subjectPath,
  onDone,
  rework = false,
  acknowledge = false,
  compact = false,
  overrideNote = true,
}: {
  run: ActionBarRun;
  verdict: CanActVerdict;
  /** The document's own route, so its page revalidates with the queue. */
  subjectPath?: string;
  /** After a decision lands — e.g. close the sheet holding this bar, whose
   *  run and verdict were read before the decision and are now stale. */
  onDone?: () => void;
  /**
   * THE ORDER-BUDGET WORDING (client 2026-09-29, "Request Rework"): two
   * buttons, Approve and Request Rework — no Return.
   *
   * Request Rework IS the engine's `reject`, relabelled, not a new action: on
   * a first-time budget it sends the budget back to the merchandiser
   * (`rejected`, editable, resubmittable); on a revision the terminal trigger
   * restores V0 (`order_amendment_revert`). Return is withheld because on the
   * one-step MD flow it restarts the run at step 1 — the MD's own queue —
   * while the budget stays `submitted` and the merchandiser cannot touch it:
   * a button that reads "send it back" and sends it nowhere.
   */
  rework?: boolean;
  /**
   * THE SAMPLE DEPARTMENT'S WORDING (Sample ▸ Acknowledge PD Request, client
   * spec 2026-10-14): Acknowledge and Not Acknowledged — the engine's approve
   * and reject, relabelled, exactly as `rework` relabels reject. No Return,
   * for `rework`'s reason: on a one-step flow it re-queues the request to the
   * same department while the merchandiser can do nothing with it.
   */
  acknowledge?: boolean;
  /** Drop the "Step n · label" line — for a card that already says whose
   *  decision it is. The override warning is never dropped. */
  compact?: boolean;
  /**
   * `false` ONLY when the caller prints the override warning itself, beside
   * the figures (the desktop approval page puts this bar in its header and the
   * warning in its right column). Never false with nothing else saying it:
   * someone who did not realise they were overriding cannot explain it later.
   */
  overrideNote?: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [pending, setPending] = useState<RunAction | null>(null);
  const [comment, setComment] = useState("");
  /** `acknowledge` only: the reject being confirmed is File Not Received. */
  const [fileMissing, setFileMissing] = useState(false);

  if (!verdict.can_act || run.status !== "in_progress") return null;

  const isOverride = Boolean(verdict.is_override);

  /**
   * A COMMENT IS MANDATORY FOR EVERY NEGATIVE OUTCOME, AND FOR EVERY OVERRIDE.
   *
   * The database enforces both — an override with no explanation is an audit
   * gap, and "returned for changes" with no reason tells the requester nothing.
   * Asking here as well is not a duplicate rule; it is what stops the operator
   * committing to a decision and only then being refused.
   */
  const COPY: Record<RunAction, { title: string; verb: string; needsComment: boolean }> = {
    approve: acknowledge
      ? { title: "Acknowledge this request?", verb: "Acknowledge", needsComment: false }
      : { title: "Approve this request?", verb: "Approve", needsComment: false },
    return: { title: "Return for changes?", verb: "Return", needsComment: true },
    reject: acknowledge
      ? fileMissing
        ? /* The reason IS the choice — written for them (see `submit`); a note is optional. */
          { title: "Mark this request File Not Received?", verb: "File Not Received", needsComment: false }
        : { title: "Mark this request Not Acknowledged?", verb: "Not Acknowledged", needsComment: true }
      : rework
      ? { title: "Send back for rework?", verb: "Request Rework", needsComment: true }
      : { title: "Reject this request?", verb: "Reject", needsComment: true },
  };

  const commentRequired = pending
    ? COPY[pending].needsComment || isOverride
    : false;
  const canSubmit = !commentRequired || comment.trim().length > 0;

  function submit() {
    if (!pending) return;
    const action = pending;
    const note = comment.trim();
    /* FILE NOT RECEIVED leads the remark with the fixed reason — the marker
       `isFileNotReceived` reads back on every PD screen (lib/sales/pd-requests/words.ts). */
    const sent = acknowledge && fileMissing && action === "reject" ? (note ? `${FILE_NOT_RECEIVED} — ${note}` : FILE_NOT_RECEIVED) : note;
    start(async () => {
      const res = await actOnRun({
        runId: run.id,
        action,
        lockVersion: run.lock_version,
        comment: sent || undefined,
        subjectPath,
      });
      if (res.ok) {
        success(
          action === "approve"
            ? acknowledge
              ? "Acknowledged"
              : "Approved"
            : action === "reject"
              ? acknowledge
                ? fileMissing
                  ? "Marked File Not Received"
                  : "Marked Not Acknowledged"
                : rework
                ? "Sent back for rework"
                : "Rejected"
              : "Returned for changes",
        );
        setPending(null);
        setComment("");
        setFileMissing(false);
        /* NO SECOND PAGE LOAD WHEN THE ACTION ALREADY SENT ONE (2026-09-24,
           "approving takes 3 s"). `actOnRun` calls `revalidatePath` on
           /approvals and on `subjectPath`, and a server action that revalidates
           the CURRENT page returns its fresh render in the SAME response — so
           a `router.refresh()` here fetched the whole page a second time
           (~8 round trips, ~2 s) with the buttons still disabled. Every caller
           passes its own page as `subjectPath`; only a caller that passes none
           still needs the refresh. */
        if (!subjectPath) router.refresh();
        onDone?.();
      } else {
        toastError(res.error);
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {/* THE STEP IS NAMED, not just the buttons offered. "Approve" with no
            context is a button an operator presses without knowing what they
            are signing as — the step label is the whole answer to "on whose
            behalf am I doing this". */}
        {!compact && (
          <span className="text-xs text-muted-foreground">
            Step {verdict.step_order}
            {verdict.step_label ? ` · ${verdict.step_label}` : ""}
          </span>
        )}

        {/* AN OVERRIDE SAYS SO, LOUDLY AND BEFORE THE CLICK. A super admin acting
            on a run they were not routed to is recorded `is_override = true` in
            the event log for ever. Someone who did not realise they were
            overriding cannot explain it afterwards, and the comment the database
            demands would be written without knowing what it was for. */}
        {isOverride && overrideNote && (
          <span className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-xs font-medium text-warning">
            <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
            You are not an approver on this step — acting here is recorded as an
            override
          </span>
        )}

        {/* THE DEPARTMENT'S ANSWER IS ONE DROPDOWN (user 2026-10-16: "acknowledged,
            not acknowledged, file not received in dropdown"). Three answers, one
            control — each opens the same confirm below. File Not Received is the
            engine's reject with its reason filled in. */}
        {acknowledge ? (
          <div className="ml-auto">
            <DropdownMenu
              label="Decision"
              align="right"
              triggerClassName={buttonClasses({ variant: "primary", size: "sm" })}
              trigger={
                <>
                  Decision <ChevronDown aria-hidden />
                </>
              }
              items={[
                { label: "Acknowledged", icon: Check, onClick: () => { setFileMissing(false); setPending("approve"); }, disabled: isPending },
                { label: "Not Acknowledged", icon: X, danger: true, onClick: () => { setFileMissing(false); setPending("reject"); }, disabled: isPending },
                { label: "File Not Received", icon: FileX, danger: true, onClick: () => { setFileMissing(true); setPending("reject"); }, disabled: isPending },
              ]}
            />
          </div>
        ) : (
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPending("reject")}
            disabled={isPending}
          >
            {rework ? <RotateCcw className="h-4 w-4" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
            {COPY.reject.verb}
          </Button>
          {!rework && !acknowledge && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPending("return")}
              disabled={isPending}
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              Return
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={() => setPending("approve")}
            disabled={isPending}
          >
            <Check className="h-4 w-4" aria-hidden />
            {COPY.approve.verb}
          </Button>
        </div>
        )}
      </div>

      {/* A `Sheet`, not a hand-rolled overlay: it already registers with
          `lib/reload-guard.ts`, so a silent PWA auto-update cannot reload the tab
          over a half-typed rejection reason (AGENTS.md, Auto-reload guard). A
          bare `fixed inset-0` div would need `useModalGuard` written by hand and
          would be invisible to the guard's DOM scan. */}
      <Sheet
        open={pending !== null}
        onClose={() => {
          setPending(null);
          setComment("");
          setFileMissing(false);
        }}
        title={pending ? COPY[pending].title : ""}
        /* A CENTRED POP-UP, NOT A SIDE DRAWER (user 2026-10-16: "approval now as
           side screen — update it as center pop-up while approving"). It was
           `fullScreen={false}`, Sheet's right-hand slide-over; `sm` on its own is
           Sheet's centred box over the content pane — the shape the buyer's
           Customer Approved / Rejected confirm already takes. Still `sm`: one
           textarea and two buttons, never a full-bleed takeover. One component,
           so every approval screen (inbox, budget, plan, fines, IWO BOMs, sample
           decisions) changes together. */
        size="sm"
        alignToPane
        /* The bar is often mounted INSIDE a sheet (the inbox's decision sheet,
           Sample ▸ decision) — the confirm must stack above its host. 120 is the
           level every nested sheet in this app uses. */
        zIndexBase={120}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => {
                setPending(null);
                setComment("");
                setFileMissing(false);
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="md"
              onClick={submit}
              disabled={!canSubmit || isPending}
            >
              {pending ? COPY[pending].verb : ""}
            </Button>
          </div>
        }
      >
        {/* NO `size` HERE. `size` is a SPAN across a `FieldGrid`'s 12 columns,
            and this sheet has no grid — a lone `size="full"` outside one applies
            nothing and reads as a width that was set (`--check field-track`
            catches exactly that). The sheet body is already one column wide, so
            the field fills it without being told to. */}
        {acknowledge && fileMissing && pending === "reject" ? (
          <p className="text-sm">
            The merchandiser sees <b>{FILE_NOT_RECEIVED}</b> as the reason, with your note after it.
          </p>
        ) : null}
        <Field
          label={commentRequired ? "Reason" : acknowledge && fileMissing ? "Note (optional)" : "Comment"}
          required={commentRequired}
          htmlFor="approval-comment"
        >
          <Textarea
            id="approval-comment"
            rows={4}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </Field>
        {commentRequired && (
          <p className="text-xs text-muted-foreground">
            {isOverride
              ? "This is an override, so the reason is recorded against your name in the audit trail."
              : "The requester sees this, and it is what tells them what to change."}
          </p>
        )}
      </Sheet>
    </>
  );
}
