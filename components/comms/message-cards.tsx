"use client";

import { useRouter } from "next/navigation";
import { useTransition, type CSSProperties } from "react";
import { Check, Loader2, MapPin, MessageCircle } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { openDirect } from "@/lib/comms/actions";
import { rsvpEvent, votePoll } from "@/lib/comms/card-actions";
import type { EventData, PollData, RsvpAnswer } from "@/lib/comms/cards";
import type { CommMessage } from "@/lib/comms/types";
import { glowVars } from "@/lib/ui/buyer-glow";
import { cn } from "@/lib/utils";
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
}: {
  message: CommMessage;
  poll: PollData;
  canAct: boolean;
  onReplace?: (m: CommMessage) => void;
}) {
  const toast = useToast();
  const [busy, start] = useTransition();
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
    <div className={cn(FACE, "w-[min(20rem,70vw)]")} role="group" aria-label={`Poll: ${poll.question}`}>
      <p className="break-words text-[15px] font-bold">{poll.question}</p>
      <p className={cn("mb-1 text-xs", MUTED)}>{poll.multi ? "Select one or more" : "Select one"}</p>
      <ul className="space-y-1">
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
                className="grid w-full grid-cols-[1.25rem_1fr_auto] items-center gap-x-2 gap-y-1 rounded-lg px-1 py-1 text-left text-sm hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex h-5 w-5 items-center justify-center border-2",
                    poll.multi ? "rounded-md" : "rounded-full",
                    o.mine ? "border-[#15603e] bg-[#15603e] text-white dark:border-[#7ae3a5] dark:bg-[#7ae3a5] dark:text-black" : "border-[#54656f]",
                  )}
                >
                  {o.mine && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="break-words">{o.text}</span>
                <span className={cn("text-xs tabular-nums", MUTED)}>{o.votes}</span>
                <span aria-hidden className="col-start-2 col-end-4 h-1.5 overflow-hidden rounded-full bg-border">
                  <span className="block h-full rounded-full bg-[#15603e] transition-[width] dark:bg-[#7ae3a5]" style={{ width: `${share}%` }} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className={cn("mt-1 flex items-center gap-1.5 text-xs", MUTED)}>
        {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
        {poll.voters} {poll.voters === 1 ? "person voted" : "people voted"}
      </p>
    </div>
  );
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const ANSWERS: { value: RsvpAnswer; label: string }[] = [
  { value: "going", label: "Going" },
  { value: "maybe", label: "Maybe" },
  { value: "no", label: "Can't go" },
];

export function EventCard({
  message,
  event,
  canAct,
  onReplace,
}: {
  message: CommMessage;
  event: EventData;
  canAct: boolean;
  onReplace?: (m: CommMessage) => void;
}) {
  const toast = useToast();
  const [busy, start] = useTransition();
  const [y, m, d] = event.event_date.split("-");

  function answer(a: RsvpAnswer) {
    if (!canAct || busy) return;
    start(async () => {
      const r = await rsvpEvent(message.id, event.mine === a ? null : a);
      if (!r.ok) return toast.error(r.error);
      if (r.message) onReplace?.(r.message);
    });
  }

  return (
    <div className={cn(FACE, "w-[min(20rem,70vw)]")} role="group" aria-label={`Event: ${event.name}`}>
      <div className="flex items-start gap-2.5">
        <span aria-hidden className="w-11 shrink-0 overflow-hidden rounded-lg border border-border bg-surface text-center">
          <span className="block bg-[#ff2e74] text-[10px] font-extrabold text-white">{MONTHS[Number(m) - 1]}</span>
          <span className="block py-0.5 text-lg font-extrabold leading-tight">{Number(d)}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[15px] font-bold">{event.name}</span>
          {/* DD/MM/YYYY, as every date in the app (AGENTS.md "Dates"). */}
          <span className={cn("block text-xs", MUTED)}>
            {d}/{m}/{y}
            {event.event_time ? ` · ${event.event_time}` : ""}
          </span>
          {event.location && (
            <span className={cn("flex items-center gap-1 text-xs", MUTED)}>
              <MapPin className="h-3 w-3 shrink-0" aria-hidden /> <span className="break-words">{event.location}</span>
            </span>
          )}
        </span>
      </div>
      {event.description && <p className="mt-1.5 whitespace-pre-line break-words text-sm">{event.description}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Your answer">
        {ANSWERS.map((a) => {
          const n = event[a.value];
          const on = event.mine === a.value;
          return (
            // button-shape: exempt -- WhatsApp's RSVP pills on an event card (user 2026-10-31, the Pulse Attach Menu mockup)
            <button
              key={a.value}
              type="button"
              aria-pressed={on}
              disabled={!canAct || busy}
              onClick={() => answer(a.value)}
              className={cn(
                "h-7 rounded-full border px-2.5 text-xs font-bold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                on ? cn("border-transparent bg-[#d9fdd3] dark:bg-[#103529]", GREEN) : "border-border bg-surface text-heading hover:bg-surface-muted",
              )}
            >
              {a.label} {n}
            </button>
          );
        })}
      </div>
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
          className={cn("flex w-full items-center justify-center gap-1.5 py-2 text-sm font-bold hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", GREEN)}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MessageCircle className="h-4 w-4" aria-hidden />} Message
        </button>
      )}
    </div>
  );
}
