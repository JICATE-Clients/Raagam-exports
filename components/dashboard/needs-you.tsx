"use client";

import Link from "next/link";
import { CheckCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { AlertItem } from "@/lib/dashboard/types";
import { toneVar } from "./tone";
import { GLASS } from "./glass";
import { CardFooter } from "./card-footer";
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
  const total = alerts.reduce((n, a) => n + (a.count ?? 0), 0);

  return (
    <Card className={cn(GLASS, "flex min-w-0 flex-col gap-2.5 overflow-hidden px-4 pb-4 pt-3")}>
      <div className="flex items-center justify-between gap-2">
        <CardTitle title="What waits on me?" subtitle="Click a ring to open its list" icon="bell" tone="danger" />
        {waiting > 0 && (
          <span className="rounded-full bg-danger-soft px-2 text-[11px] font-bold tabular-nums text-danger">{waiting}</span>
        )}
      </div>

      {alerts.length === 0 ? (
        <AllClear title="Nothing needs attention" />
      ) : (
        // RINGS, NOT TILES (one-screen dashboard, plan card B, user 2026-11-03): each alert is
        // a ring whose arc is its SHARE of everything waiting on you, so the biggest pile is
        // the fullest ring. Up to four sit in one row; more wrap, smaller.
        <ul
          className="grid min-h-0 flex-1 content-center gap-x-2 gap-y-1.5"
          style={{ gridTemplateColumns: `repeat(${Math.min(alerts.length, 4)}, minmax(0, 1fr))` }}
        >
          {alerts.map((a, i) => (
            <AlertRing key={a.key} a={a} share={(a.count ?? 0) / Math.max(1, total)} small={alerts.length > 4} order={i} />
          ))}
        </ul>
      )}

      {alerts.length > 0 && (
        <CardFooter
          facts={[
            { label: "Items", value: String(total) },
            { label: "Urgent", value: String(alerts.filter((a) => a.tone === "danger").reduce((n, a) => n + (a.count ?? 0), 0)), tone: "danger" },
          ]}
        />
      )}
    </Card>
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

/** Late-type tones keep breathing until the work is dealt with — a live state, not decoration. */
const URGENT = new Set(["danger"]);

function AlertRing({ a, share, small, order }: { a: AlertItem; share: number; small: boolean; order: number }) {
  const num = a.count != null ? `${a.count}${a.countPlus ? "+" : ""}` : "•";
  const pct = Math.max(4, Math.round(share * 100));
  const id = `ny-${a.key}`;
  const color = toneVar(a.tone);
  const ring = (
    <>
      <svg viewBox="0 0 36 36" className={cn("shrink-0 transition-transform duration-200 group-hover/ring:-translate-y-0.5 group-hover/ring:scale-110", small ? "size-11" : "size-14")} aria-hidden>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: `color-mix(in srgb, ${color} 60%, white)` }} />
            <stop offset="1" style={{ stopColor: `color-mix(in srgb, ${color} 80%, black)` }} />
          </linearGradient>
        </defs>
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--glass-track)" strokeWidth="3.6" />
        <circle
          cx="18"
          cy="18"
          r="15.9"
          fill="none"
          stroke={`url(#${id})`}
          strokeWidth="3.6"
          strokeLinecap="round"
          strokeDasharray={`${pct} 100`}
          transform="rotate(-90 18 18)"
          className={URGENT.has(a.tone) ? "dash-breathe" : "dash-sweep"}
          style={{ animationDelay: `${order * 120}ms` }}
        />
        <text x="18" y="21.6" textAnchor="middle" fontSize={num.length > 3 ? 8.5 : 10.5} fontWeight="800" fill="var(--heading)">
          {num}
        </text>
      </svg>
      <span className="line-clamp-2 text-center text-[11px] leading-tight text-muted-foreground">{a.label ?? a.title}</span>
    </>
  );
  const cls = "group/ring flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5";
  return (
    <li className="min-w-0">
      {/* THE DETAIL IS ON HOVER — the RE / PO numbers. */}
      <Tooltip label={a.body} touch className="flex h-full w-full">
        {a.href ? (
          <Link href={a.href} aria-label={`${a.title}. ${a.body}`} className={cn(cls, "transition-colors hover:bg-surface-muted")}>
            {ring}
          </Link>
        ) : (
          <div aria-label={`${a.title}. ${a.body}`} className={cls}>
            {ring}
          </div>
        )}
      </Tooltip>
    </li>
  );
}
