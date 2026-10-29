import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, CircleDashed, Lock, Unplug } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Truncated } from "@/components/ui/truncated";
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
import { toneBg, toneSoft, toStatusTone } from "./tone";
import { GLASS, GLASS_TILE } from "./glass";

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
  const tone = kpi.up ? "primary" : "warning";
  return (
    <Card interactive className={cn(GLASS, "relative min-w-0 animate-rise overflow-hidden p-4")}>
      {/* A 3px rule along the top in the card's own tone (colour pass
          2026-10-16). It carries the SAME meaning as the icon well — blue when
          the figure is moving the right way, amber when it is not — so it adds
          colour without adding a second thing to decode. A rule, not a tinted
          card: the client has refused tinted grounds five times. */}
      <span aria-hidden className={cn("absolute inset-x-0 top-0 h-[3px]", toneBg[tone])} />
      {/* Layout A (2026-10-28): the icon well leads, the trend sits opposite it,
          and the figure reads beneath — the reference dashboard's card. */}
      <div className="flex items-start justify-between gap-2.5">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            toneSoft[tone],
          )}
        >
          <Icon name={kpi.icon} className="h-5 w-5" />
        </span>
        <Sparkline values={kpi.spark} tone={kpi.up ? "pos" : "danger"} />
      </div>

      <p className="mt-3 min-w-0 truncate text-xs font-medium text-muted-foreground">
        {kpi.label}
      </p>
      <p className="mt-0.5 text-2xl font-bold tracking-tight tabular-nums text-heading">
        {kpi.value}
      </p>

      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {kpi.delta ? (
          <DeltaChip delta={kpi.delta} up={kpi.up} />
        ) : (
          // No delta is a real state — the previous period was zero, so a
          // percentage would be meaningless rather than merely unknown.
          <span className="text-[11px] text-muted-foreground">—</span>
        )}
        <span className="truncate text-[11px] text-muted-foreground">{kpi.hint}</span>
      </div>
    </Card>
  );
}

export function MiniStat({ stat }: { stat: MiniStatRow }) {
  const body = (
    <>
      <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        {/* The icon carries the brand, the label stays quiet (colour pass
            2026-10-16) — six grey icons in a row was most of the "grey". */}
        <Icon name={stat.icon} className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="truncate text-[10px] font-medium">{stat.label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-lg font-semibold tabular-nums text-heading">{stat.value}</span>
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
      <Card className={cn(GLASS_TILE, "min-w-0 px-3.5 py-3")}>{body}</Card>
    );
  }
  return (
    <Card interactive className={cn(GLASS_TILE, "min-w-0")}>
      <Link href={stat.href} className="block px-3.5 py-3">
        {body}
      </Link>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Manufacturing stage card
 * ------------------------------------------------------------------ */

/**
 * A production stage as a small tile, two to a row in the right column
 * (user 2026-10-29: Manufacturing moved under Quick actions, compact). The
 * stage, its figure and its state word; the explanatory line is the tooltip.
 */
export function StageTile({ stage }: { stage: StageRow }) {
  const d = stage.data.ok ? stage.data.value : null;
  return (
    <div
      title={d ? `${stage.name}: ${d.headline} · ${d.sub}` : stage.name}
      className="min-w-0 rounded-lg border border-[var(--glass-edge)] bg-[var(--glass-row)] px-2.5 py-2"
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
          <Icon name={stage.icon} className="size-3.5 shrink-0" />
          <Truncated text={stage.name} className="min-w-0" />
        </span>
        {d && (
          <StatusPill tone={toStatusTone(d.tone)} className="shrink-0">
            {d.state}
          </StatusPill>
        )}
      </div>
      {d ? (
        <p className="mt-1 text-[15px] font-semibold tabular-nums leading-tight">{d.headline}</p>
      ) : (
        <CellView cell={stage.data} compact>
          {() => null}
        </CellView>
      )}
    </div>
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
    <Card className={cn(GLASS, "flex min-w-0 flex-col")}>
      <div className="flex items-center justify-between gap-2 border-b border-[var(--glass-edge)] px-4 py-3">
        <h3 className="text-sm font-semibold text-heading">{title}</h3>
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
                    {/* The leader's rank is marked in the bar's own blue; the
                        rest match their teal bars — the chip and the bar say
                        the same thing. */}
                    <span
                      className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold",
                        i === 0 ? toneSoft.primary : toneSoft.accent,
                      )}
                    >
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

/**
 * The shortcuts, as a two-column list of small buttons in the right column
 * (user 2026-10-29). They were eight large tiles with a line of description
 * each across the full width; the description is now the button's tooltip.
 */
export function QuickActionList({ actions }: { actions: QuickAction[] }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 p-3">
      {actions.map((a) => (
        <Link
          key={a.href + a.label}
          href={a.href}
          title={a.hint}
          className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--glass-edge)] bg-[var(--glass-row)] px-2.5 py-2 text-[12.5px] font-medium transition-colors hover:border-primary hover:bg-primary-soft"
        >
          <span className={cn("grid size-6 shrink-0 place-items-center rounded-md", toneSoft[a.tone])}>
            <Icon name={a.icon} className="size-[13px]" />
          </span>
          <Truncated text={a.label} className="min-w-0" />
        </Link>
      ))}
    </div>
  );
}
