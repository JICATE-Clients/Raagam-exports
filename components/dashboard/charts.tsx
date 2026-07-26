import type { CSSProperties, ReactNode } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DashboardTone, TrendPoint } from "@/lib/dashboard/types";
import { toneBg, toneVar } from "./tone";

/**
 * Charts for the dashboard, as plain SVG and CSS.
 *
 * ## Why not recharts, which the app already depends on
 *
 * recharts requires `"use client"`, and its `ResponsiveContainer` measures its
 * parent with a ResizeObserver — returning `null` on the first pass. Every
 * chart would therefore stream as an empty box and pop in after hydration,
 * which defeats the whole point of rendering these sections on the server, and
 * reintroduces exactly the layout shift the skeletons exist to prevent. It also
 * can't follow the design tokens (components/reports/report-chart.tsx has to
 * hard-code its palette), and it is ~100 kB gzipped on the app's most-visited
 * route.
 *
 * None of the shapes here need a library: bars are divs with a percentage
 * height, the area chart is one polygon and two polylines, and both the donut
 * and the rings are conic-gradients. recharts stays where it earns its cost —
 * the configurable report viewer.
 *
 * ## The geometry convention
 *
 * The house rule is Tailwind classes, not inline styles. But a bar's height and
 * a ring's sweep are *data*, and no class can express them. The compromise used
 * throughout this folder: inline `style` carries CSS custom properties only,
 * and a static class does the arithmetic — `style={{"--pct": 82}}` paired with
 * `h-[calc(var(--pct)*1%)]`. Note `--pct` must be a bare number; passing "82%"
 * makes the calc() invalid and the element collapses.
 */

type Vars = CSSProperties & Record<string, string | number>;

/* ------------------------------------------------------------------ *
 * Frames
 * ------------------------------------------------------------------ */

/**
 * The shared chrome around every chart. Its `subtitle` is load-bearing rather
 * than decorative: the trend charts are pinned to a trailing 12 months while
 * the KPIs above them follow the range selector, and this is where that gets
 * said. A period stated on the card is honest; one buried in a tooltip isn't.
 */
export function ChartFrame({
  title,
  subtitle,
  aside,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex min-w-0 flex-col", className)}>
      <CardHeader className="items-start">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {aside}
      </CardHeader>
      <CardBody className="flex-1">{children}</CardBody>
    </Card>
  );
}

export function ChartLegend({
  items,
}: {
  items: { label: string; tone: DashboardTone }[];
}) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      {items.map((i) => (
        <span
          key={i.label}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
        >
          <i className={cn("h-2 w-2 rounded-[2px]", toneBg[i.tone])} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

export function ChartEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="py-16 text-center text-sm text-muted-foreground">{children}</p>
  );
}

/* ------------------------------------------------------------------ *
 * Sparkline
 * ------------------------------------------------------------------ */

/**
 * The 76×28 trace inside a KPI card. Decorative by intent — it shows shape, not
 * values — so it is aria-hidden and carries no axis.
 */
export function Sparkline({
  values,
  tone = "pos",
}: {
  values: number[];
  tone?: DashboardTone;
}) {
  if (values.length < 2) return null;

  const W = 104;
  const H = 34;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = W / (values.length - 1);
  const y = (v: number) => H - 4 - ((v - min) / span) * (H - 8);

  const points = values.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`);
  const line = points.join(" ");
  const stroke = toneVar(tone);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-7 w-[76px] shrink-0 overflow-visible"
      aria-hidden="true"
    >
      <polygon
        points={`${line} ${W},${H} 0,${H}`}
        fill={stroke}
        opacity={0.13}
      />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        // preserveAspectRatio="none" would otherwise stretch the stroke itself.
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={W} cy={y(values[values.length - 1])} r={2.6} fill={stroke} />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Bars, rings, donut
 * ------------------------------------------------------------------ */

export function ProgressBar({
  pct,
  tone = "primary",
  size = "md",
}: {
  pct: number;
  tone?: DashboardTone;
  size?: "sm" | "md";
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div
      className={cn(
        "overflow-hidden rounded-full bg-surface-muted",
        size === "sm" ? "h-1" : "h-1.5",
      )}
    >
      <div
        className={cn("h-full rounded-full", toneBg[tone])}
        style={{ "--pct": clamped, width: "calc(var(--pct) * 1%)" } as Vars}
      />
    </div>
  );
}

/** A 42px conic-gradient ring with its percentage in the middle. */
export function ProgressRing({
  pct,
  tone = "primary",
  label,
  note,
}: {
  pct: number;
  tone?: DashboardTone;
  label: string;
  note?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-[conic-gradient(var(--tone)_0_calc(var(--pct)*1%),var(--surface-muted)_calc(var(--pct)*1%)_100%)]"
        style={{ "--pct": clamped, "--tone": toneVar(tone) } as Vars}
      >
        <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-surface text-[10px] font-semibold tabular-nums">
          {clamped}%
        </span>
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-medium">{label}</span>
        {note && (
          <span className="truncate text-[11px] text-muted-foreground">{note}</span>
        )}
      </span>
    </div>
  );
}

/**
 * Donut + legend. The gradient stops are fully dynamic, so the whole
 * `conic-gradient(...)` is composed here and handed over as a custom property,
 * then applied with `bg-[image:var(--g)]` — the same colour-vs-image
 * distinction that `--smoke` depends on in components/ui/card.tsx.
 */
export function DonutChart({
  slices,
  total,
  unit,
}: {
  slices: { label: string; count: number; tone: DashboardTone }[];
  total: number;
  unit: string;
}) {
  if (total <= 0 || slices.length === 0) {
    return <ChartEmpty>Nothing open right now.</ChartEmpty>;
  }

  // Each slice's arc runs from the sum of everything before it to that sum plus
  // its own count. Computed per slice rather than with a running counter: a
  // variable reassigned inside .map() during render is exactly what the React
  // Compiler lint rejects, and with at most a handful of statuses the repeated
  // sum costs nothing.
  const stops = slices.map((slice, i) => {
    const before = slices.slice(0, i).reduce((t, x) => t + x.count, 0);
    const from = (before / total) * 100;
    const to = ((before + slice.count) / total) * 100;
    return `${toneVar(slice.tone)} ${from.toFixed(2)}% ${to.toFixed(2)}%`;
  });

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div
        className="relative h-[132px] w-[132px] shrink-0 rounded-full bg-[image:var(--g)]"
        style={{ "--g": `conic-gradient(${stops.join(",")})` } as Vars}
      >
        <div className="absolute inset-[17px] flex flex-col items-center justify-center rounded-full bg-surface">
          <span className="text-[22px] font-semibold tabular-nums">{total}</span>
          <span className="text-[10px] text-muted-foreground">{unit}</span>
        </div>
      </div>
      <ul className="flex min-w-[150px] flex-1 flex-col gap-2.5">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2.5">
            <i className={cn("h-2.5 w-2.5 shrink-0 rounded-[3px]", toneBg[s.tone])} />
            <span className="flex-1 truncate text-xs text-muted-foreground">
              {s.label}
            </span>
            <span className="text-xs font-semibold tabular-nums">{s.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Grouped column chart, one or two series.
 *
 * The hover tooltip is pure CSS — a `group-hover` opacity swap on an absolutely
 * positioned span — plus a native `title` on the same element. A client
 * component here would drag every bar's data across the serialization boundary
 * to power a hover affordance, and `title` covers the cases CSS can't: long
 * press on touch, and screen readers.
 */
export function BarChartMini({
  bars,
  tones = ["primary", "accent"],
  format,
  height = "md",
}: {
  bars: TrendPoint[];
  tones?: [DashboardTone, DashboardTone?];
  /** Builds the tooltip text; keeps unit knowledge out of this component. */
  format: (b: TrendPoint) => string;
  height?: "sm" | "md";
}) {
  if (bars.length === 0) return <ChartEmpty>No data for this period.</ChartEmpty>;

  const max = Math.max(1, ...bars.flatMap((b) => [b.a, b.b]));
  const hasB = bars.some((b) => b.b > 0);

  return (
    <div
      className={cn(
        "grid auto-cols-fr grid-flow-col gap-2",
        height === "sm" ? "h-[132px]" : "h-[210px]",
      )}
    >
      {bars.map((b, i) => (
        <div
          key={`${b.label}-${i}`}
          title={format(b)}
          className="group relative grid h-full grid-rows-[1fr_auto] gap-2 rounded-lg transition-colors hover:bg-surface-muted"
        >
          <span
            role="tooltip"
            className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-foreground px-2.5 py-1.5 text-[11px] font-medium text-background opacity-0 shadow-elev-hi transition-opacity group-hover:opacity-100"
          >
            {format(b)}
          </span>
          <div className="flex items-end justify-center gap-[3px]">
            <div
              className={cn(
                "w-[44%] max-w-4 origin-bottom animate-grow rounded-t-[4px]",
                toneBg[tones[0]],
              )}
              style={{ "--h": (b.a / max) * 100, height: "calc(var(--h) * 1%)" } as Vars}
            />
            {hasB && (
              <div
                className={cn(
                  "w-[44%] max-w-4 origin-bottom animate-grow rounded-t-[4px]",
                  toneBg[tones[1] ?? "accent"],
                )}
                style={{ "--h": (b.b / max) * 100, height: "calc(var(--h) * 1%)" } as Vars}
              />
            )}
          </div>
          <span className="truncate text-center text-[10px] text-muted-foreground">
            {b.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Filled area + dashed comparison line, on a fixed 720×220 viewBox that
 * stretches to the card. Strokes use `non-scaling-stroke` so the aspect
 * distortion doesn't thicken them.
 */
export function AreaChart({
  labels,
  primary,
  secondary,
  primaryTone = "primary",
  secondaryTone = "accent",
}: {
  labels: string[];
  primary: number[];
  secondary?: number[];
  primaryTone?: DashboardTone;
  secondaryTone?: DashboardTone;
}) {
  if (primary.length < 2) return <ChartEmpty>No data for this period.</ChartEmpty>;

  const W = 720;
  const H = 220;
  const PAD = 12;
  const max = Math.max(1, ...primary, ...(secondary ?? []));
  const x = (i: number) => (i * W) / (primary.length - 1);
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const path = (vals: number[]) =>
    vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  const line = path(primary);

  return (
    <div className="min-w-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-[220px] w-full"
        aria-hidden="true"
      >
        {[0.1, 0.37, 0.64, 0.91].map((f) => (
          <line
            key={f}
            x1={0}
            y1={H * f}
            x2={W}
            y2={H * f}
            stroke="var(--border)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <polygon
          points={`${line} ${W},${H} 0,${H}`}
          fill={toneVar(primaryTone)}
          opacity={0.14}
        />
        <polyline
          points={line}
          fill="none"
          stroke={toneVar(primaryTone)}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {secondary && secondary.length === primary.length && (
          <polyline
            points={path(secondary)}
            fill="none"
            stroke={toneVar(secondaryTone)}
            strokeWidth={2}
            strokeDasharray="5 5"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="mt-2 grid auto-cols-fr grid-flow-col">
        {labels.map((l, i) => (
          <span
            key={`${l}-${i}`}
            className="truncate text-center text-[10px] text-muted-foreground"
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
