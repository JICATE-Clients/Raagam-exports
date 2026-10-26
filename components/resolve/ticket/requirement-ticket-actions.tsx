"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, MessageSquarePlus, PackageCheck, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { addNote } from "@/lib/resolve/actions";
import { decideRequirement, fulfilRequirement, withdrawRequirement } from "@/lib/resolve/assist-actions";
import type { NoteVisibility, TicketAction, TicketListRow } from "@/lib/resolve/types";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
type Dialog = "approve" | "reject" | "fulfil" | "note";

/**
 * A REQUIREMENT'S NEXT-ACTION PANEL (0751) — exactly `actions`, never
 * re-derived: `rh__rq_actions` decides who may approve, reject, mark given or
 * withdraw, and each RPC re-checks it. Approve and Mark as given take an
 * optional note; Reject needs the reason the person who asked will read;
 * Withdraw confirms, because it cannot be undone.
 *
 * One filled button: Approve while it is Pending, Mark as given once approved.
 */
export function RequirementTicketActions({ ticket, actions }: { ticket: TicketListRow; actions: TicketAction[] }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState<NoteVisibility>(
    actions.includes("note_internal") ? "internal" : "reporter",
  );
  useUnsavedGuard(isPending);

  const has = (a: TicketAction) => actions.includes(a);
  const canNote = has("note_internal") || has("note_reporter");

  function open(d: Dialog) {
    setText("");
    setVisibility(has("note_internal") ? "internal" : "reporter");
    setDialog(d);
  }

  function run<T>(call: () => Promise<Result<T>>, done: string) {
    startTransition(async () => {
      const res = await call();
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      setDialog(null);
      setWithdrawOpen(false);
      success(done);
      router.refresh();
    });
  }

  const note = text.trim();
  const dialogs: Record<Dialog, { title: string; confirm: string; tone?: "danger"; ok: boolean; go: () => void; body: ReactNode }> = {
    approve: {
      title: `Approve ${ticket.ref_no}`,
      confirm: "Approve",
      ok: true,
      go: () => run(() => decideRequirement(ticket.id, true, note || null), "Approved. The person who asked has been told."),
      body: (
        <Field label="Note" hint="Optional — for example, when it will be ready.">
          <Textarea rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      ),
    },
    reject: {
      title: `Reject ${ticket.ref_no}`,
      confirm: "Reject",
      tone: "danger",
      ok: note.length >= 3,
      go: () => run(() => decideRequirement(ticket.id, false, note), "Rejected. The person who asked can read your reason."),
      body: (
        <Field label="Reason" required hint="The person who asked reads this.">
          <Textarea rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      ),
    },
    fulfil: {
      title: `Mark ${ticket.ref_no} as given`,
      confirm: "Mark as given",
      ok: true,
      go: () => run(() => fulfilRequirement(ticket.id, note || null), "Marked as given. The request is closed."),
      body: (
        <Field label="Note" hint="Optional — for example, where to collect it.">
          <Textarea rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      ),
    },
    note: {
      title: "Add a note",
      confirm: "Add note",
      ok: note !== "",
      go: () =>
        run(
          () => addNote(ticket.id, note, visibility),
          visibility === "internal" ? "Internal note added." : "Note added. The person who asked can see it.",
        ),
      body: (
        <div className="space-y-3">
          {has("note_internal") && has("note_reporter") ? (
            <Field label="Who can see it">
              <Segmented<NoteVisibility>
                name={`rh-rq-note-vis-${ticket.id}`}
                value={visibility}
                onChange={setVisibility}
                options={[
                  { value: "internal", label: "Staff only" },
                  { value: "reporter", label: "Asker too" },
                ]}
              />
            </Field>
          ) : null}
          <Field label="Note" required>
            <Textarea rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        </div>
      ),
    },
  };
  const active = dialog ? dialogs[dialog] : null;

  const anything = has("rq_approve") || has("rq_reject") || has("rq_fulfil") || has("rq_withdraw") || canNote;
  if (!anything) {
    return <p className="text-sm text-muted-foreground">Nothing for you to do here right now.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {has("rq_approve") ? (
          <Button type="button" disabled={isPending} onClick={() => open("approve")}>
            <Check className="h-4 w-4" aria-hidden />
            Approve
          </Button>
        ) : null}
        {has("rq_fulfil") ? (
          <Button type="button" disabled={isPending} onClick={() => open("fulfil")}>
            <PackageCheck className="h-4 w-4" aria-hidden />
            Mark as given
          </Button>
        ) : null}
        {has("rq_reject") ? (
          <Button type="button" variant="outline" disabled={isPending} onClick={() => open("reject")}>
            <X className="h-4 w-4" aria-hidden />
            Reject
          </Button>
        ) : null}
        {has("rq_withdraw") ? (
          <Button type="button" variant="outline" disabled={isPending} onClick={() => setWithdrawOpen(true)}>
            <Undo2 className="h-4 w-4" aria-hidden />
            Withdraw
          </Button>
        ) : null}
        {canNote ? (
          <Button type="button" variant="outline" disabled={isPending} onClick={() => open("note")}>
            <MessageSquarePlus className="h-4 w-4" aria-hidden />
            Add note
          </Button>
        ) : null}
      </div>

      <Sheet
        open={active !== null}
        onClose={() => setDialog(null)}
        title={active?.title ?? ""}
        size="sm"
        footer={
          active ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialog(null)} disabled={isPending}>
                Back
              </Button>
              <Button
                type="button"
                variant={active.tone === "danger" ? "danger" : "primary"}
                disabled={isPending || !active.ok}
                onClick={active.go}
              >
                {isPending ? "Working…" : active.confirm}
              </Button>
            </div>
          ) : null
        }
      >
        {active?.body}
      </Sheet>

      <ConfirmDialog
        open={withdrawOpen}
        title={`Withdraw ${ticket.ref_no}?`}
        body="Stores stops looking at it. This cannot be undone — you would need to ask again."
        confirmLabel="Withdraw"
        cancelLabel="Keep it"
        tone="danger"
        isPending={isPending}
        onConfirm={() => run(() => withdrawRequirement(ticket.id), "Request withdrawn.")}
        onCancel={() => setWithdrawOpen(false)}
      />
    </div>
  );
}
