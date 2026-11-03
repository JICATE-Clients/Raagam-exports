"use client";

import Link from "next/link";
import { CheckCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AlertItem } from "@/lib/dashboard/types";
import { Icon } from "./icon";
import { toneSoft } from "./tone";
import { GLASS } from "./glass";
import { CardTitle } from "./card-title";

/**
 * NEEDS YOU — COUNTS AS TILES, NOT SENTENCES (user 2026-11-02, plan
 * https://claude.ai/artifact/31p9opsvkqVgRLg3c5zrwy: "visual rather than text").
 *
 * Each alert was a sentence ("41 pre-production milestone(s) overdue") over a line of RE
 * numbers cut off by "…", so the figure to act on was buried in text. Now each alert is a
 * tile: the number large, a two-word label, the same icon and tone; the RE / PO numbers
 * that used to be clipped show in full on hover. Click opens the list it counts.
 *
 * No approvals here (user 2026-11-02, screenshot 144354: "remove it") — the strip that
 * held them was taken out and the section no longer loads them; the queue is My Approvals.
 */
export function NeedsYouCard({
  alerts,
}: {
  alerts: AlertItem[];
}) {
  // The badge counts what the card SHOWS — the alert tiles (approvals left the card).
  const waiting = alerts.length;

  return (
    <Card className={cn(GLASS, "flex min-w-0 flex-col gap-2.5 overflow-hidden px-4 pb-4 pt-3")}>
      <div className="flex items-center justify-between gap-2">
        <CardTitle title="Needs you" subtitle="Click a count to open its list" icon="bell" tone="danger" />
        {waiting > 0 && (
          <span className="rounded-full bg-danger-soft px-2 text-[11px] font-bold tabular-nums text-danger">{waiting}</span>
        )}
      </div>

      {alerts.length === 0 ? (
        <AllClear title="Nothing needs attention" />
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {alerts.map((a) => (
            <AlertTile key={a.key} a={a} />
          ))}
        </ul>
      )}

    </Card>
  );
}

/** One alert: the number, a short label, the tone's icon; the detail on hover. */
function AlertTile({ a }: { a: AlertItem }) {
  // An alert built before `count` existed still renders: its title is the label then.
  const num = a.count != null ? `${a.count}${a.countPlus ? "+" : ""}` : null;
  const inner = (
    <>
      <span className={cn("row-span-2 grid size-8 place-items-center rounded-lg", toneSoft[a.tone])} aria-hidden>
        <Icon name={a.icon} className="size-4" />
      </span>
      {num ? <span className="text-[22px] font-extrabold leading-none tabular-nums">{num}</span> : null}
      <span className="text-[11.5px] leading-tight text-muted-foreground">{a.label ?? a.title}</span>
    </>
  );
  const cls =
    "grid h-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5 rounded-xl border border-[var(--glass-edge)] px-2.5 py-2 text-left";
  return (
    <li className="min-w-0">
      {/* THE DETAIL IS ON HOVER — the RE / PO numbers the old row clipped with "…". */}
      <Tooltip label={a.body} touch className="flex h-full w-full">
        {a.href ? (
          <Link
            href={a.href}
            aria-label={`${a.title}. ${a.body}`}
            className={cn(cls, "w-full transition-colors hover:border-primary hover:bg-surface-muted")}
          >
            {inner}
          </Link>
        ) : (
          <div aria-label={`${a.title}. ${a.body}`} className={cn(cls, "w-full")}>
            {inner}
          </div>
        )}
      </Tooltip>
    </li>
  );
}

function AllClear({ title }: { title: string }) {
  return (
    <p className="flex items-center gap-2.5 py-1 text-[13px] text-muted-foreground">
      <span className="grid size-7 place-items-center rounded-lg bg-success-soft text-success">
        <CheckCheck className="size-4" />
      </span>
      {title}
    </p>
  );
}
