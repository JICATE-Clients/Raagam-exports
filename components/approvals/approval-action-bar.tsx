"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, RotateCcw, X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
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
export function ApprovalActionBar({
  run,
  verdict,
  subjectPath,
}: {
  run: ApprovalRun;
  verdict: CanActVerdict;
  /** The document's own route, so its page revalidates with the queue. */
  subjectPath?: string;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [pending, setPending] = useState<RunAction | null>(null);
  const [comment, setComment] = useState("");

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
    approve: { title: "Approve this request?", verb: "Approve", needsComment: false },
    return: { title: "Return for changes?", verb: "Return", needsComment: true },
    reject: { title: "Reject this request?", verb: "Reject", needsComment: true },
  };

  const commentRequired = pending
    ? COPY[pending].needsComment || isOverride
    : false;
  const canSubmit = !commentRequired || comment.trim().length > 0;

  function submit() {
    if (!pending) return;
    const action = pending;
    start(async () => {
      const res = await actOnRun({
        runId: run.id,
        action,
        lockVersion: run.lock_version,
        comment: comment.trim() || undefined,
        subjectPath,
      });
      if (res.ok) {
        success(
          action === "approve"
            ? "Approved"
            : action === "reject"
              ? "Rejected"
              : "Returned for changes",
        );
        setPending(null);
        setComment("");
        /* The page re-reads the run, the verdict and the subject's own status.
           `revalidatePath` on the server invalidated them; this is what makes
           the screen show the result rather than the state it was rendered in. */
        router.refresh();
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
        <span className="text-xs text-muted-foreground">
          Step {verdict.step_order}
          {verdict.step_label ? ` · ${verdict.step_label}` : ""}
        </span>

        {/* AN OVERRIDE SAYS SO, LOUDLY AND BEFORE THE CLICK. A super admin acting
            on a run they were not routed to is recorded `is_override = true` in
            the event log for ever. Someone who did not realise they were
            overriding cannot explain it afterwards, and the comment the database
            demands would be written without knowing what it was for. */}
        {isOverride && (
          <span className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-xs font-medium text-warning">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            You are not an approver on this step — acting here is recorded as an
            override
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPending("reject")}
            disabled={isPending}
          >
            <X className="h-4 w-4" aria-hidden />
            Reject
          </Button>
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
          <Button
            type="button"
            size="sm"
            onClick={() => setPending("approve")}
            disabled={isPending}
          >
            <Check className="h-4 w-4" aria-hidden />
            Approve
          </Button>
        </div>
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
        }}
        title={pending ? COPY[pending].title : ""}
        /* `sm` and not full-screen: this is one textarea and two buttons. A
           full-bleed takeover for a confirm reads as a much larger decision
           than it is. */
        size="sm"
        fullScreen={false}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setPending(null);
                setComment("");
              }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
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
        <Field
          label={commentRequired ? "Reason" : "Comment"}
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
