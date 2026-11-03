import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";
import type { DashboardTone } from "@/lib/dashboard/types";
import { GLASS } from "./glass";
import { toneGrad, toneSoft, toneText } from "./tone";

/**
 * THE KPI CARD (approved plan v2, 2026-11-02): label + share pill, ONE large figure, one
 * muted line, and a small chart along the bottom. The chart replaced the ring the board
 * drew before — a ring could only ever say "x% of a whole", while each card's chart says
 * the one thing its figure needs: how late the late orders are, how many steps are done.
 * Every chart is drawn from the board's own figures (`lib/dashboard/board.ts`); nothing is
 * drawn "vs target", because no targets are stored.
 */
export function KpiCard({
  label,
  value,
  valueTone,
  sub,
  pill,
  pillTone = "primary",
  href,
  children,
}: {
  label: string;
  value: string;
  valueTone?: DashboardTone;
  sub?: string;
  pill?: string;
  pillTone?: DashboardTone;
  href?: string;
  /** The small chart along the bottom. */
  children?: ReactNode;
}) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <Truncated text={label} className="min-w-0 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground" />
        {pill && (
          <span className={cn("shrink-0 rounded-full px-2 py-px text-[10.5px] font-bold tabular-nums", toneSoft[pillTone])}>{pill}</span>
        )}
      </span>
      <span className={cn("block text-[22px] font-extrabold leading-none tracking-tight tabular-nums", valueTone ? toneText[valueTone] : "text-heading")}>
        {/^\d{1,6}$/.test(value) ? (
          // COUNT-UP (one-screen dashboard): a whole number arrives from 0, once, pulling the
          // eye to the figures first. CSS only; screen readers get the plain number.
          <>
            <span className="sr-only">{value}</span>
            <span aria-hidden className="dash-count" style={{ ["--to" as string]: Number(value) }} />
          </>
        ) : (
          value
        )}
      </span>
      {sub && <Truncated text={sub} className="block text-[11.5px] text-muted-foreground" />}
      {children && <span className="mt-auto block pt-1">{children}</span>}
    </>
  );
  const cls = cn(GLASS, "flex min-w-0 flex-col gap-1 border px-3.5 py-2.5");
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
      {body}
    </Link>
  ) : (
    <Card className={cls}>{body}</Card>
  );
}

/** A KPI whose read failed — said, never drawn as 0. */
export function KpiCardError({ label }: { label: string }) {
  return (
    <Card className={cn(GLASS, "flex min-w-0 flex-col gap-1.5 px-4 py-3")}>
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">{label}</span>
      <span className="text-xs text-danger">Couldn&apos;t load</span>
    </Card>
  );
}

/** One bar split into parts, each sized by its value; an empty whole draws the track alone. */
export function SplitBar({ parts, title }: { parts: { value: number; tone: DashboardTone | "track" }[]; title?: string }) {
  const total = parts.reduce((n, p) => n + Math.max(0, p.value), 0);
  return (
    <span className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-[var(--glass-track)]" title={title} aria-hidden>
      {total > 0 &&
        parts
          .filter((p) => p.value > 0)
          .map((p, i) => (
            <span
              key={i}
              className="block h-full first:rounded-l-full last:rounded-r-full"
              style={{ flexGrow: p.value, background: toneGrad(p.tone, 90) }}
            />
          ))}
    </span>
  );
}

/** Small columns, one per value, each in its own tone — the ageing split, for one. */
export function MiniColumns({ bars }: { bars: { value: number; tone: DashboardTone; label: string }[] }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <span className="flex h-8 items-end gap-1" aria-hidden>
      {bars.map((b) => (
        <span
          key={b.label}
          title={`${b.label}: ${b.value}`}
          className="block flex-1 rounded-[3px]"
          style={{
            height: b.value > 0 ? `${Math.max(12, (b.value / max) * 100)}%` : "3px",
            background: b.value > 0 ? toneGrad(b.tone) : "var(--glass-track)",
          }}
        />
      ))}
    </span>
  );
}

/**
 * One block per item, done ones filled. Past `cap` items each block stands for several,
 * so a 300-step month still fits one row; the title says the real counts.
 */
export function BlockGrid({ done, total, tone, cap = 42 }: { done: number; total: number; tone: DashboardTone; cap?: number }) {
  const n = Math.max(1, Math.min(total, cap));
  const lit = total > 0 ? Math.round((done / total) * n) : 0;
  return (
    <span className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${Math.min(n, 21)}, minmax(0, 1fr))` }} title={`${done} of ${total}`} aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="block h-[6px] rounded-[2px]" style={{ background: i < lit ? toneGrad(tone) : "var(--glass-track)" }} />
      ))}
    </span>
  );
}
