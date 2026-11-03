"use client";

import Link from "next/link";
import { KINDS } from "@/components/my-calendar/my-calendar";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CalEvent, CalKind } from "@/lib/my-calendar/data";
import { toneGrad } from "./tone";
import { CardFooter } from "./card-footer";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ORDER = Object.keys(KINDS) as CalKind[];

type Load = { done: number; due: number; overdue: number };

/**
 * "WHICH DAYS ARE HEAVY, AND WHAT HAS SLIPPED?" (one-screen dashboard, plan card C, user
 * 2026-11-03). Each day is a column of its work by STATE, not by kind: overdue at the base
 * in red (never hidden under the rest), then due in blue, then done in green, all on one
 * scale so the busiest day is the tallest. Today glows. Below, the week in three numbers —
 * and anything still overdue from BEFORE this week, which the strip of days cannot show and
 * the old version silently dropped.
 *
 * The kind (T&A, buyer approval, work flow) moved into each day's tooltip; the per-kind chips
 * that filtered the strip wrapped to two lines and were clipped in a fixed-height row
 * (screenshot 141715). A day still opens My Calendar on that day, where the kinds live.
 *
 * "use client" only because KINDS comes from a client module — a server file importing a
 * constant from one receives a reference, not the value. It holds no state.
 */
export function WeekGlance({
  days,
  dayHrefs,
  cursor,
  today,
  events,
}: {
  days: string[];
  dayHrefs: string[];
  cursor: string;
  today: string;
  events: CalEvent[];
}) {
  const state = (e: CalEvent): keyof Load => (e.done ? "done" : e.date < today ? "overdue" : "due");
  const byDate = new Map<string, Load>();
  const total: Load = { done: 0, due: 0, overdue: 0 };
  let earlier = 0;
  const inWeek = new Set(days);
  for (const e of events) {
    const st = state(e);
    if (!inWeek.has(e.date)) {
      if (st === "overdue") earlier += 1;
      continue;
    }
    const l = byDate.get(e.date) ?? { done: 0, due: 0, overdue: 0 };
    l[st] += 1;
    byDate.set(e.date, l);
    total[st] += 1;
  }
  const max = Math.max(1, ...days.map((d) => sum(byDate.get(d))));

  return (
    <>
      <div className="grid min-h-0 flex-1 grid-cols-7 gap-1">
        {days.map((d, i) => {
          const l = byDate.get(d) ?? { done: 0, due: 0, overdue: 0 };
          const n = sum(l);
          const isToday = d === today;
          const picked = d === cursor;
          const evs = events.filter((e) => e.date === d);
          const kinds = ORDER.filter((k) => evs.some((e) => e.kind === k))
            .map((k) => `${evs.filter((e) => e.kind === k).length} ${KINDS[k].label}`)
            .join(", ");
          const tip = n
            ? `${fmtDate(d)} · ${[l.overdue && `${l.overdue} overdue`, l.due && `${l.due} due`, l.done && `${l.done} done`].filter(Boolean).join(" · ")}${kinds ? ` (${kinds})` : ""}`
            : `${fmtDate(d)} · nothing due`;
          return (
            <Link
              key={d}
              href={dayHrefs[i]}
              title={tip}
              aria-label={tip}
              aria-current={picked ? "date" : undefined}
              className={cn(
                "flex min-h-0 flex-col items-center gap-0.5 rounded-lg border border-transparent px-0.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-surface-muted",
                picked && "border-primary/40",
                isToday && "bg-primary-soft text-primary shadow-[0_0_14px_-4px_var(--primary)]",
              )}
            >
              {WEEKDAYS[i]}
              <b className={cn("text-[13px] normal-case leading-none tracking-normal tabular-nums", isToday ? "text-primary" : "text-foreground")}>
                {Number(d.slice(8, 10))}
              </b>
              {/* The column: overdue at the base, then due, then done — one scale for the week. */}
              <span className="flex min-h-0 w-3.5 flex-1 flex-col-reverse gap-px pt-1" aria-hidden>
                {(["overdue", "due", "done"] as const).map((k, j) =>
                  l[k] > 0 ? (
                    <span
                      key={k}
                      className="dash-rise block rounded-[3px]"
                      style={{
                        height: `${(l[k] / max) * 100}%`,
                        minHeight: 3,
                        background: toneGrad(k === "overdue" ? "danger" : k === "due" ? "primary" : "success"),
                        animationDelay: `${i * 60 + j * 40}ms`,
                      }}
                    />
                  ) : null,
                )}
              </span>
              <span className="h-3 text-[10px] font-medium normal-case leading-3 tracking-normal tabular-nums">{n || ""}</span>
            </Link>
          );
        })}
      </div>

      {/* The week in three numbers, as the card's footer (fix 6), with the way to My Calendar. */}
      <CardFooter
        facts={[
          { label: "Overdue", value: String(total.overdue + earlier), tone: "danger" },
          { label: "Due", value: String(total.due), tone: "primary" },
          { label: "Done", value: String(total.done), tone: "success" },
        ]}
        href="/my-calendar"
        cta="My calendar"
      />
    </>
  );
}

function sum(l: Load | undefined): number {
  return l ? l.done + l.due + l.overdue : 0;
}
