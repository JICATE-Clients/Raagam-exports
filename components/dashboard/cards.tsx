import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, CircleDashed, Lock, Unplug } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import type {
  Cell,
  DashboardTone,
  HeroKpi,
  LeaderRow,
  MiniStatRow,
  StageRow,
} from "@/lib/dashboard/types";
import { Sparkline, ProgressBar } from "./charts";
import { Icon } from "./icon";
import { toneSoft, toStatusTone } from "./tone";

/* ------------------------------------------------------------------ *
 * Section rule
 * ------------------------------------------------------------------ */

/** The numbered `01 ── Performance ─────────` divider between sections. */
export function SectionHeading({
  index,
  title,
  meta,
}: {
  index: string;
  title: string;
  meta?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3.5">
      <span className="font-mono text-[11px] tracking-[0.06em] text-muted-foreground">
        {index}
      </span>
      <h2 className="text-[13px] font-semibold tracking-[0.02em]">{title}</h2>
      <span className="h-px flex-1 bg-border" />
      {meta && <span className="text-[11px] text-muted-foreground">{meta}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The honest empty state
 * ------------------------------------------------------------------ */

const FALLBACK = {
  not_tracked: {
    icon: CircleDashed,
    title: "Not tracked yet",
    tone: "text-muted-foreground",
  },
  denied: { icon: Lock, title: "No access", tone: "text-muted-foreground" },
  error: { icon: Unplug, title: "Couldn’t load", tone: "text-danger" },
} as const;

/**
 * What a tile shows when it has no number.
 *
 * Three different reasons deserve three different words. "Not tracked yet" is a
 * product gap the client can decide to close; "No access" is a permission the
 * viewer doesn't hold; "Couldn't load" is a fault. Collapsing them into a blank
 * card — or worse, a zero — leaves the operator unable to tell a missing
 * feature from a broken one, and a zero actively misinforms.
 *
 * The tile keeps its slot in the grid either way, so the layout still reads as
 * designed and the gap stays visible rather than quietly disappearing.
 */
export function NotTracked({
  reason,
  note,
  label,
  compact = false,
}: {
  reason: "not_tracked" | "denied" | "error";
  note?: string;
  label?: string;
  compact?: boolean;
}) {
  const f = FALLBACK[reason];
  const FIcon = f.icon;
  return (
    <div
      className={cn(
        "flex h-full flex-col justify-center gap-1 text-muted-foreground",
        compact ? "py-1" : "py-4",
      )}
    >
      {label && (
        <p className="truncate text-[11px] font-medium text-muted-foreground">
          {label}
        </p>
      )}
      <p className={cn("flex items-center gap-1.5 text-xs font-medium", f.tone)}>
        <FIcon className="h-3.5 w-3.5 shrink-0" />
        {f.title}
      </p>
      {note && !compact && (
        <p className="text-[11px] leading-snug text-muted-foreground">{note}</p>
      )}
    </div>
  );
}

/** Renders `children` when the cell has data, the fallback when it doesn't. */
export function CellView<T>({
  cell,
  label,
  compact,
  children,
}: {
  cell: Cell<T>;
  label?: string;
  compact?: boolean;
  children: (value: T) => React.ReactNode;
}) {
  if (cell.ok) return <>{children(cell.value)}</>;
  return (
    <NotTracked
      reason={cell.reason}
      note={cell.note}
      label={label}
      compact={compact}
    />
  );
}

/* ------------------------------------------------------------------ *
 * KPI tiles
 * ------------------------------------------------------------------ */

function DeltaChip({ delta, up }: { delta: string; up: boolean }) {
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 self-start rounded-full px-2 py-0.5 text-[11px] font-semibold",
        up ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
      )}
    >
      <Arrow className="h-3 w-3" />
      {delta}
    </span>
  );
}

export function KpiCard({ kpi }: { kpi: HeroKpi }) {
  return (
    <Card interactive className="relative min-w-0 animate-rise overflow-hidden p-4">
      <div className="flex items-center justify-between gap-2.5">
        <p className="min-w-0 truncate text-[11px] font-medium text-muted-foreground">
          {kpi.label}
        </p>
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]",
            toneSoft[kpi.up ? "primary" : "warning"],
          )}
        >
          <Icon name={kpi.icon} className="h-4 w-4" />
        </span>
      </div>

      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
        {kpi.value}
      </p>

      <div className="mt-2.5 flex items-end justify-between gap-2.5">
        <div className="flex min-w-0 flex-col gap-1">
          {kpi.delta ? (
            <DeltaChip delta={kpi.delta} up={kpi.up} />
          ) : (
            // No delta is a real state — the previous period was zero, so a
            // percentage would be meaningless rather than merely unknown.
            <span className="text-[11px] text-muted-foreground">—</span>
          )}
          <span className="truncate text-[10px] text-muted-foreground">
            {kpi.hint}
          </span>
        </div>
        <Sparkline values={kpi.spark} tone={kpi.up ? "pos" : "danger"} />
      </div>
    </Card>
  );
}

export function MiniStat({ stat }: { stat: MiniStatRow }) {
  const body = (
    <>
      <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <Icon name={stat.icon} className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate text-[10px] font-medium">{stat.label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-lg font-semibold tabular-nums">{stat.value}</span>
        {stat.delta && (
          <span
            className={cn(
              "text-[11px] font-semibold",
              stat.up ? "text-success" : "text-danger",
            )}
          >
            {stat.delta}
          </span>
        )}
      </div>
    </>
  );

  if (!stat.href) {
    return (
      <Card className="min-w-0 px-3.5 py-3">{body}</Card>
    );
  }
  return (
    <Card interactive className="min-w-0">
      <Link href={stat.href} className="block px-3.5 py-3">
        {body}
      </Link>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Manufacturing stage card
 * ------------------------------------------------------------------ */

export function StageCard({ stage }: { stage: StageRow }) {
  return (
    <Card className="flex min-w-0 flex-col p-4">
      <div className="flex items-center justify-between gap-2.5">
        <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon name={stage.icon} className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{stage.name}</span>
        </span>
        {stage.data.ok && (
          <StatusPill tone={toStatusTone(stage.data.value.tone)}>
            {stage.data.value.state}
          </StatusPill>
        )}
      </div>

      <div className="mt-2 flex-1">
        <CellView cell={stage.data} compact>
          {(d) => (
            <>
              <p className="text-[22px] font-semibold tracking-tight tabular-nums">
                {d.headline}
              </p>
              <p className="mb-2.5 mt-0.5 text-[11px] text-muted-foreground">
                {d.sub}
              </p>
              <ProgressBar pct={d.pct} tone={d.tone} />
            </>
          )}
        </CellView>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Leaderboards & quick actions
 * ------------------------------------------------------------------ */

export function LeaderboardCard({
  title,
  note,
  rows,
}: {
  title: string;
  note: string;
  rows: Cell<LeaderRow[]>;
}) {
  return (
    <Card className="flex min-w-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="shrink-0 text-[11px] text-muted-foreground">{note}</span>
      </div>
      <div className="flex-1 px-4 py-2">
        <CellView cell={rows}>
          {(list) =>
            list.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing in this period.
              </p>
            ) : (
              <ol>
                {list.map((r, i) => (
                  <li
                    key={r.name}
                    className="flex items-center gap-3 border-b border-border py-2.5 last:border-0"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-muted text-[11px] font-semibold text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{r.name}</p>
                      <div className="mt-1.5">
                        <ProgressBar
                          pct={r.pct}
                          tone={i === 0 ? "primary" : "accent"}
                          size="sm"
                        />
                      </div>
                    </div>
                    <span className="shrink-0 text-xs font-semibold tabular-nums">
                      {r.value}
                    </span>
                  </li>
                ))}
              </ol>
            )
          }
        </CellView>
      </div>
    </Card>
  );
}

export interface QuickAction {
  label: string;
  hint: string;
  href: string;
  icon: string;
  tone: DashboardTone;
}

export function QuickActionGrid({ actions }: { actions: QuickAction[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {actions.map((a) => (
        <Card key={a.href + a.label} interactive className="min-w-0">
          <Link
            href={a.href}
            className="flex items-center gap-3 px-4 py-3.5 hover:border-primary"
          >
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]",
                toneSoft[a.tone],
              )}
            >
              <Icon name={a.icon} className="h-[17px] w-[17px]" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">
                {a.label}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                {a.hint}
              </span>
            </span>
          </Link>
        </Card>
      ))}
    </div>
  );
}
