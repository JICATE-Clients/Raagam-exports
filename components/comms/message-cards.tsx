"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type CSSProperties } from "react";
import { CalendarDays, CalendarX2, Check, Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { openDirect } from "@/lib/comms/actions";
import { votePoll } from "@/lib/comms/card-actions";
import type { EventData, PollData } from "@/lib/comms/cards";
import type { CommMessage } from "@/lib/comms/types";
import { fmtDateTime } from "@/lib/format";
import { glowVars } from "@/lib/ui/buyer-glow";
import { cn } from "@/lib/utils";
import { EditEventSheet } from "./attach-sheets";
import { Face } from "./person-photo";

/**
 * The 📎 cards inside a message (0776; lib/comms/cards.ts). Each sits on its
 * own white face so it reads the same in your coral bubble and in someone
 * else's white one — the bubble's colour rules recolour `text-foreground` /
 * `text-muted-foreground`, so these use `text-heading` and a fixed muted tone.
 *
 * A vote or an answer is sent, and the message the server hands back (fresh
 * counts) replaces the one on screen; everyone else's chat catches up through
 * the message's UPDATE (0776, "LIVE COUNTS").
 */
const FACE = "mt-0.5 rounded-xl bg-surface p-2.5 text-heading shadow-[inset_0_0_0_1px_var(--color-border)]";
const MUTED = "text-[#667085] dark:text-[#9aa3b5]";
const GREEN = "text-[#15603e] dark:text-[#7ae3a5]";

export function PollCard({
  message,
  poll,
  canAct,
  onReplace,
  names,
  meId,
  memberIds,
}: {
  message: CommMessage;
  poll: PollData;
  canAct: boolean;
  onReplace?: (m: CommMessage) => void;
  /** Member names, for the faces and "View votes" (user 2026-11-10). */
  names?: Map<string, string | null>;
  meId?: string;
  memberIds?: string[];
}) {
  const toast = useToast();
  const [busy, start] = useTransition();
  const [viewing, setViewing] = useState(false);
  const total = poll.options.reduce((n, o) => n + o.votes, 0);

  function vote(i: number) {
    if (!canAct || busy) return;
    const mine = poll.options.flatMap((o, j) => (o.mine ? [j] : []));
    const next = poll.multi ? (mine.includes(i) ? mine.filter((j) => j !== i) : [...mine, i]) : mine.includes(i) ? [] : [i];
    start(async () => {
      const r = await votePoll(message.id, next);
      if (!r.ok) return toast.error(r.error);
      if (r.message) onReplace?.(r.message);
    });
  }

  return (
    // Straight on the bubble, then a full-width "View votes" strip (user 2026-11-10, the WhatsApp card).
    <div className="-mx-1 mt-0.5 flex w-[min(21rem,72vw)] flex-col" role="group" aria-label={`Poll: ${poll.question}`}>
      <div className="px-1.5 pb-1 pt-1">
        <p className="break-words text-base font-bold text-heading">{poll.question}</p>
        <p className={cn("mb-2 flex items-center gap-1.5 text-[13px]", MUTED)}>
          {poll.multi ? "Select one or more" : "Select one"}
          {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
        </p>
        <ul className="space-y-2">
          {poll.options.map((o, i) => {
            const share = total ? Math.round((o.votes / total) * 100) : 0;
            return (
              <li key={i}>
                <button
                  type="button"
                  role={poll.multi ? "checkbox" : "radio"}
                  aria-checked={o.mine}
                  disabled={!canAct || busy}
                  onClick={() => vote(i)}
                  className="grid w-full grid-cols-[1.375rem_1fr_auto] items-center gap-x-3 gap-y-1.5 rounded-lg px-1 py-1 text-left text-[15px] text-heading hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-[22px] w-[22px] items-center justify-center border-2",
                      poll.multi ? "rounded-md" : "rounded-full",
                      o.mine ? "border-[#15603e] bg-[#15603e] text-white dark:border-[#7ae3a5] dark:bg-[#7ae3a5] dark:text-black" : "border-[#54656f]",
                    )}
                  >
                    {o.mine && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className="break-words">{o.text}</span>
                  <span className={cn("flex items-center gap-1 text-xs tabular-nums", MUTED)}>
                    <VoterFaces voters={o.voters} names={names} />
                    {o.votes}
                  </span>
                  <span aria-hidden className="col-start-2 col-end-4 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                    <span className="block h-full rounded-full bg-[#15603e] transition-[width] dark:bg-[#7ae3a5]" style={{ width: `${share}%` }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {poll.voters > 0 && (
        // button-shape: exempt -- the action strip under a card, WhatsApp's "View votes" (user 2026-11-10)
        <button type="button" onClick={() => setViewing(true)} className={cn(STRIP, "mt-1 border-t border-black/10 dark:border-white/10")}>
          View votes
        </button>
      )}
      {viewing && <PollVotesSheet poll={poll} names={names} meId={meId} memberIds={memberIds} onClose={() => setViewing(false)} />}
    </div>
  );
}

/** Up to three faces of the people who picked an option, newest on top (WhatsApp's stack). */
function VoterFaces({ voters, names }: { voters?: { id: string }[]; names?: Map<string, string | null> }) {
  // Optional: a message loaded before the voter lists existed (an open tab across a deploy) has none.
  if (!voters?.length) return null;
  return (
    <span aria-hidden className="flex -space-x-1.5">
      {voters.slice(-3).map((v) => (
        <span
          key={v.id}
          style={glowVars(names?.get(v.id) ?? v.id) as CSSProperties}
          className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--glow)_25%,var(--surface))] text-[8px] font-extrabold text-[var(--ink)] ring-2 ring-surface"
        >
          <Face userId={v.id} name={names?.get(v.id) ?? ""} />
        </span>
      ))}
    </span>
  );
}

/**
 * "View votes" (user 2026-11-10; design: artifact "Poll View Votes"): each
 * option with the people who picked it and when, then who has not voted.
 * Read-only, so no save and no guard; mounted only while open.
 */
function PollVotesSheet({
  poll,
  names,
  meId,
  memberIds,
  onClose,
}: {
  poll: PollData;
  names?: Map<string, string | null>;
  meId?: string;
  memberIds?: string[];
  onClose: () => void;
}) {
  const who = (id: string) => (id === meId ? "You" : (names?.get(id) ?? "Former member"));
  const top = Math.max(...poll.options.map((o) => o.votes));
  const voted = new Set(poll.options.flatMap((o) => (o.voters ?? []).map((v) => v.id)));
  const waiting = memberIds?.filter((id) => !voted.has(id)) ?? null;
  return (
    <Sheet
      open
      onClose={onClose}
      title="Poll details"
      size="sm"
      alignToPane
      footer={
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <p className="break-words text-[15px] font-bold text-heading">{poll.question}</p>
          <p className={cn("text-xs", MUTED)}>
            {memberIds ? `${voted.size} of ${memberIds.length} members voted` : `${voted.size} voted`} · {poll.multi ? "Select one or more" : "Select one"}
          </p>
        </div>
        {poll.options.map((o, i) => (
          <section key={i} className="overflow-hidden rounded-lg border border-border" aria-label={o.text}>
            <header className="flex items-center justify-between gap-2 bg-surface-muted px-3 py-2">
              <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-heading">
                <span className="break-words">{o.text}</span>
                {o.votes > 0 && o.votes === top && (
                  <span className={cn("shrink-0 rounded-full bg-[#d9fdd3] px-2 py-0.5 text-[11px] dark:bg-[#103529]", GREEN)}>Most votes</span>
                )}
              </span>
              <span className={cn("shrink-0 text-xs font-semibold tabular-nums", MUTED)}>
                {o.votes} {o.votes === 1 ? "vote" : "votes"}
              </span>
            </header>
            {o.voters?.length ? (
              <ul>
                {o.voters.map((v) => (
                  <li key={v.id} className="flex items-center gap-2.5 border-t border-border px-3 py-2">
                    <span
                      aria-hidden
                      style={glowVars(names?.get(v.id) ?? v.id) as CSSProperties}
                      className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--glow)_20%,var(--surface))] text-xs font-extrabold text-[var(--ink)]"
                    >
                      <Face userId={v.id} name={names?.get(v.id) ?? ""} />
                    </span>
                    <span className="min-w-0 flex-1 break-words text-sm font-semibold text-heading">{who(v.id)}</span>
                    <span className={cn("shrink-0 text-xs", MUTED)}>{fmtDateTime(v.at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={cn("border-t border-border px-3 py-2 text-xs", MUTED)}>No votes yet</p>
            )}
          </section>
        ))}
        {waiting && waiting.length > 0 && (
          <section className="rounded-lg border border-dashed border-border px-3 py-2" aria-label="Not voted yet">
            <p className="flex justify-between text-sm font-bold text-heading">
              Not voted yet <span className={cn("text-xs font-semibold tabular-nums", MUTED)}>{waiting.length}</span>
            </p>
            <p className={cn("mt-0.5 text-xs", MUTED)}>{waiting.map(who).join(", ")}</p>
          </section>
        )}
      </div>
    </Sheet>
  );
}

/**
 * The event's date the way a chat says it (user 2026-11-10, the WhatsApp card):
 * "Today", "Tomorrow" or "Yesterday" within a day, else DD/MM/YYYY as every
 * date in the app (AGENTS.md "Dates"); then a 12-hour time. `today` is passed
 * in so render stays pure.
 */
function whenText(date: string, time: string | null, today: string): string {
  const dayMs = 86_400_000;
  const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / dayMs);
  const [y, m, d] = date.split("-");
  const day = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday" : `${d}/${m}/${y}`;
  if (!time) return `${day}, all day`;
  const [hh, mm] = time.split(":").map(Number);
  return `${day}, ${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
}

function localToday(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

/** The strip buttons under a card: full width, a hairline above, green words. */
const STRIP = cn(
  "flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent",
  GREEN,
);

export function EventCard({
  message,
  event,
  canAct,
  onReplace,
  names,
}: {
  message: CommMessage;
  event: EventData;
  canAct: boolean;
  onReplace?: (m: CommMessage) => void;
  names?: Map<string, string | null>;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  // Read once per mount: "Tomorrow" is relative to the day the chat was opened.
  const [today] = useState(localToday);
  const off = event.cancelled;
  // Every active member gets Edit event (user 2026-11-10, board 2 of "Chat Event and Poll
  // Cards"); 0824 lets any member save, and its gray note names who changed it.
  const canEdit = canAct && !off;

  return (
    // The card IS the bubble's content (user 2026-11-10, "perfectly this whatsapp"): a tinted
    // panel for the details, then one full-width "Edit event" strip. No Going / Not going (user's pick).
    <div className="-mx-1 mt-0.5 flex w-[min(21rem,72vw)] flex-col" role="group" aria-label={`Event: ${event.name}`}>
      <div className="rounded-md bg-black/[0.04] px-3 py-3 dark:bg-white/[0.06]">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
              off ? "bg-danger/10 text-danger" : "bg-[#c4ebbe] text-[#1c8f4c] dark:bg-[#103529] dark:text-[#7ae3a5]",
            )}
          >
            {off ? <CalendarX2 className="h-5 w-5" /> : <CalendarDays className="h-5 w-5" />}
          </span>
          <span className="min-w-0 flex-1 space-y-0.5">
            <span className={cn("block break-words text-base font-bold text-heading", off && "line-through opacity-70")}>{event.name}</span>
            {off && <span className="block text-sm font-semibold text-danger">Event cancelled</span>}
            <span className={cn("block text-sm", MUTED)}>{whenText(event.event_date, event.event_time, today)}</span>
            {event.location && <span className={cn("block break-words text-sm", MUTED)}>{event.location}</span>}
            {event.description && <span className="block whitespace-pre-line break-words text-sm text-heading">{event.description}</span>}
            {event.going > 0 && (
              <span className={cn("flex items-center gap-1.5 pt-0.5 text-sm", MUTED)}>
                <VoterFaces voters={(event.going_ids ?? []).map((id) => ({ id }))} names={names} />
                {event.going} going
              </span>
            )}
          </span>
        </div>
      </div>
      {canEdit && (
        // button-shape: exempt -- the action strip under a card, WhatsApp's "Edit event" (user 2026-11-10)
        <button type="button" onClick={() => setEditing(true)} className={cn(STRIP, "mt-1 border-t border-black/10 dark:border-white/10")}>
          Edit event
        </button>
      )}
      {editing && (
        <EditEventSheet
          messageId={message.id}
          event={event}
          onClose={() => setEditing(false)}
          onSaved={(fresh) => {
            if (fresh) onReplace?.(fresh);
            toast.success("Event updated.");
          }}
        />
      )}
    </div>
  );
}

export function ContactCard({ contact, meId }: { contact: { id: string; name: string }; meId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const self = contact.id === meId;

  function message() {
    start(async () => {
      const r = await openDirect(contact.id);
      if (!r.ok || !r.id) {
        toast.error(r.ok ? "That chat could not be opened." : r.error);
        return;
      }
      router.push(`/comms/c/${r.id}`);
    });
  }

  return (
    <div className={cn(FACE, "w-[min(17rem,70vw)] p-0")} role="group" aria-label={`Contact: ${contact.name}`}>
      <div className="flex items-center gap-2.5 border-b border-border px-2.5 py-2">
        <span
          aria-hidden
          style={glowVars(contact.name) as CSSProperties}
          className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--glow)_20%,var(--surface))] text-sm font-extrabold text-[var(--ink)]"
        >
          <Face userId={contact.id} name={contact.name} />
        </span>
        <span className="min-w-0 break-words text-sm font-bold">{contact.name}</span>
      </div>
      {!self && (
        // button-shape: exempt -- the action strip under a shared contact, WhatsApp's "Message" link
        <button
          type="button"
          onClick={message}
          disabled={busy}
          className={cn(
            "flex w-full items-center justify-center gap-1.5 py-2 text-sm font-bold hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            GREEN,
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MessageCircle className="h-4 w-4" aria-hidden />} Message
        </button>
      )}
    </div>
  );
}
