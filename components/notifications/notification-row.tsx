"use client";

import type { CSSProperties } from "react";
import { fmtTime } from "@/lib/format";
import {
  actorFace,
  notificationClock,
  notificationModule,
  textRuns,
  type NotificationModuleLook,
} from "@/lib/notifications/look";
import type { Notification } from "@/lib/notifications/types";
import { cn } from "@/lib/utils";

/**
 * ONE ALERT, DRAWN ONE WAY — the bell and Pulse ▸ Notifications both render
 * this (user 2026-11-06, the approved "Raagam Notifications Redesign" mockup,
 * artifact SUCwJ7gGfDYS2Gk9u6o6EE).
 *
 *   [face]  Title, with document numbers in blue and amounts in bold ink
 *   [badge] Body in grey, the same runs coloured
 *           Sender · Module · time
 *
 * The face is the sender's HR photo, else their initials on their Pulse colour;
 * an alert nobody caused (a sweep, a job, a row from before 0814) shows the
 * module's own icon instead. The font is the app's own (`--font-app`, the
 * operator's "T" menu choice), so the bell reads like the screen behind it.
 */
export function NotificationRow({ n, unread, time }: { n: Notification; unread: boolean; time?: string }) {
  const mod = notificationModule(n.event_key);
  // The meta line names the sender unless the title already does ("New message from Priya S").
  const showName = !!n.actor_name && !n.title.toLowerCase().includes(n.actor_name.toLowerCase());
  return (
    <div className={cn("flex gap-3 px-4 py-3 text-left", unread && "bg-primary/5")}>
      <NotificationFace name={n.actor_name ?? null} photo={n.actor_photo ?? null} hasActor={!!n.actor_id} mod={mod} />
      <div className="min-w-0 flex-1">
        <p className={cn("break-words text-[14px] leading-snug text-heading", unread ? "font-semibold" : "font-medium")}>
          <Runs text={n.title} />
        </p>
        {n.body && (
          <p className="mt-0.5 line-clamp-3 whitespace-pre-line break-words text-[13px] leading-relaxed text-muted-foreground">
            <Runs text={n.body} />
          </p>
        )}
        <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs tabular-nums text-muted-foreground">
          {showName && <span className="font-semibold text-heading">{n.actor_name}</span>}
          {showName && mod && <span aria-hidden>·</span>}
          {mod && (
            <span className="font-semibold" style={{ color: mod.hue }}>
              {mod.label}
            </span>
          )}
          {(showName || mod) && <span aria-hidden>·</span>}
          <time dateTime={n.created_at}>{time ?? fmtTime(notificationClock(n.created_at))}</time>
        </p>
      </div>
      {unread ? (
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />
      ) : (
        <span className="w-2 shrink-0" aria-hidden />
      )}
    </div>
  );
}

/** Document numbers blue, amounts and percentages bold ink, the rest as the line. */
function Runs({ text }: { text: string }) {
  return (
    <>
      {textRuns(text).map((r, i) =>
        r.kind === "doc" ? (
          <span key={i} className="font-semibold text-primary">
            {r.text}
          </span>
        ) : r.kind === "amount" ? (
          <span key={i} className="font-semibold tabular-nums text-heading">
            {r.text}
          </span>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  );
}

function NotificationFace({
  name,
  photo,
  hasActor,
  mod,
}: {
  name: string | null;
  photo: string | null;
  hasActor: boolean;
  mod: NotificationModuleLook | null;
}) {
  const Glyph = mod?.icon;
  if (!hasActor) {
    return (
      <span
        aria-hidden
        className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-white"
        style={{ background: mod?.hue ?? "var(--color-primary)" }}
      >
        {Glyph && <Glyph className="h-[18px] w-[18px]" strokeWidth={2.2} />}
      </span>
    );
  }
  const face = actorFace(name);
  return (
    <span aria-hidden className="relative mt-0.5 h-9 w-9 shrink-0">
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- a staff photo from public storage, 36px
        <img src={photo} alt="" className="h-9 w-9 rounded-full object-cover" loading="lazy" />
      ) : (
        <span
          className="grid h-9 w-9 place-items-center rounded-full text-[13px] font-semibold tracking-tight text-white"
          style={{ background: face.ink } as CSSProperties}
        >
          {face.initials}
        </span>
      )}
      {mod && Glyph && (
        <span
          className="absolute -bottom-0.5 -right-0.5 grid h-[17px] w-[17px] place-items-center rounded-full text-white ring-2 ring-surface"
          style={{ background: mod.hue }}
        >
          <Glyph className="h-[10px] w-[10px]" strokeWidth={2.6} />
        </span>
      )}
    </span>
  );
}
