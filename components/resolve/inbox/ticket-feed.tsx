"use client";

import { useEffect, useRef } from "react";
import { wordsFor } from "@/components/resolve/ticket/ticket-timeline";
import { fmtDate, fmtTime } from "@/lib/format";
import type { TicketDetail } from "@/lib/resolve/types";
import { cn } from "@/lib/utils";

/*
 * THE CONVERSATION — the ticket told as a chat. People's words are bubbles
 * (mine on the right); everything the system did is one small centred line.
 * Internal notes are amber and say "Team note" — the raiser's view never has
 * them, because RLS never sends them (`isStaff` false).
 *
 * The "created" and "replied"/"note" activity rows are dropped: the report
 * itself is the first bubble, and a reply already IS a bubble.
 */

type Item =
  | { kind: "msg"; at: string; who: string; mine: boolean; body: string; note: boolean; photos: string[] }
  | { kind: "sys"; at: string; text: string; photos: string[] };

const HIDDEN = new Set(["created", "note", "replied"]);

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

export function TicketFeed({ detail, meId }: { detail: TicketDetail; meId: string }) {
  const t = detail.ticket;
  const endRef = useRef<HTMLDivElement>(null);
  const reportPhotos = detail.photos.filter((p) => p.kind === "report" && p.url).map((p) => p.url as string);
  const fixPhotos = detail.photos.filter((p) => p.kind === "fix" && p.url);

  const items: Item[] = [
    {
      kind: "msg",
      at: t.created_at,
      who: t.reporter_id === meId ? "You" : t.reporter_name || (t.is_anonymous ? "Anonymous" : "Raiser"),
      mine: t.reporter_id === meId,
      body: t.description || t.title,
      note: false,
      photos: reportPhotos,
    },
  ];
  for (const n of detail.notes) {
    items.push({
      kind: "msg",
      at: n.created_at,
      who: n.author_id === meId ? "You" : n.author_name || "Someone",
      mine: n.author_id === meId,
      body: n.body,
      note: n.visibility === "internal",
      photos: [],
    });
  }
  let fixRound = 0;
  for (const a of detail.activity) {
    if (HIDDEN.has(a.action)) continue;
    const who = a.actor_id === meId ? "you" : a.actor_name;
    const photos = a.action === "fixed" ? fixPhotos.filter((p) => p.fix_round === fixRound + 1).map((p) => p.url as string) : [];
    if (a.action === "fixed") fixRound += 1;
    items.push({
      kind: "sys",
      at: a.created_at,
      text: [wordsFor(a.action).verb + (who ? ` by ${who}` : ""), a.note].filter(Boolean).join(" · "),
      photos,
    });
  }
  items.sort((a, b) => a.at.localeCompare(b.at));

  // Land on the newest message whenever the ticket or its length changes.
  const count = items.length;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [t.id, count]);

  let lastDay = "";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-surface-muted px-3.5 py-3">
      {items.map((it, i) => {
        const day = fmtDate(it.at);
        const showDay = day !== lastDay;
        lastDay = day;
        return (
          <div key={i} className="contents">
            {showDay && (
              <p className="self-center text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">{day}</p>
            )}
            {it.kind === "sys" ? (
              <div className="flex max-w-full flex-col items-center gap-1.5 self-center">
                <p className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-center text-xs text-muted-foreground">
                  {it.text} · {fmtTime(it.at)}
                </p>
                {it.photos.map((u) => (
                  <Photo key={u} url={u} />
                ))}
              </div>
            ) : (
              <div className={cn("flex max-w-[34rem] items-start gap-2", it.mine && "flex-row-reverse self-end")}>
                <span
                  className={cn(
                    "flex size-6 flex-none items-center justify-center rounded-full text-[10px] font-bold text-white",
                    it.mine ? "bg-primary" : it.who === "Anonymous" ? "bg-violet-600" : "bg-slate-500",
                  )}
                  aria-hidden="true"
                >
                  {it.mine ? "ME" : initials(it.who)}
                </span>
                <div
                  className={cn(
                    "min-w-0 rounded-xl px-2.5 py-1.5 text-sm",
                    it.note
                      ? "bg-warning-soft"
                      : it.mine
                        ? "rounded-tr-sm bg-primary-soft"
                        : "rounded-tl-sm border border-border bg-surface",
                  )}
                >
                  <p className="text-xs font-semibold">
                    {it.note && <span className="text-warning">Team note · </span>}
                    {it.who}
                    <span className="ml-1.5 font-normal text-muted-foreground">{fmtTime(it.at)}</span>
                  </p>
                  <p className="whitespace-pre-wrap break-words">{it.body}</p>
                  {it.photos.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {it.photos.map((u) => (
                        <Photo key={u} url={u} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}

function Photo({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-border">
      {/* A signed URL to a private bucket — next/image would proxy it for nothing. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Photo on this ticket" className="h-24 w-32 object-cover" />
    </a>
  );
}
