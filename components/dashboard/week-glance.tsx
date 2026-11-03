"use client";

import Link from "next/link";
import { useState } from "react";
import { KINDS } from "@/components/my-calendar/my-calendar";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CalEvent, CalKind } from "@/lib/my-calendar/data";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ORDER = Object.keys(KINDS) as CalKind[];
/** A bar's full height in px, and the px one item adds to its kind's segment. */
const BAR_H = 30;
const UNIT = 4;

/**
 * THE WEEK, SEEN AS LOAD (user 2026-11-02, plan https://claude.ai/artifact/31p9opsvkqVgRLg3c5zrwy:
 * "compact calendar … visual rather than text").
 *
 * Each day is a small STACKED BAR — height is how much is due, colours are My Calendar's own
 * kinds (`KINDS`), and a red cap marks a past day with work still open — so a busy Wednesday
 * shows before anything is read. The legend under the strip counts the week per kind and IS
 * the filter: a kind switched off leaves the bars and the counts. The day list that sat under
 * the week was removed (user 2026-11-02, screenshot 144345: "remove it"), so a day now OPENS
 * that day in My Calendar. Only the filter is browser state.
 */
export function WeekGlance({
  days,
  dayHrefs,
  cursor,
  today,
  events,
}: {
  /** The seven ISO dates, Monday first. */
  days: string[];
  /** Each day's link — that day in My Calendar (the list under the week was removed). */
  dayHrefs: string[];
  cursor: string;
  today: string;
  events: CalEvent[];
}) {
  const [hidden, setHidden] = useState<ReadonlySet<CalKind>>(new Set());
  const shown = events.filter((e) => !hidden.has(e.kind));
  const inWeek = new Set(days);
  const byDate = new Map<string, CalEvent[]>();
  for (const e of shown) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  // The legend counts the WEEK (every kind, so a switched-off one still says its number).
  const weekCount = new Map<CalKind, number>();
  for (const e of events) if (inWeek.has(e.date)) weekCount.set(e.kind, (weekCount.get(e.kind) ?? 0) + 1);
  const legendKinds = ORDER.filter((k) => (weekCount.get(k) ?? 0) > 0);

  function toggle(k: CalKind) {
    setHidden((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  return (
    <>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d, i) => {
          const evs = byDate.get(d) ?? [];
          const isToday = d === today;
          const picked = d === cursor;
          const open = d < today && evs.some((e) => !e.done);
          const tip = evs.length
            ? `${fmtDate(d)} · ${ORDER.filter((k) => evs.some((e) => e.kind === k))
                .map((k) => `${evs.filter((e) => e.kind === k).length} ${KINDS[k].label}`)
                .join(", ")}${open ? " · some still open" : ""}`
            : `${fmtDate(d)} · nothing due`;
          // Segments bottom-up in kind order, each sized by its count, the whole capped.
          let used = open ? 4 : 0;
          const segs = ORDER.map((k) => ({ k, n: evs.filter((e) => e.kind === k).length }))
            .filter((s) => s.n > 0)
            .map((s) => {
              const h = Math.max(0, Math.min(s.n * UNIT + 2, BAR_H - used));
              used += h + 1;
              return { ...s, h };
            })
            .filter((s) => s.h > 0);
          return (
            <Link
              key={d}
              href={dayHrefs[i]}
              title={tip}
              aria-label={tip}
              aria-current={picked ? "date" : undefined}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-lg border border-transparent pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-surface-muted",
                picked && "border-primary bg-primary-soft hover:bg-primary-soft",
              )}
            >
              {WEEKDAYS[i]}
              <b className={cn("text-sm normal-case tracking-normal tabular-nums", isToday ? "text-primary" : "text-foreground")}>
                {Number(d.slice(8, 10))}
              </b>
              <span className="mt-0.5 flex w-3 flex-col-reverse gap-px" style={{ height: BAR_H }} aria-hidden>
                {segs.map((s) => (
                  <span key={s.k} className={cn("block rounded-[2px]", KINDS[s.k].dot)} style={{ height: s.h }} />
                ))}
                {open && <span className="block h-1 rounded-[2px] bg-danger" />}
              </span>
              <span className="h-3.5 text-[10.5px] font-medium normal-case tracking-normal tabular-nums">{evs.length || ""}</span>
            </Link>
          );
        })}
      </div>

      {legendKinds.length > 0 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Show kinds">
          {legendKinds.map((k) => {
            const on = !hidden.has(k);
            return (
              // button-shape: exempt -- a legend chip that filters the week, not an action button
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(k)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11.5px] transition-opacity hover:bg-surface-muted",
                  !on && "opacity-45",
                )}
              >
                <span className={cn("size-2 rounded-[2px]", KINDS[k].dot)} aria-hidden />
                {KINDS[k].label}
                <b className="tabular-nums">{weekCount.get(k)}</b>
              </button>
            );
          })}
        </div>
      )}

    </>
  );
}
