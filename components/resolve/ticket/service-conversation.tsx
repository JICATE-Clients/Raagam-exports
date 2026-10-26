"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { fmtDateTime } from "@/lib/format";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { addNote } from "@/lib/resolve/actions";
import type { TicketNote } from "@/lib/resolve/types";
import { cn } from "@/lib/utils";

/**
 * A SERVICE TICKET'S CONVERSATION (service-desk-plan §6): the requester-visible
 * notes ARE the thread — the requester's on one side, the desk's on the other —
 * and a reply box under it when `note_reporter` is in the action list. A reply
 * is a note (`rh_add_note`); the notes trigger turns it into a `replied` row,
 * which tells the other side, and from a technician counts as the first
 * response. Internal notes are the staff-only half, drawn apart and amber so a
 * technician never mistakes which box the requester reads.
 *
 * Each box is its own `data-focus-scope` form, answering keys by the shared
 * contract (no handler of its own): Enter in a Textarea is a new line, the
 * button sends.
 */
export function ServiceConversation({
  ticketId,
  notes,
  reporterId,
  canReply,
  canInternal,
  isStaff,
}: {
  ticketId: string;
  notes: TicketNote[];
  reporterId: string | null;
  canReply: boolean;
  canInternal: boolean;
  isStaff: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState("");
  useUnsavedGuard(reply.trim() !== "" || internal.trim() !== "" || isPending);

  const thread = notes.filter((n) => n.visibility === "reporter");
  const staffNotes = notes.filter((n) => n.visibility === "internal");

  function send(body: string, visibility: "reporter" | "internal", clear: () => void) {
    if (!body.trim()) return;
    startTransition(async () => {
      const res = await addNote(ticketId, body.trim(), visibility);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      clear();
      success(visibility === "internal" ? "Internal note added." : isStaff ? "Reply sent to the requester." : "Reply sent to the desk.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {thread.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isStaff ? "No messages with the requester yet." : "No messages yet. Write here if you have more to tell the desk."}
          </p>
        ) : (
          <ul className="space-y-2">
            {thread.map((n) => {
              const fromRequester = n.author_id === reporterId;
              return (
                <li key={n.id} className={cn("flex", fromRequester ? "justify-start" : "justify-end")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg border p-3",
                      fromRequester ? "border-border bg-surface" : "border-primary/30 bg-primary/5",
                    )}
                  >
                    <p className="text-xs text-muted-foreground">
                      {fromRequester ? (n.author_name ?? "Requester") : `${n.author_name ?? "IT desk"} · IT desk`} ·{" "}
                      {fmtDateTime(n.created_at)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{n.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {canReply ? (
          <form
            data-focus-scope
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(reply, "reporter", () => setReply(""));
            }}
          >
            <Field label={isStaff ? "Reply to the requester" : "Reply to the desk"}>
              <Textarea
                rows={3}
                maxLength={2000}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
              />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="outline" disabled={isPending || !reply.trim()}>
                <Send className="h-4 w-4" aria-hidden />
                Send reply
              </Button>
            </div>
          </form>
        ) : null}
      </div>

      {isStaff ? (
        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            Internal notes — staff only
          </h3>
          {staffNotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No internal notes.</p>
          ) : (
            <ul className="space-y-2">
              {staffNotes.map((n) => (
                <li key={n.id} className="rounded-lg border border-dashed border-warning/50 bg-warning-soft/30 p-3">
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <StatusPill tone="warning">
                      <Lock className="h-3 w-3" aria-hidden />
                      Internal
                    </StatusPill>
                    {n.author_name ?? "—"} · {fmtDateTime(n.created_at)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{n.body}</p>
                </li>
              ))}
            </ul>
          )}
          {canInternal ? (
            <form
              data-focus-scope
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                send(internal, "internal", () => setInternal(""));
              }}
            >
              <Field label="Internal note" hint="The requester never sees this.">
                <Textarea rows={2} maxLength={2000} value={internal} onChange={(e) => setInternal(e.target.value)} />
              </Field>
              <div className="flex justify-end">
                <Button type="submit" variant="outline" disabled={isPending || !internal.trim()}>
                  Add internal note
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
