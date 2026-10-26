import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { BarChartMini, ChartEmpty, ChartLegend } from "@/components/dashboard/charts";
import { toneBg, toneText } from "@/components/dashboard/tone";
import { Card } from "@/components/ui/card";
import { SEG_IDLE, SEG_ITEM, SEG_LIT, SEG_TRACK } from "@/components/ui/segmented";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";
import type { DashboardTone } from "@/lib/dashboard/types";
import type { ResolveAnalytics, TicketSource } from "@/lib/resolve/types";

/*
 * Resolve Hub ▸ Analytics — the current unit only (plan §7), redrawn
 * phone-first (resolve-mobile mockup, 2026-10-26): period chips, four tiles
 * with the rates as small text beneath, ONE chart, then bar lists where the
 * four small tables used to be.
 *
 * Server-rendered with the dashboard's own chart kit and plain CSS bars — no
 * library: a bar is a div whose width is a custom property (the
 * `--pct` convention in components/dashboard/charts.tsx).
 *
 * The small pieces below (KpiTile, InsightCard, HBar, StackBar, BarLegend,
 * PeriodLinks) are exported because Desk Dashboard, Workload and Performance
 * draw the same shapes; they hold no hooks, so a client screen can use them.
 */

type Vars = CSSProperties & Record<string, string | number>;

// ---- shared pieces ------------------------------------------------------------

export function KpiTile({
  label,
  value,
  note,
  tone,
  noteTone,
}: {
  label: string;
  value: ReactNode;
  /** The small line under the number — where a rate goes. */
  note?: ReactNode;
  tone?: DashboardTone;
  noteTone?: DashboardTone;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-xl font-semibold leading-tight tabular-nums", tone && toneText[tone])}>{value}</span>
      {note != null && (
        <span className={cn("text-[11px] leading-snug tabular-nums", noteTone ? toneText[noteTone] : "text-muted-foreground")}>
          {note}
        </span>
      )}
    </Card>
  );
}

export function InsightCard({
  title,
  aside,
  children,
  className,
}: {
  title: ReactNode;
  /** Right of the title: a legend, a "30 days" note, a link. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex min-w-0 flex-col gap-2.5 p-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </Card>
  );
}

export function BarLegend({ items }: { items: { label: string; tone: DashboardTone }[] }) {
  return <ChartLegend items={items} />;
}

const pctOf = (v: number, max: number) => (max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0);

/** One labelled horizontal bar: label · track · figure. */
export function HBar({
  label,
  value,
  max,
  tone = "primary",
  text,
  title,
}: {
  label: string;
  value: number;
  max: number;
  tone?: DashboardTone;
  /** What is printed at the end (defaults to the value). */
  text?: ReactNode;
  title?: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-2 text-xs" title={title}>
      <Truncated text={label} className="min-w-0 text-foreground" />
      <span className="flex h-2 overflow-hidden rounded-full bg-surface-muted">
        <i
          className={cn("block h-full rounded-full", toneBg[tone])}
          style={{ "--pct": pctOf(value, max), width: "calc(var(--pct) * 1%)" } as Vars}
        />
      </span>
      <b className="min-w-8 text-right font-semibold tabular-nums">{text ?? value}</b>
    </div>
  );
}

/** A stacked horizontal bar: several parts, one track, the sum at the end. */
export function StackBar({
  label,
  parts,
  max,
  end,
}: {
  label: ReactNode;
  parts: { value: number; tone: DashboardTone; label: string }[];
  max: number;
  /** Printed after the total (a "1 late" pill). */
  end?: ReactNode;
}) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  const title = parts.map((p) => `${p.value} ${p.label}`).join(" · ");
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-2 text-xs" title={title}>
      {typeof label === "string" ? <Truncated text={label} className="min-w-0 text-foreground" /> : label}
      <span className="flex h-2 overflow-hidden rounded-full bg-surface-muted" aria-label={title} role="img">
        {parts.map((p) =>
          p.value > 0 ? (
            <i
              key={p.label}
              className={cn("block h-full", toneBg[p.tone])}
              style={{ "--pct": pctOf(p.value, max), width: "calc(var(--pct) * 1%)" } as Vars}
            />
          ) : null,
        )}
      </span>
      <span className="flex min-w-8 items-center justify-end gap-1.5">
        <b className="font-semibold tabular-nums">{total}</b>
        {end}
      </span>
    </div>
  );
}

/** Period chips as LINKS — the period lives in the URL, so the page stays a
 *  server render and a period is something a manager can send. Drawn with the
 *  ToggleGroup's own track and lit word (components/ui/segmented.tsx). */
export function PeriodLinks<T extends string>({
  label,
  value,
  options,
  href,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  href: (v: T) => string;
}) {
  return (
    <nav aria-label={label} data-segmented="" className={SEG_TRACK}>
      {options.map((o) => (
        <Link
          key={o.value}
          href={href(o.value)}
          scroll={false}
          aria-current={o.value === value ? "page" : undefined}
          className={cn(SEG_ITEM, o.value === value ? SEG_LIT : SEG_IDLE)}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}

// ---- the analytics page ---------------------------------------------------------

export type AnalyticsPeriod = "1w" | "4w" | "12w";
/** Weeks handed to `rh_analytics(p_weeks)`. The RPC counts whole calendar
 *  weeks from Monday, so the words say weeks, not days. */
export const ANALYTICS_WEEKS: Record<AnalyticsPeriod, number> = { "1w": 1, "4w": 4, "12w": 12 };
const PERIOD_OPTIONS: { value: AnalyticsPeriod; label: string }[] = [
  { value: "1w", label: "This week" },
  { value: "4w", label: "4 weeks" },
  { value: "12w", label: "12 weeks" },
];

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 1000) / 10}%`);
const days = (v: number | null) => (v == null ? "—" : `${Math.round(v * 10) / 10} d`);
/** Axis label — charts stay short (AGENTS "Dates": chart axis labels exempt). */
const weekLabel = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const SOURCE_LABEL: Record<TicketSource, string> = { form: "Form", qr: "QR sticker", ai: "AI-assisted" };
const SOURCE_TONE: Record<TicketSource, DashboardTone> = { form: "primary", qr: "info", ai: "accent" };

export function AnalyticsView({
  data,
  period,
  since,
}: {
  data: ResolveAnalytics;
  period: AnalyticsPeriod;
  /** DD/MM/YYYY the range starts on — computed on the server. */
  since: string;
}) {
  const t = data.totals;
  const sources = data.by_source.filter((s) => s.count > 0);
  const problems = data.repeats.slice(0, 8);
  const problemMax = Math.max(1, ...problems.map((r) => r.count));
  const late = data.late_by_place.slice(0, 8);
  const lateMax = Math.max(1, ...late.map((r) => r.late));
  const closers = data.top_closers.slice(0, 5);
  const closerMax = Math.max(1, ...closers.map((r) => r.closed));
  const overdue = data.top_overdue.slice(0, 5);
  const overdueMax = Math.max(1, ...overdue.map((r) => r.overdue));
  const latePct = t.open ? `${Math.round((t.late / t.open) * 100)}% of open` : "nothing open";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PeriodLinks label="Period" value={period} options={PERIOD_OPTIONS} href={(v) => `/resolve/analytics?period=${v}`} />
        <span className="text-xs text-muted-foreground tabular-nums">Reported since {since}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <KpiTile
          label="Reported"
          value={t.total}
          note={`${t.closed} closed · ${pct(data.reopen_rate)} reopened · ${t.disputed} disputed`}
        />
        <KpiTile
          label="Open"
          value={t.open}
          note={`${t.blocked} blocked · ${t.fixed} awaiting a check`}
          noteTone={t.blocked ? "warning" : undefined}
        />
        <KpiTile label="Late" value={t.late} tone={t.late ? "danger" : undefined} note={latePct} noteTone={t.late ? "danger" : undefined} />
        <KpiTile
          label="Median days to fix"
          value={days(data.median_days_to_fix)}
          note={`${pct(data.verified_fix_rate)} verified fix · avg close ${days(data.avg_resolution_days)}`}
          noteTone={data.verified_fix_rate != null && data.verified_fix_rate >= 0.9 ? "success" : undefined}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Verified fix = closed by fix photo or spot check and never reopened ÷ those closures. Days leave paused time out.
      </p>

      <div className="grid gap-3 lg:grid-cols-3">
        <InsightCard
          className="lg:col-span-2"
          title="New vs fixed"
          aside={
            <BarLegend
              items={[
                { label: "New", tone: "primary" },
                { label: "Fixed", tone: "success" },
              ]}
            />
          }
        >
          <BarChartMini
            height="sm"
            bars={data.weekly.map((w) => ({ label: weekLabel(w.week_start), a: w.created, b: w.fixed }))}
            tones={["primary", "success"]}
            format={(b) => `Week of ${b.label}: ${b.a} new · ${b.b} fixed`}
          />
        </InsightCard>

        <InsightCard title="How it was reported">
          {sources.length ? (
            <div className="flex flex-col gap-2">
              {sources.map((s) => (
                <HBar
                  key={s.source}
                  label={SOURCE_LABEL[s.source] ?? s.source}
                  value={s.count}
                  max={t.total || 1}
                  tone={SOURCE_TONE[s.source] ?? "info"}
                />
              ))}
            </div>
          ) : (
            <ChartEmpty>No reports yet.</ChartEmpty>
          )}
        </InsightCard>

        <InsightCard title="Top problems" aside={<span className="text-xs text-muted-foreground">same place, same trade</span>}>
          {problems.length ? (
            <div className="flex flex-col gap-2">
              {problems.map((r, i) => (
                <HBar
                  key={`${r.place_name}|${r.trade_name}|${i}`}
                  label={`${r.trade_name} · ${r.place_name}`}
                  value={r.count}
                  max={problemMax}
                  tone="warning"
                />
              ))}
            </div>
          ) : (
            <p className="py-4 text-center text-xs text-muted-foreground">No place has the same problem twice.</p>
          )}
        </InsightCard>

        <InsightCard title="Most late" aside={<span className="text-xs text-muted-foreground">by place, right now</span>}>
          {late.length ? (
            <div className="flex flex-col gap-2">
              {late.map((r) => (
                <HBar key={r.place_id} label={r.place_name} value={r.late} max={lateMax} tone="danger" />
              ))}
            </div>
          ) : (
            <p className="py-4 text-center text-xs text-muted-foreground">Nothing is late.</p>
          )}
        </InsightCard>

        <InsightCard title="People">
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Most closed</p>
            {closers.map((r) => (
              <HBar key={`c-${r.profile_id}`} label={r.name} value={r.closed} max={closerMax} tone="success" title={`${r.closed} closed`} />
            ))}
            {!closers.length && <p className="text-xs text-muted-foreground">Nobody has closed a job yet.</p>}
            <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Most overdue now</p>
            {overdue.map((r) => (
              <HBar key={`o-${r.profile_id}`} label={r.name} value={r.overdue} max={overdueMax} tone="danger" title={`${r.overdue} overdue`} />
            ))}
            {!overdue.length && <p className="text-xs text-muted-foreground">Nobody has an overdue job.</p>}
          </div>
        </InsightCard>
      </div>
    </div>
  );
}
