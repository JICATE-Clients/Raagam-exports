import { Card } from "@/components/ui/card";
import type { StatusTone } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";

/**
 * A REPORT'S FIGURES IN ONE SHORT STRIP (user 2026-11-03, screenshot 4031: Stock Statement
 * drew eight `Stat` cards in two rows — ~100px each to say one number — and the reports
 * "look unaligned"). One card, one row: each group a small caps title over its cells, the
 * cells split by hairlines, the value at `text-lg`. It wraps group by group on a narrow pane,
 * never cell by cell, so a group's figures always read together.
 *
 * Same tone words as `Stat` / `StatusPill`, so a figure's colour means what it means elsewhere.
 */
export type StripCell = { label: string; value: string | number; hint?: string; tone?: StatusTone };
export type StripGroup = { title?: string; cells: StripCell[] };

const TONE_TEXT: Record<StatusTone, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  neutral: "text-foreground",
};

export function StatStrip({ groups }: { groups: StripGroup[] }) {
  return (
    <Card className="flex flex-wrap divide-border px-1 py-2 lg:flex-nowrap lg:divide-x">
      {groups.map((g, gi) => (
        <section key={g.title ?? gi} aria-label={g.title} className="min-w-0 flex-1 px-3">
          {g.title ? (
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</h3>
          ) : null}
          <dl className="grid auto-cols-fr grid-flow-col divide-x divide-border">
            {g.cells.map((c) => (
              <div key={c.label} className="min-w-0 px-3 first:pl-0">
                <dt className="min-w-0">
                  <Truncated text={c.label} className="block text-xs text-muted-foreground" />
                </dt>
                <dd className={cn("m-0 text-lg font-semibold leading-7 tabular-nums", TONE_TEXT[c.tone ?? "neutral"])}>{c.value}</dd>
                {c.hint ? (
                  <dd className="m-0 min-w-0">
                    <Truncated text={c.hint} className="block text-[11px] text-muted-foreground" />
                  </dd>
                ) : null}
              </div>
            ))}
          </dl>
        </section>
      ))}
    </Card>
  );
}
