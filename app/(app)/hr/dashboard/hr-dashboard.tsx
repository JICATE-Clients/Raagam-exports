import Image from "next/image";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  RefreshCw,
  AlarmClock,
  CalendarDays,
  Fingerprint,
  Gauge as Gauge2,
  LogOut,
  PieChart,
  ArrowUpRight,
  DoorOpen,
  Moon,
  TriangleAlert,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { AutoRefresh } from "@/components/hr/auto-refresh";
import { FlipCard } from "@/components/hr/flip-card";
import { HeroHyperspeed } from "@/components/hr/hero-hyperspeed";
import { RadarPanel } from "@/components/hr/radar-panel";
import { CelebrateScene, GroupFigure, HurryScene, TeamScene, WaitingScene, WorkingScene } from "@/components/hr/people-art";
import { TIMING_GROUPS, timingGroupLabel, isOvernight, shiftMinutes, type TimingGroup } from "@/lib/masters/group-timing-types";
import type { HrDashboard } from "@/lib/hr/dashboard-service";
import type { DayStatus, GroupDay, PersonDay } from "@/lib/hr/timing-calc";
import { fmtDate, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
 * HR ▸ Dashboard — a professional analytics view (client 2026-10-28: "professional,
 * high quality, sharp … not like children built"). One accent (indigo); green,
 * amber and rose appear only where they MEAN something — on time, late, absent.
 * Crisp white panels on a neutral canvas, real axes and gridlines, tabular
 * numerals. Full-bleed in the content pane; scrolls like any page.
 *
 * Server-rendered SVG/CSS throughout; the only client code is the one-minute
 * refresh. Colour classes are complete literals (Tailwind scans source text).
 */

const IST_OFFSET_MS = 330 * 60_000;
const ONLINE_WINDOW_MS = 2 * 60_000;
const PRESENT: DayStatus[] = ["inside", "stepped_out", "left", "left_early"];
const isPresent = (d: PersonDay) => PRESENT.includes(d.status);

/* Semantic palette — hex for SVG, classes for HTML. */
const C = {
  indigo: "#4f46e5",
  indigoSoft: "#c7d2fe",
  emerald: "#059669",
  amber: "#f59e0b",
  rose: "#e11d48",
  slate: "#cbd5e1",
};

const GROUP: Record<TimingGroup, { hex: string; dot: string; chip: string; band: string; shadow: string }> = {
  staff: { hex: "#4f46e5", shadow: "shadow-indigo-500/20 hover:shadow-indigo-500/30", band: "from-indigo-500 to-violet-600", dot: "bg-sky-400", chip: "bg-indigo-50 text-indigo-700 ring-indigo-600/15 dark:bg-indigo-500/10 dark:text-indigo-300" },
  security: { hex: "#d97706", shadow: "shadow-orange-500/20 hover:shadow-orange-500/30", band: "from-amber-400 to-orange-500", dot: "bg-amber-400", chip: "bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-500/10 dark:text-amber-300" },
  production_staff: { hex: "#0d9488", shadow: "shadow-emerald-500/20 hover:shadow-emerald-500/30", band: "from-emerald-500 to-teal-600", dot: "bg-emerald-400", chip: "bg-teal-50 text-teal-700 ring-teal-600/15 dark:bg-teal-500/10 dark:text-teal-300" },
};

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
}
function istHour(ms: number): number {
  return new Date(ms + IST_OFFSET_MS).getUTCHours();
}
function mins(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}
function pctOf(n: number, d: number): number {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}
function count(groups: GroupDay[], pick: (d: PersonDay) => boolean): number {
  return groups.reduce((t, g) => t + g.people.filter(pick).length, 0);
}

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

const PANEL =
  "min-w-0 rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04),0_1px_3px_rgb(16_24_40/0.04)] dark:border-slate-800 dark:bg-slate-900";

/** Accent per panel: a gradient icon badge and a 3px rule along the top. */
/**
 * EVERY PANEL ITS OWN COLOUR (client 2026-10-28: "every card is diff clr and
 * should pop up in its own way … it should be fun"). One family per panel:
 * tinted ground, coloured border and shadow, a glow in the corner, a gradient
 * icon badge, a coloured title — and its own hover move.
 */
const ACCENT = {
  violet: {
    card: "border-violet-200 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 shadow-violet-500/10 hover:shadow-violet-500/25 dark:border-violet-500/30 dark:from-violet-500/10 dark:via-slate-900 dark:to-slate-900",
    rule: "from-violet-500 via-purple-500 to-fuchsia-500",
    badge: "from-violet-500 to-fuchsia-600 shadow-violet-500/40",
    blob: "bg-violet-400/30",
    title: "text-violet-700 dark:text-violet-300",
    line: "border-violet-100 dark:border-violet-500/20",
    pop: "hover:-translate-y-1",
  },
  teal: {
    card: "border-teal-200 bg-gradient-to-br from-teal-50 via-white to-emerald-50 shadow-teal-500/10 hover:shadow-teal-500/25 dark:border-teal-500/30 dark:from-teal-500/10 dark:via-slate-900 dark:to-slate-900",
    rule: "from-teal-400 via-emerald-500 to-green-500",
    badge: "from-teal-500 to-emerald-600 shadow-teal-500/40",
    blob: "bg-teal-400/30",
    title: "text-teal-700 dark:text-teal-300",
    line: "border-teal-100 dark:border-teal-500/20",
    pop: "hover:-translate-y-1",
  },
  sky: {
    card: "border-sky-200 bg-gradient-to-br from-sky-50 via-white to-blue-50 shadow-sky-500/10 hover:shadow-sky-500/25 dark:border-sky-500/30 dark:from-sky-500/10 dark:via-slate-900 dark:to-slate-900",
    rule: "from-sky-400 via-blue-500 to-indigo-500",
    badge: "from-sky-500 to-blue-600 shadow-sky-500/40",
    blob: "bg-sky-400/30",
    title: "text-sky-700 dark:text-sky-300",
    line: "border-sky-100 dark:border-sky-500/20",
    pop: "hover:-translate-y-1",
  },
  orange: {
    card: "border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-50 shadow-orange-500/10 hover:shadow-orange-500/25 dark:border-orange-500/30 dark:from-orange-500/10 dark:via-slate-900 dark:to-slate-900",
    rule: "from-yellow-400 via-orange-500 to-red-500",
    badge: "from-orange-400 to-red-500 shadow-orange-500/40",
    blob: "bg-orange-400/30",
    title: "text-orange-700 dark:text-orange-300",
    line: "border-orange-100 dark:border-orange-500/20",
    pop: "hover:-translate-y-1",
  },
  amber: {
    card: "border-amber-200 bg-gradient-to-br from-amber-50 via-white to-yellow-50 shadow-amber-500/10 hover:shadow-amber-500/25 dark:border-amber-500/30 dark:from-amber-500/10 dark:via-slate-900 dark:to-slate-900",
    rule: "from-amber-300 via-amber-500 to-orange-500",
    badge: "from-amber-400 to-orange-500 shadow-amber-500/40",
    blob: "bg-amber-400/30",
    title: "text-amber-700 dark:text-amber-300",
    line: "border-amber-100 dark:border-amber-500/20",
    pop: "hover:-translate-y-1 hover:scale-[1.01]",
  },
  cyan: {
    card: "border-cyan-200 bg-gradient-to-br from-cyan-50 via-white to-sky-50 shadow-cyan-500/10 hover:shadow-cyan-500/25 dark:border-cyan-500/30 dark:from-cyan-500/10 dark:via-slate-900 dark:to-slate-900",
    rule: "from-cyan-400 via-sky-500 to-blue-500",
    badge: "from-cyan-400 to-sky-600 shadow-cyan-500/40",
    blob: "bg-cyan-400/30",
    title: "text-cyan-700 dark:text-cyan-300",
    line: "border-cyan-100 dark:border-cyan-500/20",
    pop: "hover:-translate-y-1 hover:scale-[1.01]",
  },
  rose: {
    card: "border-rose-200 bg-gradient-to-br from-rose-50 via-white to-pink-50 shadow-rose-500/10 hover:shadow-rose-500/25 dark:border-rose-500/30 dark:from-rose-500/10 dark:via-slate-900 dark:to-slate-900",
    rule: "from-rose-500 via-pink-500 to-fuchsia-500",
    badge: "from-rose-500 to-pink-600 shadow-rose-500/40",
    blob: "bg-rose-400/30",
    title: "text-rose-700 dark:text-rose-300",
    line: "border-rose-100 dark:border-rose-500/20",
    pop: "hover:-translate-y-1 hover:scale-[1.01]",
  },
  fuchsia: {
    card: "border-fuchsia-200 bg-gradient-to-br from-fuchsia-50 via-white to-indigo-50 shadow-fuchsia-500/10 hover:shadow-fuchsia-500/25 dark:border-fuchsia-500/30 dark:from-fuchsia-500/10 dark:via-slate-900 dark:to-slate-900",
    rule: "from-fuchsia-500 via-purple-500 to-indigo-500",
    badge: "from-fuchsia-500 to-indigo-600 shadow-fuchsia-500/40",
    blob: "bg-fuchsia-400/30",
    title: "text-fuchsia-700 dark:text-fuchsia-300",
    line: "border-fuchsia-100 dark:border-fuchsia-500/20",
    pop: "hover:-translate-y-1",
  },
  emerald: {
    card: "border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-lime-50 shadow-emerald-500/10 hover:shadow-emerald-500/25 dark:border-emerald-500/30 dark:from-emerald-500/10 dark:via-slate-900 dark:to-slate-900",
    rule: "from-lime-400 via-emerald-500 to-teal-500",
    badge: "from-emerald-500 to-green-600 shadow-emerald-500/40",
    blob: "bg-emerald-400/30",
    title: "text-emerald-700 dark:text-emerald-300",
    line: "border-emerald-100 dark:border-emerald-500/20",
    pop: "hover:-translate-y-1",
  },
  indigo: {
    card: "border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-violet-50 shadow-indigo-500/10 hover:shadow-indigo-500/25 dark:border-indigo-500/30 dark:from-indigo-500/10 dark:via-slate-900 dark:to-slate-900",
    rule: "from-indigo-500 via-violet-500 to-fuchsia-500",
    badge: "from-indigo-500 to-violet-600 shadow-indigo-500/40",
    blob: "bg-indigo-400/30",
    title: "text-indigo-700 dark:text-indigo-300",
    line: "border-indigo-100 dark:border-indigo-500/20",
    pop: "hover:-translate-y-1",
  },
} as const;
type Accent = keyof typeof ACCENT;

function Panel({
  title,
  subtitle,
  action,
  className,
  bodyClass,
  accent,
  icon: Icon,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
  bodyClass?: string;
  accent?: Accent;
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  const a = accent ? ACCENT[accent] : null;
  return (
    <section
      className={cn(
        a
          ? cn("group/panel relative isolate flex min-w-0 flex-col overflow-hidden rounded-2xl border shadow-lg transition duration-300 hover:shadow-2xl", a.card, a.pop)
          : cn(PANEL, "relative flex flex-col overflow-hidden"),
        className,
      )}
    >
      {a && (
        <>
          <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", a.rule)} />
          <span aria-hidden className={cn("pointer-events-none absolute -right-14 -top-14 -z-10 h-44 w-44 rounded-full blur-3xl transition-transform duration-500 group-hover/panel:scale-150", a.blob)} />
        </>
      )}
      <header className={cn("flex items-start gap-3 border-b px-5 py-3.5", a ? a.line : "border-slate-100 dark:border-slate-800")}>
        {Icon && a && (
          <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-lg ring-2 ring-white transition-transform duration-300 group-hover/panel:rotate-6 group-hover/panel:scale-110 dark:ring-slate-900", a.badge)}>
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className={cn("text-sm font-semibold", a ? a.title : "text-slate-900 dark:text-slate-100")}>{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className={cn("flex-1 p-5", bodyClass)}>{children}</div>
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400">{children}</p>;
}

function Dot({ className }: { className: string }) {
  return <i className={cn("inline-block h-2 w-2 shrink-0 rounded-full", className)} />;
}

function GroupChip({ group }: { group: TimingGroup }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", GROUP[group].chip)}>
      {timingGroupLabel(group)}
    </span>
  );
}

function Empty({ children, art }: { children: React.ReactNode; art?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-6 text-center">
      {art}
      <p className="text-sm text-slate-500 dark:text-slate-400">{children}</p>
    </div>
  );
}

/* KPI cell in the top strip. */
const KPI_TONE = {
  indigo: { blob: "bg-indigo-400/40", card: "border-indigo-200 from-indigo-100 shadow-indigo-500/15 dark:border-indigo-500/30 dark:from-indigo-500/15", badge: "from-indigo-500 to-violet-600 shadow-indigo-500/30", bar: "from-indigo-500 to-violet-500", text: "text-indigo-600 dark:text-indigo-400" },
  emerald: { blob: "bg-emerald-400/40", card: "border-emerald-200 from-emerald-100 shadow-emerald-500/15 dark:border-emerald-500/30 dark:from-emerald-500/15", badge: "from-emerald-500 to-teal-600 shadow-emerald-500/30", bar: "from-emerald-500 to-teal-400", text: "text-emerald-600 dark:text-emerald-400" },
  amber: { blob: "bg-amber-400/40", card: "border-amber-200 from-amber-100 shadow-amber-500/15 dark:border-amber-500/30 dark:from-amber-500/15", badge: "from-amber-400 to-orange-500 shadow-orange-500/30", bar: "from-amber-400 to-orange-500", text: "text-orange-600 dark:text-amber-400" },
  rose: { blob: "bg-rose-400/40", card: "border-rose-200 from-rose-100 shadow-rose-500/15 dark:border-rose-500/30 dark:from-rose-500/15", badge: "from-rose-500 to-pink-600 shadow-rose-500/30", bar: "from-rose-500 to-pink-500", text: "text-rose-600 dark:text-rose-400" },
  sky: { blob: "bg-sky-400/40", card: "border-sky-200 from-sky-100 shadow-sky-500/15 dark:border-sky-500/30 dark:from-sky-500/15", badge: "from-sky-500 to-blue-600 shadow-sky-500/30", bar: "from-sky-400 to-blue-500", text: "text-sky-600 dark:text-sky-400" },
  violet: { blob: "bg-violet-400/40", card: "border-violet-200 from-violet-100 shadow-violet-500/15 dark:border-violet-500/30 dark:from-violet-500/15", badge: "from-violet-500 to-fuchsia-600 shadow-violet-500/30", bar: "from-violet-500 to-fuchsia-500", text: "text-violet-600 dark:text-violet-400" },
} as const;

function Kpi({
  label,
  value,
  unit,
  note,
  art,
  tone,
  bar,
}: {
  label: string;
  value: string | number;
  unit?: string;
  note: React.ReactNode;
  /** A 3D icon under /public/hr/3d — see the note on the files there. */
  art: string;
  tone: keyof typeof KPI_TONE;
  bar?: number;
}) {
  const t = KPI_TONE[tone];
  return (
    <div className={cn("group/kpi relative isolate min-w-0 overflow-hidden rounded-2xl border bg-gradient-to-br to-white px-5 py-4 shadow-lg transition duration-300 hover:-translate-y-1.5 hover:scale-[1.02] hover:shadow-2xl dark:to-slate-900", t.card)}>
      <span aria-hidden className={cn("pointer-events-none absolute -right-8 -top-8 -z-10 h-28 w-28 rounded-full blur-2xl transition-transform duration-500 group-hover/kpi:scale-150", t.blob)} />
      <span aria-hidden className={cn("absolute inset-x-0 bottom-0 h-1 bg-gradient-to-r", t.bar)} />
      <div className="flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {/*
          3D icons (client 2026-10-28: "real images or like a 3D one, colourful,
          not like a bg") — Microsoft Fluent Emoji 3D, MIT licence, vendored in
          /public/hr/3d so nothing is fetched from outside at runtime. No
          coloured badge behind them: the object IS the colour. On hover it
          hops and tilts.
        */}
        <Image
          src={art}
          alt=""
          width={32}
          height={32}
          className="h-8 w-8 shrink-0 drop-shadow-[0_3px_4px_rgb(15_23_42/0.16)] transition-transform duration-300 group-hover/kpi:-translate-y-0.5 group-hover/kpi:-rotate-6 group-hover/kpi:scale-110"
        />
      </div>
      <p className="mt-2 flex items-baseline gap-1 text-[28px] font-semibold leading-none tracking-tight tabular-nums text-slate-900 dark:text-white">
        {value}
        {unit && <span className="text-sm font-medium text-slate-400">{unit}</span>}
      </p>
      <div className={cn("mt-2 text-xs font-medium", t.text)}>{note}</div>
      {bar != null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/70 ring-1 ring-slate-200/60 dark:bg-slate-800 dark:ring-0">
          <div className={cn("h-full rounded-full bg-gradient-to-r", t.bar)} style={{ width: `${Math.min(100, bar)}%` }} />
        </div>
      )}
    </div>
  );
}

/* Donut with a centred total. */
function Donut({ slices, total, label }: { slices: { v: number; hex: string }[]; total: number; label: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const sum = slices.reduce((t, s) => t + s.v, 0);
  return (
    <div className="relative h-[148px] w-[148px] shrink-0">
      <svg viewBox="0 0 132 132" className="h-full w-full -rotate-90">
        <circle cx="66" cy="66" r={r} fill="none" stroke="currentColor" strokeWidth="14" className="text-slate-100 dark:text-slate-800" />
        {sum > 0 &&
          slices.map((s, i) => {
            const before = slices.slice(0, i).reduce((t, x) => t + x.v, 0);
            const len = (s.v / sum) * c;
            return s.v > 0 ? (
              <circle
                key={i}
                cx="66"
                cy="66"
                r={r}
                fill="none"
                stroke={s.hex}
                strokeWidth="14"
                strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`}
                strokeDashoffset={-(before / sum) * c}
              />
            ) : null;
          })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">{total}</p>
          <p className="text-[11px] text-slate-500">{label}</p>
        </div>
      </div>
    </div>
  );
}

/* Half-circle gauge, single accent arc. */
function Gauge({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct));
  const r = 80;
  const len = Math.PI * r;
  const hex = p >= 90 ? C.emerald : p >= 75 ? C.indigo : p >= 50 ? C.amber : C.rose;
  return (
    <div className="relative mx-auto w-full max-w-[240px]">
      <svg viewBox="0 0 200 110" className="w-full">
        <path d="M20,100 A80,80 0 0 1 180,100" fill="none" stroke="currentColor" strokeWidth="14" strokeLinecap="round" className="text-slate-100 dark:text-slate-800" />
        <defs>
          <linearGradient id="gauge-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f43f5e" />
            <stop offset="40%" stopColor="#f59e0b" />
            <stop offset="70%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>
        <path
          d="M20,100 A80,80 0 0 1 180,100"
          fill="none"
          stroke="url(#gauge-grad)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${(p / 100) * len} ${len}`}
        />
        {[0, 25, 50, 75, 100].map((t) => {
          const a = Math.PI + (t / 100) * Math.PI;
          return (
            <line
              key={t}
              x1={100 + 66 * Math.cos(a)}
              y1={100 + 66 * Math.sin(a)}
              x2={100 + 61 * Math.cos(a)}
              y2={100 + 61 * Math.sin(a)}
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-slate-300 dark:text-slate-600"
            />
          );
        })}
      </svg>
      <div className="absolute inset-x-0 bottom-1 text-center">
        <p className="text-3xl font-semibold tracking-tight tabular-nums" style={{ color: hex }}>{p.toFixed(1)}%</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export function HrDashboardView({ data }: { data: HrDashboard }) {
  const { groups, now } = data;
  const all = groups.flatMap((g) => g.people);
  const enrolled = all.length;
  const present = count(groups, isPresent);
  const late = count(groups, (d) => isPresent(d) && d.lateMin > 0);
  const onTime = present - late;
  const absent = count(groups, (d) => d.status === "absent");
  const notIn = count(groups, (d) => d.status === "not_in");
  const inside = count(groups, (d) => d.status === "inside");
  const outNow = count(groups, (d) => d.status === "stepped_out");
  const gone = count(groups, (d) => d.status === "left");
  const leftEarly = count(groups, (d) => d.status === "left_early");
  const trips = all.reduce((t, d) => t + d.movements.length, 0);

  const lateMinutes = all.reduce((t, d) => t + d.lateMin, 0);
  const lostMin = lateMinutes + all.reduce((t, d) => t + d.earlyMin, 0);
  const avgLate = late ? Math.round(lateMinutes / late) : 0;
  const punctuality = present ? (onTime / present) * 100 : 0;

  // Activity by hour, 6 AM → 10 PM IST: ins (first punch) and all punches.
  const HOURS = Array.from({ length: 17 }, (_, i) => i + 6);
  const nowHour = istHour(now);
  const allPunches = HOURS.map((h) => all.reduce((t, d) => t + d.punches.filter((p) => istHour(p) === h).length, 0));
  const firstIns = HOURS.map((h) => all.filter((d) => d.firstAt != null && istHour(d.firstAt) === h).length);
  const yMax = Math.max(4, ...allPunches);
  const yTop = Math.ceil(yMax / 4) * 4;
  const CW = 640;
  const CH = 200;
  const PL = 32;
  const PB = 22;
  const x = (i: number) => PL + (i / (HOURS.length - 1)) * (CW - PL - 8);
  const y = (v: number) => 8 + (1 - v / yTop) * (CH - PB - 8);
  const upto = HOURS.filter((h) => h <= nowHour).length;
  const linePath = (vals: number[]) =>
    vals
      .slice(0, upto)
      .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
      .join(" ");
  const punchLine = linePath(allPunches);
  const inLine = linePath(firstIns);
  const punchArea = upto > 1 ? `${punchLine} L${x(upto - 1).toFixed(1)},${y(0)} L${x(0)},${y(0)} Z` : "";

  // Last 7 days.
  const days = [...new Set(data.trend.map((t) => t.day))].sort();
  const week = days.map((day) => {
    const rows = data.trend.filter((t) => t.day === day);
    return {
      day,
      dd: day.slice(8, 10),
      weekday: new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "UTC" }).format(Date.parse(`${day}T00:00:00Z`)),
      present: rows.reduce((t, r) => t + r.present, 0),
      late: rows.reduce((t, r) => t + r.late, 0),
      enrolled: rows.reduce((t, r) => t + r.enrolled, 0),
    };
  });
  const wMax = Math.max(4, ...week.map((w) => Math.max(w.present, w.enrolled)));
  const wTop = Math.ceil(wMax / 4) * 4;
  const avgWeek = week.length ? Math.round(week.reduce((t, w) => t + w.present, 0) / week.length) : 0;

  const lateList = all.filter((d) => isPresent(d) && d.lateMin > 0).sort((a, b) => b.lateMin - a.lateMin);
  const outList = all.filter((d) => d.status === "stepped_out").sort((a, b) => (a.lastAt ?? 0) - (b.lastAt ?? 0));
  const earlyList = all.filter((d) => d.status === "left_early").sort((a, b) => b.earlyMin - a.earlyMin);
  const online = data.devices.filter((d) => d.last_seen && now - Date.parse(d.last_seen) <= ONLINE_WINDOW_MS);
  // Radar blips = punches in the last 15 minutes (the sweep caps them at 16).
  const recentPunches = all.reduce((t, d) => t + d.punches.filter((p) => p >= now - 15 * 60_000).length, 0);
  const allOnline = data.devices.length > 0 && online.length === data.devices.length;
  const missingTimings = TIMING_GROUPS.filter((g) => !groups.find((x2) => x2.group === g.value)?.timing);

  const dateLine = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);

  const TH = "px-5 py-2 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400";
  const TD = "px-5 py-2.5 text-sm";

  return (
    /*
     * FULL BLEED (client 2026-10-28: "an actual dashboard", not a card).
     * `<main>` pads its child by p-4 (md:pb-6) with `w-full`; the negative
     * margins and widened width cancel that. `shrink-0` is what lets it scroll:
     * `<main>` is a scrolling flex column, and a child that could shrink is
     * squeezed to the pane's height.
     */
    <div className="-mx-4 -mt-4 min-h-[calc(100%+2rem)] shrink-0 bg-gradient-to-br from-indigo-50 via-slate-50 to-fuchsia-50 px-4 pb-8 pt-5 text-slate-700 !w-[calc(100%+2rem)] md:-mb-6 md:min-h-[calc(100%+2.5rem)] md:px-8 md:pt-7 dark:bg-slate-950 dark:text-slate-300">
      <AutoRefresh seconds={60} />
      <div className="mx-auto max-w-[1440px] space-y-6">
        {/* ── Header ───────────────────────────────────────── */}
        <header className="relative isolate flex flex-wrap items-end justify-between gap-4 overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-6 py-6 text-white shadow-lg shadow-indigo-500/20">
          <div aria-hidden className="absolute -right-16 -top-20 -z-10 h-56 w-56 rounded-full bg-white/15 blur-2xl" />
          <div aria-hidden className="absolute -bottom-24 left-1/3 -z-10 h-56 w-56 rounded-full bg-cyan-300/25 blur-3xl" />
          {/* Light-trail road behind everything (client 2026-10-28), with a
              soft wash on the left so the title stays readable over it. */}
          <HeroHyperspeed />
          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 -z-10 w-2/5 bg-gradient-to-r from-indigo-700/55 to-transparent" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/75">HR &amp; Payroll</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">Workforce overview</h1>
            <p className="mt-1 text-sm text-white/80">{dateLine}</p>
          </div>
          <TeamScene className="hidden h-28 shrink-0 drop-shadow-xl transition-transform duration-500 hover:-translate-y-1 lg:block" />
          <div className="flex flex-wrap items-center gap-2">
            {groups.map((g) => (
              <span key={g.group} className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-3 py-1.5 text-xs ring-1 ring-white/20 backdrop-blur">
                <Dot className={GROUP[g.group].dot} />
                {timingGroupLabel(g.group)}
                <b className="tabular-nums">
                  {g.people.filter(isPresent).length}/{g.people.length}
                </b>
              </span>
            ))}
            <span className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium ring-1 ring-white/20 backdrop-blur">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              Live · updated {clock(now)}
            </span>
            <Link
              href="/hr/attendance?view=live"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-50"
            >
              Live monitor <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </header>

        {(missingTimings.length > 0 || data.noGroup > 0 || data.unlinkedIds > 0) && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/5 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <ul className="min-w-0 flex-1 space-y-0.5">
              {missingTimings.length > 0 && (
                <li>
                  No Punch In / Out set for {missingTimings.map((g) => g.label).join(", ")}, so nobody there is marked late.{" "}
                  <Link href="/masters/hr/work-timing" className="font-semibold underline underline-offset-2">
                    Set Work Timing
                  </Link>
                </li>
              )}
              {data.noGroup > 0 && (
                <li>
                  {data.noGroup} enrolled {data.noGroup === 1 ? "person's category has" : "people's categories have"} no Timing Group.{" "}
                  <Link href="/masters/hr/employee-category" className="font-semibold underline underline-offset-2">
                    Fix on Employee Category
                  </Link>
                </li>
              )}
              {data.unlinkedIds > 0 && (
                <li>
                  {data.unlinkedIds} device {data.unlinkedIds === 1 ? "ID" : "IDs"} punched today but {data.unlinkedIds === 1 ? "is" : "are"} not linked to anyone in a timing group.
                </li>
              )}
            </ul>
          </div>
        )}

        {/* ── KPI strip ────────────────────────────────────── */}
        <section className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          <Kpi
            label="Present"
            value={present}
            unit={`/ ${enrolled}`}
            note={`${pctOf(present, enrolled)}% attendance`}
            art="/hr/3d/present.png"
            tone="indigo"
            bar={pctOf(present, enrolled)}
          />
          <Kpi
            label="On-time rate"
            value={`${pctOf(onTime, present)}%`}
            note={`${onTime} arrived on time`}
            art="/hr/3d/ontime.png"
            tone="emerald"
            bar={pctOf(onTime, present)}
          />
          <Kpi
            label="Late arrivals"
            value={late}
            note={late ? `avg ${mins(avgLate)} late` : "none today"}
            art="/hr/3d/late.png"
            tone="amber"
          />
          <Kpi
            label="Absent"
            value={absent}
            note={notIn ? `${notIn} not due yet` : `${pctOf(absent, enrolled)}% of workforce`}
            art="/hr/3d/absent.png"
            tone="rose"
          />
          <Kpi
            label="On premises"
            value={inside}
            note={`${outNow} out right now`}
            art="/hr/3d/premises.png"
            tone="sky"
          />
          <Kpi
            label="Left early"
            value={leftEarly}
            note={`${mins(lostMin)} lost today`}
            art="/hr/3d/left.png"
            tone="violet"
          />
        </section>

        {/* ── Activity + breakdown ─────────────────────────── */}
        <div className="grid gap-6 xl:grid-cols-3">
          <Panel
            title="Activity today"
            subtitle="Punches per hour, IST"
            accent="violet"
            icon={Activity}
            className="xl:col-span-2"
            action={
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <i className="h-1 w-3 rounded bg-gradient-to-r from-indigo-500 to-pink-500" /> All punches
                </span>
                <span className="flex items-center gap-1.5">
                  <i className="h-0.5 w-3 rounded border-t-2 border-dashed border-emerald-600" /> First in
                </span>
              </div>
            }
          >
            <svg viewBox={`0 0 ${CW} ${CH}`} className="w-full">
              <defs>
                <linearGradient id="act-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#ec4899" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="act-line" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="50%" stopColor="#a855f7" />
                  <stop offset="100%" stopColor="#ec4899" />
                </linearGradient>
              </defs>
              {[0, 1, 2, 3, 4].map((k) => {
                const v = (yTop / 4) * k;
                return (
                  <g key={k}>
                    <line x1={PL} x2={CW - 8} y1={y(v)} y2={y(v)} stroke="currentColor" strokeDasharray={k ? "3 4" : undefined} className="text-slate-200 dark:text-slate-800" />
                    <text x={PL - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10" className="fill-slate-400">
                      {v}
                    </text>
                  </g>
                );
              })}
              {HOURS.map((h, i) =>
                h % 2 === 0 ? (
                  <text key={h} x={x(i)} y={CH - 4} textAnchor="middle" fontSize="10" className="fill-slate-400">
                    {h % 12 || 12}
                    {h < 12 ? "am" : "pm"}
                  </text>
                ) : null,
              )}
              {punchArea && <path d={punchArea} fill="url(#act-fill)" />}
              {punchLine && <path d={punchLine} fill="none" stroke="url(#act-line)" strokeWidth="2.5" strokeLinejoin="round" />}
              {inLine && <path d={inLine} fill="none" stroke={C.emerald} strokeWidth="1.75" strokeDasharray="4 3" strokeLinejoin="round" />}
              {upto > 0 && upto <= HOURS.length && (
                <circle cx={x(upto - 1)} cy={y(allPunches[upto - 1])} r="4" fill="white" stroke="#a855f7" strokeWidth="2.5" />
              )}
            </svg>
          </Panel>

          <Panel title="Today's breakdown" subtitle={`${enrolled} people on the device`} accent="teal" icon={PieChart}>
            <div className="flex flex-col items-center gap-5 sm:flex-row xl:flex-col 2xl:flex-row">
              <Donut
                total={present}
                label="present"
                slices={[
                  { v: onTime, hex: C.emerald },
                  { v: late, hex: C.amber },
                  { v: absent, hex: C.rose },
                  { v: notIn, hex: C.slate },
                ]}
              />
              <ul className="w-full space-y-2.5">
                {[
                  { label: "On time", v: onTime, dot: "bg-emerald-600" },
                  { label: "Late", v: late, dot: "bg-amber-500" },
                  { label: "Absent", v: absent, dot: "bg-rose-600" },
                  { label: "Not due yet", v: notIn, dot: "bg-slate-300 dark:bg-slate-600" },
                ]
                  // "Not due yet" only means something before Punch In + grace
                  // (or before a night shift starts); at 0 it is noise.
                  .filter((r) => r.label !== "Not due yet" || r.v > 0)
                  .map((r) => (
                  <li key={r.label} className="flex items-center gap-2.5 text-sm">
                    <Dot className={r.dot} />
                    <span className="flex-1 text-slate-600 dark:text-slate-300">{r.label}</span>
                    <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{r.v}</span>
                    <span className="w-12 text-right text-xs tabular-nums text-slate-400">{pctOf(r.v, enrolled)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
        </div>

        {/* ── Timing groups — flip cards: today on the front, the shift on the back ── */}
        <div className="grid gap-6 lg:grid-cols-3">
          {groups.map((g) => {
            const n = g.people.length;
            const ot = g.people.filter((d) => isPresent(d) && d.lateMin === 0).length;
            const lt = g.people.filter((d) => isPresent(d) && d.lateMin > 0).length;
            const ab = g.people.filter((d) => d.status === "absent").length;
            const ni = g.people.filter((d) => d.status === "not_in").length;
            const ins = g.people.filter((d) => d.status === "inside").length;
            const seg = [
              { v: ot, cls: "bg-gradient-to-r from-emerald-500 to-teal-400" },
              { v: lt, cls: "bg-gradient-to-r from-amber-400 to-orange-500" },
              { v: ab, cls: "bg-gradient-to-r from-rose-500 to-pink-500" },
              { v: ni, cls: "bg-slate-200 dark:bg-slate-700" },
            ];
            // The next dated revision of this group's hours, if one is scheduled.
            const upcoming = data.timings
              .filter((t) => t.timing_group === g.group && t.effective_from.slice(0, 10) > g.day)
              .sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0];

            const front = (
              <div key="front" className="group/grp flex h-full flex-col bg-white dark:bg-slate-900">
                <div className={cn("relative isolate flex items-start justify-between gap-3 overflow-hidden bg-gradient-to-br px-5 py-4 text-white", GROUP[g.group].band)}>
                  <span aria-hidden className="absolute -right-8 -top-10 -z-10 h-28 w-28 rounded-full bg-white/25 blur-xl transition-transform duration-500 group-hover/grp:scale-150" />
                  <div>
                    <h3 className="text-sm font-semibold">{timingGroupLabel(g.group)}</h3>
                    <p className="mt-1 flex items-center gap-1 text-xs text-white/85">
                      {g.timing ? (
                        <>
                          {fmtTime(g.timing.in_time)} – {fmtTime(g.timing.out_time)}
                          {isOvernight(g.timing) && <Moon className="h-3 w-3" />}
                        </>
                      ) : (
                        "No timing set"
                      )}
                    </p>
                    <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold ring-1 ring-white/25">
                      <RefreshCw className="h-3 w-3" /> Flip for shift
                    </span>
                  </div>
                  <GroupFigure group={g.group} className="-mb-4 ml-auto h-20 shrink-0 drop-shadow-lg transition-transform duration-500 group-hover/grp:-translate-y-1 group-hover/grp:rotate-[-4deg]" />
                  <div className="text-right">
                    <p className="text-[28px] font-semibold leading-none tracking-tight tabular-nums">
                      {pctOf(ot + lt, n)}
                      <span className="text-base text-white/70">%</span>
                    </p>
                    <p className="mt-1 text-xs text-white/80">
                      {ot + lt} of {n} present
                    </p>
                  </div>
                </div>
                <div className="flex flex-1 flex-col justify-center px-5 pb-4 pt-3">
                  <div className="flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    {seg.map((x, i) => (x.v ? <div key={i} className={x.cls} style={{ width: `${(x.v / Math.max(1, n)) * 100}%` }} /> : null))}
                  </div>
                  <dl className="mt-4 grid grid-cols-4 divide-x divide-slate-100 text-center dark:divide-slate-800">
                    {[
                      ["On time", ot, "text-emerald-600 dark:text-emerald-400"],
                      ["Late", lt, "text-orange-600 dark:text-amber-400"],
                      ["Inside", ins, "text-sky-600 dark:text-sky-400"],
                      ["Absent", ab, "text-rose-600 dark:text-rose-400"],
                    ].map(([k, v, cls]) => (
                      <div key={k as string} className="px-1">
                        <dd className={cn("text-lg font-semibold tabular-nums", cls as string)}>{v as number}</dd>
                        <dt className="text-[11px] text-slate-500">{k as string}</dt>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            );

            const back = (
              <div key="back" className={cn("relative isolate flex h-full flex-col overflow-hidden bg-gradient-to-br p-5 text-white", GROUP[g.group].band)}>
                <span aria-hidden className="absolute -bottom-16 -right-10 -z-10 h-48 w-48 rounded-full bg-white/20 blur-2xl" />
                <span aria-hidden className="absolute -left-10 -top-12 -z-10 h-36 w-36 rounded-full bg-black/10 blur-2xl" />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80">{timingGroupLabel(g.group)} · Shift</p>
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold ring-1 ring-white/25">
                    <RefreshCw className="h-3 w-3" /> Flip back
                  </span>
                </div>
                {g.timing ? (
                  <>
                    <p className="mt-3 flex items-center gap-2 text-[26px] font-semibold leading-none tracking-tight tabular-nums">
                      {fmtTime(g.timing.in_time)}
                      <ArrowRight className="h-5 w-5 text-white/70" />
                      {fmtTime(g.timing.out_time)}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-medium">
                      <span className="rounded-md bg-white/20 px-2 py-0.5">{mins(shiftMinutes(g.timing))} day</span>
                      <span className="rounded-md bg-white/20 px-2 py-0.5">{g.timing.grace_minutes} min in-grace</span>
                      {isOvernight(g.timing) && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-white/20 px-2 py-0.5">
                          <Moon className="h-3 w-3" /> Night shift
                        </span>
                      )}
                    </div>
                    <p className="mt-3 text-xs text-white/85">In force since {fmtDate(g.timing.effective_from)}</p>
                  </>
                ) : (
                  <p className="mt-4 text-sm text-white/90">No Punch In / Out set for this group yet, so nobody here is marked late.</p>
                )}
                <div className="mt-auto flex items-end justify-between gap-3 pt-3">
                  <div className="min-w-0 rounded-xl bg-white/15 px-3 py-2 text-xs ring-1 ring-white/20">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-white/70">Next change</p>
                    <p className="mt-0.5 truncate font-semibold">
                      {upcoming ? `From ${fmtDate(upcoming.effective_from)}: ${fmtTime(upcoming.in_time)} – ${fmtTime(upcoming.out_time)}` : "None scheduled"}
                    </p>
                  </div>
                  <Link
                    href="/masters/hr/work-timing"
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 shadow-md transition hover:bg-white/90"
                  >
                    {g.timing ? "Change timing" : "Set timing"} <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            );

            return (
              <FlipCard
                key={g.group}
                front={front}
                back={back}
                ariaLabel={`${timingGroupLabel(g.group)}: flip to see the shift timing`}
                width={2000}
                height={236}
                radius={16}
                background="transparent"
                color="inherit"
                tiltMax={8}
                hoverScale={1.02}
                glareOpacity={0.25}
                shadowColor={GROUP[g.group].hex}
                shadowOpacity={0.35}
                className="w-full"
              />
            );
          })}
        </div>

        {/* ── Week + punctuality ───────────────────────────── */}
        <div className="grid gap-6 xl:grid-cols-3">
          <Panel
            title="Attendance, last 7 days"
            accent="sky"
            icon={CalendarDays}
            subtitle={`Average ${avgWeek} present per day`}
            className="xl:col-span-2"
            action={
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  <i className="h-2.5 w-2.5 rounded-sm bg-gradient-to-t from-indigo-600 to-violet-400" /> On time
                </span>
                <span className="flex items-center gap-1.5">
                  <i className="h-2.5 w-2.5 rounded-sm bg-amber-500" /> Late
                </span>
              </div>
            }
          >
            {week.length ? (
              <div className="flex gap-3">
                <div className="flex h-56 flex-col justify-between pb-6 text-right text-[10px] tabular-nums text-slate-400">
                  {[4, 3, 2, 1, 0].map((k) => (
                    <span key={k}>{(wTop / 4) * k}</span>
                  ))}
                </div>
                <div className="relative flex-1">
                  <div className="absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between">
                    {[0, 1, 2, 3, 4].map((k) => (
                      <div key={k} className={cn("border-t border-slate-200 dark:border-slate-800", k < 4 && "border-dashed")} />
                    ))}
                  </div>
                  <div className="relative grid h-56 grid-cols-7 gap-4">
                    {week.map((w, i) => {
                      const today = i === week.length - 1;
                      const ok = Math.max(0, w.present - w.late);
                      return (
                        <div key={w.day} className="group flex flex-col items-center" title={`${w.present} present · ${w.late} late of ${w.enrolled}`}>
                          <div className="relative flex w-full flex-1 flex-col items-center justify-end pb-0">
                            <span className="mb-1 text-[11px] font-semibold tabular-nums text-slate-700 opacity-0 transition group-hover:opacity-100 dark:text-slate-200">
                              {w.present}
                            </span>
                            <div className="flex w-full max-w-9 flex-col overflow-hidden rounded-t-[4px]" style={{ height: `${(w.present / wTop) * 100}%` }}>
                              <div className="bg-gradient-to-b from-amber-300 to-orange-500" style={{ height: `${(w.late / Math.max(1, w.present)) * 100}%` }} />
                              <div className={cn("flex-1 bg-gradient-to-t", today ? "from-fuchsia-600 to-pink-400" : "from-indigo-600 to-violet-400")} style={{ minHeight: ok ? 1 : 0 }} />
                            </div>
                          </div>
                          <div className="h-6 pt-1.5 text-center text-[11px] leading-none">
                            <span className={cn(today ? "font-semibold text-slate-900 dark:text-white" : "text-slate-500")}>
                              {today ? "Today" : `${w.weekday} ${w.dd}`}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <Empty>The trend appears once punches are recorded.</Empty>
            )}
          </Panel>

          <Panel title="Punctuality" subtitle="Share of present staff who arrived on time" accent="orange" icon={Gauge2}>
            <div className="flex items-end gap-2">
              <HurryScene className="hidden h-24 shrink-0 sm:block xl:hidden 2xl:block" />
              <div className="flex-1">
                <Gauge pct={punctuality} />
              </div>
            </div>
            <dl className="mt-5 grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 pt-4 text-center dark:divide-slate-800 dark:border-slate-800">
              <div>
                <dd className="text-base font-semibold tabular-nums text-slate-900 dark:text-white">{mins(avgLate)}</dd>
                <dt className="text-[11px] text-slate-500">Avg late</dt>
              </div>
              <div>
                <dd className="text-base font-semibold tabular-nums text-slate-900 dark:text-white">{mins(lostMin)}</dd>
                <dt className="text-[11px] text-slate-500">Time lost</dt>
              </div>
              <div>
                <dd className="text-base font-semibold tabular-nums text-slate-900 dark:text-white">{trips}</dd>
                <dt className="text-[11px] text-slate-500">Trips out</dt>
              </div>
            </dl>
          </Panel>
        </div>

        {/* ── Exceptions ───────────────────────────────────── */}
        <div className="grid gap-6 xl:grid-cols-3">
          {[
            {
              title: "Late arrivals",
              accent: "amber" as const,
              icon: AlarmClock,
              head2: "bg-amber-50/90 dark:bg-amber-500/10",
              rowHover: "hover:bg-amber-50/70 dark:hover:bg-amber-500/10",
              rows: lateList,
              empty: "No late arrivals today.",
              art: <CelebrateScene className="h-28" />,
              head: ["Arrived", "Late by"],
              cells: (d: PersonDay) => [clock(d.firstAt!), <span key="v" className="font-semibold text-amber-600 dark:text-amber-400">+{mins(d.lateMin)}</span>],
            },
            {
              title: "Out of premises",
              accent: "cyan" as const,
              icon: DoorOpen,
              head2: "bg-cyan-50/90 dark:bg-cyan-500/10",
              rowHover: "hover:bg-cyan-50/70 dark:hover:bg-cyan-500/10",
              rows: outList,
              empty: "Everyone who came in is on the premises.",
              art: <WorkingScene className="h-28" shirt="#06b6d4" />,
              head: ["Since", "Away"],
              cells: (d: PersonDay) => [clock(d.lastAt!), <span key="v" className="font-semibold text-sky-600 dark:text-sky-400">{mins(Math.round((now - d.lastAt!) / 60_000))}</span>],
            },
            {
              title: "Early departures",
              accent: "rose" as const,
              icon: LogOut,
              head2: "bg-rose-50/90 dark:bg-rose-500/10",
              rowHover: "hover:bg-rose-50/70 dark:hover:bg-rose-500/10",
              rows: earlyList,
              empty: "No early departures today.",
              art: <WorkingScene className="h-28" shirt="#f43f5e" />,
              head: ["Left", "Early by"],
              cells: (d: PersonDay) => [clock(d.lastAt!), <span key="v" className="font-semibold text-rose-600 dark:text-rose-400">−{mins(d.earlyMin)}</span>],
            },
          ].map((t) => (
            <Panel
              key={t.title}
              title={t.title}
              accent={t.accent}
              icon={t.icon}
              bodyClass="p-0"
              action={<span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t.rows.length}</span>}
            >
              {t.rows.length ? (
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full">
                    <thead className={cn("sticky top-0 backdrop-blur", t.head2)}>
                      <tr>
                        <th className={TH}>Employee</th>
                        <th className={cn(TH, "text-right")}>{t.head[0]}</th>
                        <th className={cn(TH, "text-right")}>{t.head[1]}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {t.rows.map((d) => {
                        const [a, b] = t.cells(d);
                        return (
                          <tr key={d.person.bio} className={cn("transition-colors", t.rowHover)}>
                            <td className={TD}>
                              <p className="truncate font-medium text-slate-900 dark:text-slate-100">{d.person.name}</p>
                              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                                <Dot className={GROUP[d.person.group].dot} />
                                {timingGroupLabel(d.person.group)}
                                {d.person.code ? ` · ${d.person.code}` : ""}
                              </p>
                            </td>
                            <td className={cn(TD, "text-right tabular-nums text-slate-600 dark:text-slate-300")}>{a}</td>
                            <td className={cn(TD, "text-right tabular-nums")}>{b}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty art={t.art}>{t.empty}</Empty>
              )}
            </Panel>
          ))}
        </div>

        {/* ── Activity log + devices ───────────────────────── */}
        <div className="grid gap-6 xl:grid-cols-3">
          <Panel
            title="Activity log"
            subtitle="Latest punches, labelled by their place in each person's day"
            accent="fuchsia"
            icon={Fingerprint}
            className="xl:col-span-2"
            bodyClass="p-0"
            action={
              <Link href="/hr/attendance?view=live" className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400">
                View all <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            }
          >
            {data.feed.length ? (
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0 bg-fuchsia-50/90 backdrop-blur dark:bg-fuchsia-500/10">
                    <tr>
                      <th className={TH}>Time</th>
                      <th className={TH}>Employee</th>
                      <th className={TH}>Group</th>
                      <th className={cn(TH, "text-right")}>Event</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {data.feed.map((p, i) => (
                      <tr key={`${p.bio}-${p.at}-${i}`} className="transition-colors hover:bg-fuchsia-50/70 dark:hover:bg-fuchsia-500/10">
                        <td className={cn(TD, "w-24 tabular-nums text-slate-500")}>{clock(p.at)}</td>
                        <td className={cn(TD, "font-medium text-slate-900 dark:text-slate-100")}>{p.name ?? `ID ${p.bio}`}</td>
                        <td className={TD}>{p.group ? <GroupChip group={p.group} /> : "—"}</td>
                        <td className={cn(TD, "text-right")}>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                              p.label === "In" && "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300",
                              p.label === "Out" && "bg-slate-50 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300",
                              p.label === "Back" && "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300",
                            )}
                          >
                            <Dot className={p.label === "In" ? "bg-emerald-600" : p.label === "Out" ? "bg-slate-500" : "bg-sky-600"} />
                            {p.label === "In" ? "Check in" : p.label === "Out" ? "Check out" : "Returned"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty art={<WaitingScene className="h-28" />}>No punches recorded yet today.</Empty>
            )}
          </Panel>

          <Panel
            title="Devices"
            subtitle={`${online.length} of ${data.devices.length} online`}
            accent="emerald"
            icon={Wifi}
            bodyClass="p-0"
          >
            <RadarPanel healthy={allOnline} blips={recentPunches} />
            {data.devices.length ? (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.devices.map((d) => {
                  const on = !!d.last_seen && now - Date.parse(d.last_seen) <= ONLINE_WINDOW_MS;
                  return (
                    <li key={d.serial_no} className="flex items-center gap-3 px-5 py-3.5">
                      <span
                        className={cn(
                          "grid h-9 w-9 place-items-center rounded-lg",
                          on ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10" : "bg-rose-50 text-rose-600 dark:bg-rose-500/10",
                        )}
                      >
                        {on ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">{d.name ?? d.serial_no}</span>
                        <span className="block truncate text-xs text-slate-500">
                          {d.serial_no} · {d.last_seen ? `seen ${clock(Date.parse(d.last_seen))}` : "never connected"}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                          on
                            ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300"
                            : "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300",
                        )}
                      >
                        <Dot className={on ? "bg-emerald-600" : "bg-rose-600"} />
                        {on ? "Online" : "Offline"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty>No device has connected yet.</Empty>
            )}
          </Panel>
        </div>

        <p className="text-center text-xs text-slate-400">Refreshes every minute · all times IST · {gone} gone home for the day</p>
      </div>
    </div>
  );
}
