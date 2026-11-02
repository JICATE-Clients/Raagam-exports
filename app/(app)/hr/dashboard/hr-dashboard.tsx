import Image from "next/image";
import Link from "next/link";
import {
  AlarmClock,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BellRing,
  Briefcase,
  Building2,
  CalendarCheck,
  CalendarDays,
  Cake,
  ClipboardCheck,
  Clock,
  DoorOpen,
  FileWarning,
  Fingerprint,
  Gavel,
  Inbox,
  LogOut,
  MailWarning,
  Moon,
  PartyPopper,
  PieChart,
  Plane,
  Radio,
  TriangleAlert,
  UserCheck,
  UserPlus,
  UserRoundSearch,
  Users,
  UserX,
  Wallet,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { AutoRefresh } from "@/components/hr/auto-refresh";
import { RadarPanel } from "@/components/hr/radar-panel";
import { TeamScene, WaitingScene } from "@/components/hr/people-art";
import { kindLabel, isOvernight, shiftMinutes, type PersonKind } from "@/lib/masters/category-timing-types";
import {
  ABSENT_RUN,
  LATE_PATTERN,
  type AttentionPerson,
  type HrDashboard,
} from "@/lib/hr/dashboard-service";
import type { DayStatus, GroupDay, PersonDay } from "@/lib/hr/timing-calc";
import { fmtDate, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DashboardPeople, type PeopleKey, type PeopleRow } from "@/components/hr/dashboard-people";
import { Truncated } from "@/components/ui/truncated";

/*
 * HR ▸ Dashboard — re-laid 2026-11-02 into a full workforce dashboard (user:
 * "an actual dashboard with all the dashboard features commonly used"), in
 * the colourful look of 2026-10-28 (user, same day: "look like before but
 * with the enhanced adding") — every panel its own colour, 3D icons on the
 * tiles. Status colours (on time, late, absent, away) always sit beside
 * their word, never colour alone.
 *
 * Top to bottom: greeting, ten KPI cards (with the change on yesterday
 * where it helps), the week's
 * attendance, today's breakdown, what needs HR to act, approvals waiting, by
 * department, who is away, celebrations, workforce mix, open HR work, shift
 * hours, the people behind every number, the punch feed and the devices.
 *
 * Server-rendered throughout (SVG / CSS charts, hover tooltips in CSS); the
 * only client code is the one-minute refresh and the People table.
 */

const ONLINE_WINDOW_MS = 2 * 60_000;
const DAY_MS = 86_400_000;
const PRESENT: DayStatus[] = ["inside", "stepped_out", "left", "left_early"];
const isPresent = (d: PersonDay) => PRESENT.includes(d.status);

/* Status colours — checked with the dataviz validator (light surface); every
   use sits beside its label, a legend, or a gap. */
const S = {
  ontime: { hex: "#059669", bg: "bg-emerald-600", soft: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300" },
  late: { hex: "#d97706", bg: "bg-amber-600", soft: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300" },
  absent: { hex: "#e11d48", bg: "bg-rose-600", soft: "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300" },
  leave: { hex: "#0284c7", bg: "bg-sky-600", soft: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300" },
  duty: { hex: "#7c3aed", bg: "bg-violet-600", soft: "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-500/10 dark:text-violet-300" },
  idle: { hex: "#cbd5e1", bg: "bg-slate-300 dark:bg-slate-600", soft: "bg-slate-50 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300" },
} as const;

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
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
/** YYYY-MM-DD in IST. */
function istIso(ms: number): string {
  return new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
}
const isoMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
/** Days from `today` to the next time `iso`'s month-day comes round (0 = today). */
function daysToNext(today: string, iso: string): { days: number; year: number } {
  const base = isoMs(today);
  let year = Number(today.slice(0, 4));
  const at = (y: number) => {
    const t = Date.parse(`${y}-${iso.slice(5, 10)}T00:00:00Z`);
    return Number.isNaN(t) ? Date.parse(`${y}-03-01T00:00:00Z`) : t; // 29 Feb in a common year
  };
  let t = at(year);
  if (t < base) t = at(++year);
  return { days: Math.round((t - base) / DAY_MS), year };
}
function whenLabel(days: number): string {
  return days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`;
}
function initials(name: string): string {
  return name
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/* ------------------------------------------------------------------ *
 * Building blocks
 * ------------------------------------------------------------------ */

// Staff and Worker (0774) — hours are per Employee Category now, so the
// dashboard splits people by which master they live in.
const GROUP: Record<PersonKind, { hex: string; dot: string; chip: string; band: string; shadow: string }> = {
  staff: { hex: "#4f46e5", shadow: "shadow-indigo-500/20 hover:shadow-indigo-500/30", band: "from-indigo-500 to-violet-600", dot: "bg-sky-400", chip: "bg-indigo-50 text-indigo-700 ring-indigo-600/15 dark:bg-indigo-500/10 dark:text-indigo-300" },
  worker: { hex: "#0d9488", shadow: "shadow-emerald-500/20 hover:shadow-emerald-500/30", band: "from-emerald-500 to-teal-600", dot: "bg-emerald-400", chip: "bg-teal-50 text-teal-700 ring-teal-600/15 dark:bg-teal-500/10 dark:text-teal-300" },
};
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

const LINK = "inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400";

function ViewAll({ href, children = "View all" }: { href: string; children?: React.ReactNode }) {
  return (
    <Link href={href} className={LINK}>
      {children} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400">{children}</p>;
}

function Dot({ className }: { className: string }) {
  return <i aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", className)} />;
}

function GroupChip({ group }: { group: PersonKind }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", GROUP[group].chip)}>
      {kindLabel(group)}
    </span>
  );
}

function Pill({ tone, children }: { tone: keyof typeof S; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", S[tone].soft)}>
      <Dot className={S[tone].bg} />
      {children}
    </span>
  );
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

function Empty({ icon: Icon = Inbox, art, children }: { icon?: LucideIcon; art?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-28 flex-col items-center justify-center gap-2 py-4 text-center">
      {art ?? <Icon className="h-6 w-6 text-slate-300 dark:text-slate-600" aria-hidden />}
      <p className="text-sm text-slate-500 dark:text-slate-400">{children}</p>
    </div>
  );
}

/** Change on yesterday: arrow + number, green when the move is good. */
function Delta({ today, yesterday, goodWhen, unit = "" }: { today: number; yesterday?: number; goodWhen: "up" | "down"; unit?: string }) {
  if (yesterday == null) return <span className="text-xs text-slate-400">no data for yesterday</span>;
  const diff = Math.round((today - yesterday) * 10) / 10;
  if (diff === 0) return <span className="text-xs text-slate-500">same as yesterday</span>;
  const good = goodWhen === "up" ? diff > 0 : diff < 0;
  const Arrow = diff > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 rounded px-1 font-semibold tabular-nums",
          good ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
        )}
      >
        <Arrow className="h-3 w-3" aria-hidden />
        {Math.abs(diff)}
        {unit}
      </span>
      <span className="text-slate-500">vs yesterday</span>
    </span>
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
  href,
}: {
  /** Opens this card's people in the People panel below. */
  href?: string;
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
  const Box = href ? Link : "div";
  return (
    <Box
      href={href as string}
      className={cn("group/kpi relative isolate flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-gradient-to-br to-white px-5 py-4 shadow-lg transition duration-300 hover:-translate-y-1.5 hover:scale-[1.02] hover:shadow-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:to-slate-900", t.card)}
    >
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
      <div className={cn("mb-3 mt-2 text-xs font-medium", t.text)}>{note}</div>
      {bar != null && (
        <div className="mt-auto h-1.5 overflow-hidden rounded-full bg-white/70 ring-1 ring-slate-200/60 dark:bg-slate-800 dark:ring-0">
          <div className={cn("h-full rounded-full bg-gradient-to-r", t.bar)} style={{ width: `${Math.min(100, bar)}%` }} />
        </div>
      )}
    </Box>
  );
}

/* Donut with a centred figure; 2px gaps between slices. */
function Donut({ slices, total, label }: { slices: { v: number; hex: string }[]; total: string | number; label: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const sum = slices.reduce((t, s) => t + s.v, 0);
  return (
    <div className="relative h-[140px] w-[140px] shrink-0">
      <svg viewBox="0 0 132 132" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="66" cy="66" r={r} fill="none" stroke="currentColor" strokeWidth="12" className="text-slate-100 dark:text-slate-800" />
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
                strokeWidth="12"
                strokeDasharray={`${Math.max(0, len - 2)} ${c}`}
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

/** A labelled horizontal bar — one hue, value as text beside it. */
function BarRow({ label, value, max, note, className }: { label: string; value: number; max: number; note?: string; className?: string }) {
  return (
    <li className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 text-xs">
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <span className={cn("block h-full rounded-full", className ?? "bg-indigo-500")} style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
      </span>
      <span className="w-14 text-right font-semibold tabular-nums text-slate-900 dark:text-white">
        {value}
        {note && <span className="ml-1 font-normal text-slate-400">{note}</span>}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * Needs attention (2026-11-02) — patterns across the week that call for
 * HR to DO something, each line with the thing to do.
 * ------------------------------------------------------------------ */

const SHOW_PEOPLE = 4;

function AttnAction({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-1 rounded-control px-2 py-1 text-xs font-semibold text-indigo-600 ring-1 ring-inset ring-indigo-200 transition hover:bg-indigo-50 dark:text-indigo-300 dark:ring-indigo-500/30 dark:hover:bg-indigo-500/10"
    >
      {children}
    </Link>
  );
}

function AttnPerson({ p, metric, action }: { p: AttentionPerson; metric: string; action?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <Avatar name={p.name} className="h-7 w-7 text-[10px]" />
      <span className="min-w-0 flex-1">
        <Truncated text={p.name} className="block text-sm font-medium text-slate-900 dark:text-slate-100" />
        <Truncated text={[p.code, p.departmentName ?? "No department"].filter(Boolean).join(" · ")} className="block text-xs text-slate-500" />
      </span>
      <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300">{metric}</span>
      {action}
    </li>
  );
}

function AttnGroup({
  icon: Icon,
  tone,
  title,
  hint,
  people,
  render,
}: {
  icon: LucideIcon;
  tone: "late" | "absent" | "duty";
  title: string;
  hint: string;
  people: AttentionPerson[];
  render: (p: AttentionPerson) => React.ReactNode;
}) {
  if (!people.length) return null;
  const first = people.slice(0, SHOW_PEOPLE);
  const rest = people.slice(SHOW_PEOPLE);
  return (
    <div className="rounded-xl border border-slate-200/80 p-3 dark:border-slate-800">
      <div className="flex items-center gap-2.5">
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg ring-1 ring-inset", S[tone].soft)}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</span>
          <span className="block text-[11px] text-slate-500">{hint}</span>
        </span>
        <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-bold tabular-nums text-white dark:bg-white dark:text-slate-900">{people.length}</span>
      </div>
      <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">{first.map(render)}</ul>
      {rest.length > 0 && (
        <details className="group/more">
          <summary className="cursor-pointer list-none pt-1.5 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-300">
            <span className="group-open/more:hidden">+{rest.length} more</span>
            <span className="hidden group-open/more:inline">Show fewer</span>
          </summary>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">{rest.map(render)}</ul>
        </details>
      )}
    </div>
  );
}

function NeedsAttention({ attention: a, now, className }: { attention: HrDashboard["attention"]; now: number; className?: string }) {
  const memo = (p: AttentionPerson, type: string) =>
    p.key ? <AttnAction href={`/hr/conduct/memos?new=1&person=${encodeURIComponent(p.key)}&type=${type}`}>Memo</AttnAction> : undefined;
  const total = a.late.length + a.absent.length + a.missedOut.length + a.silentDevices.length;
  const yesterday = new Intl.DateTimeFormat("en-IN", { weekday: "long", timeZone: "UTC" }).format(isoMs(a.missedOutDay));
  return (
    <Panel accent="rose"
      title="Needs attention"
      subtitle="Patterns across the last 7 days, with what to do about each"
      icon={BellRing}
      className={className}
      action={total > 0 ? <span className="rounded-full bg-rose-600 px-2.5 py-0.5 text-xs font-bold tabular-nums text-white">{total}</span> : undefined}
    >
      {total === 0 ? (
        <Empty icon={BadgeCheck}>Nothing needs attention — no repeated late-coming, no absence runs, every punch closed.</Empty>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <AttnGroup
            icon={AlarmClock}
            tone="late"
            title={`Late ${LATE_PATTERN}+ times this week`}
            hint="A habit, not a bad morning"
            people={a.late}
            render={(p) => <AttnPerson key={p.bio} p={p} metric={`${p.count}× · ${mins(p.detail)}`} action={memo(p, "late_coming")} />}
          />
          <AttnGroup
            icon={UserX}
            tone="absent"
            title={`Absent ${ABSENT_RUN}+ days running`}
            hint="No punch, no approved leave or on duty"
            people={a.absent}
            render={(p) => <AttnPerson key={p.bio} p={p} metric={`${p.count} days`} action={memo(p, "absence")} />}
          />
          <AttnGroup
            icon={DoorOpen}
            tone="duty"
            title={`In but no Out — ${yesterday}`}
            hint="Correct the day before payroll reads it"
            people={a.missedOut}
            render={(p) => (
              <AttnPerson
                key={p.bio}
                p={p}
                metric={`In ${clock(p.detail)}`}
                action={<AttnAction href={`/hr/attendance?view=day&date=${a.missedOutDay}`}>Fix</AttnAction>}
              />
            )}
          />
          {a.silentDevices.length > 0 && (
            <div className="rounded-xl border border-slate-200/80 p-3 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg ring-1 ring-inset", S.idle.soft)}>
                  <WifiOff className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">Device not sending</span>
                  <Truncated
                    className="block text-[11px] text-slate-500"
                    text={a.silentDevices
                      .map((d) => `${d.name ?? d.serial_no} · last ${mins(Math.round((now - Date.parse(d.last_seen as string)) / 60_000))} ago`)
                      .join(" · ")}
                  />
                </span>
                <AttnAction href="/hr/attendance?view=live">Check</AttnAction>
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export function HrDashboardView({
  data,
  filter,
  weekNote,
  query = "",
}: {
  data: HrDashboard;
  /** The Staff | Worker switch and department filter, under the header. */
  filter?: React.ReactNode;
  /** Said under the week chart when it can't follow the filter. */
  weekNote?: string;
  /** The dashboard filter's query (kind, dept), kept on a tile's link. */
  query?: string;
}) {
  const { groups, now } = data;
  const today = istIso(now);
  const all = groups.flatMap((g) => g.people);
  const enrolled = all.length;
  const present = count(groups, isPresent);
  const late = count(groups, (d) => isPresent(d) && d.lateMin > 0);
  const onTime = present - late;
  // Approved Time Off today (0770). Someone on Leave or On Duty who hasn't
  // punched is counted there, not as Absent; Permission is short time off and
  // doesn't excuse the day.
  const offOf = new Map(data.timeOff.map((t) => [t.bio, t.kind]));
  const onLeave = data.timeOff.filter((t) => t.kind === "leave").length;
  const onDuty = data.timeOff.filter((t) => t.kind === "on_duty").length;
  const onPermission = data.timeOff.filter((t) => t.kind === "permission").length;
  const excused = (d: PersonDay) => {
    const k = offOf.get(d.person.bio);
    return k === "leave" || k === "on_duty";
  };
  const absent = count(groups, (d) => d.status === "absent" && !excused(d));
  const notIn = count(groups, (d) => d.status === "not_in");
  const inside = count(groups, (d) => d.status === "inside");
  const outNow = count(groups, (d) => d.status === "stepped_out");
  const gone = count(groups, (d) => d.status === "left");
  const leftEarly = count(groups, (d) => d.status === "left_early");
  const trips = all.reduce((t, d) => t + d.movements.length, 0);
  const lateMinutes = all.reduce((t, d) => t + d.lateMin, 0);
  const avgLate = late ? Math.round(lateMinutes / late) : 0;
  const onTimeRate = pctOf(onTime, present);

  // The week, day by day — the SQL trend, with today replaced by the live
  // figures so the last bar and the tiles above it can never disagree.
  const byDay = new Map<string, { present: number; late: number; enrolled: number }>();
  for (const t of data.trend) {
    const o = byDay.get(t.day) ?? { present: 0, late: 0, enrolled: 0 };
    o.present += t.present;
    o.late += t.late;
    o.enrolled += t.enrolled;
    byDay.set(t.day, o);
  }
  byDay.set(today, { present, late, enrolled });
  const week = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-7)
    .map(([day, v]) => ({
      day,
      ...v,
      away: Math.max(0, v.enrolled - v.present),
      weekday: new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "UTC" }).format(isoMs(day)),
      dd: day.slice(8, 10),
    }));
  const prev = week.length > 1 ? week[week.length - 2] : undefined;
  const wTop = Math.max(4, Math.ceil(Math.max(...week.map((w) => w.enrolled), 1) / 4) * 4);
  const avgWeek = week.length ? Math.round(week.reduce((t, w) => t + w.present, 0) / week.length) : 0;
  const weekRate = week.reduce((t, w) => t + w.enrolled, 0) ? pctOf(week.reduce((t, w) => t + w.present, 0), week.reduce((t, w) => t + w.enrolled, 0)) : 0;

  // Every person once, tagged with each tile they count under — the People
  // table lists them by the same tests the tiles count with.
  const offType = new Map(data.timeOff.map((t) => [t.bio, t.type]));
  const peopleRows: PeopleRow[] = all.map((d) => {
    const off = offOf.get(d.person.bio);
    const tags: PeopleKey[] = ["onroll"];
    if (isPresent(d)) tags.push("present", d.lateMin > 0 ? "late" : "ontime");
    if (off === "leave") tags.push("leave");
    if (off === "on_duty") tags.push("onduty");
    if (off === "permission") tags.push("permission");
    if (d.status === "absent" && !excused(d)) tags.push("absent");
    if (d.status === "left_early") tags.push("early");
    if (d.status === "inside") tags.push("premises");
    if (d.status === "stepped_out") tags.push("out");
    return {
      bio: d.person.bio,
      name: d.person.name,
      code: d.person.code,
      category: d.person.categoryName,
      deptId: d.person.departmentId ?? "",
      dept: d.person.departmentName ?? "No department",
      in: tags,
      firstAt: d.firstAt,
      lastAt: d.lastAt,
      lateMin: d.lateMin,
      earlyMin: d.earlyMin,
      offType: off ? (offType.get(d.person.bio) ?? null) : null,
    };
  });
  const show = (key: PeopleKey) => `?${query ? `${query}&` : ""}show=${key}#people`;

  // By department — today, the people on the reader.
  const deptMap = new Map<string, { name: string; onroll: number; ontime: number; late: number }>();
  for (const d of all) {
    const id = d.person.departmentId ?? "";
    const o = deptMap.get(id) ?? { name: d.person.departmentName ?? "No department", onroll: 0, ontime: 0, late: 0 };
    o.onroll++;
    if (isPresent(d)) {
      if (d.lateMin > 0) o.late++;
      else o.ontime++;
    }
    deptMap.set(id, o);
  }
  const depts = [...deptMap.values()].sort((a, b) => b.onroll - a.onroll || a.name.localeCompare(b.name));

  // Who is away today.
  const nameOf = new Map(all.map((d) => [d.person.bio, d.person]));
  const away = data.timeOff
    .map((t) => ({ ...t, person: nameOf.get(t.bio) }))
    .filter((t) => t.person)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.person!.name.localeCompare(b.person!.name));

  // Celebrations — the next 7 days, and who joined in the last 30.
  const roster = data.roster;
  const birthdays = roster
    .filter((p) => p.dob)
    .map((p) => ({ p, ...daysToNext(today, p.dob!) }))
    .filter((x) => x.days <= 6)
    .sort((a, b) => a.days - b.days || a.p.name.localeCompare(b.p.name));
  const anniversaries = roster
    .filter((p) => p.joined && p.joined < today)
    .map((p) => {
      const n = daysToNext(today, p.joined!);
      return { p, ...n, years: n.year - Number(p.joined!.slice(0, 4)) };
    })
    .filter((x) => x.days <= 6 && x.years >= 1)
    .sort((a, b) => a.days - b.days || a.p.name.localeCompare(b.p.name));
  const joiners = roster
    .filter((p) => p.joined && p.joined <= today && isoMs(today) - isoMs(p.joined) <= 30 * DAY_MS)
    .sort((a, b) => b.joined!.localeCompare(a.joined!));
  const celebrations = [
    ...birthdays.map((x) => ({ key: `b-${x.p.key}`, p: x.p, days: x.days, what: "Birthday", icon: Cake })),
    ...anniversaries.map((x) => ({
      key: `a-${x.p.key}`,
      p: x.p,
      days: x.days,
      what: `${x.years} ${x.years === 1 ? "year" : "years"} with us`,
      icon: PartyPopper,
    })),
  ].sort((a, b) => a.days - b.days || a.p.name.localeCompare(b.p.name));

  // Workforce mix — everyone active in view, on the reader or not.
  const years = (iso: string | null) => (iso ? (isoMs(today) - isoMs(iso)) / (365.25 * DAY_MS) : null);
  const gender = { male: 0, female: 0, other: 0 };
  for (const p of roster) {
    const g = (p.gender ?? "").trim().toLowerCase();
    if (g.startsWith("m")) gender.male++;
    else if (g.startsWith("f")) gender.female++;
    else gender.other++;
  }
  const bucket = (vals: (number | null)[], edges: { label: string; upTo: number }[]) =>
    edges.map((e, i) => ({
      label: e.label,
      n: vals.filter((v) => v != null && v >= (i ? edges[i - 1].upTo : -Infinity) && v < e.upTo).length,
    }));
  const tenure = bucket(roster.map((p) => years(p.joined)), [
    { label: "< 1 year", upTo: 1 },
    { label: "1–3 years", upTo: 3 },
    { label: "3–5 years", upTo: 5 },
    { label: "5–10 years", upTo: 10 },
    { label: "10+ years", upTo: Infinity },
  ]);
  const ages = bucket(roster.map((p) => years(p.dob)), [
    { label: "Under 25", upTo: 25 },
    { label: "25–34", upTo: 35 },
    { label: "35–44", upTo: 45 },
    { label: "45–54", upTo: 55 },
    { label: "55+", upTo: Infinity },
  ]);
  const avgTenure = (() => {
    const v = roster.map((p) => years(p.joined)).filter((x): x is number => x != null);
    return v.length ? (v.reduce((t, x) => t + x, 0) / v.length).toFixed(1) : "—";
  })();

  const online = data.devices.filter((d) => d.last_seen && now - Date.parse(d.last_seen) <= ONLINE_WINDOW_MS);
  const allOnline = data.devices.length > 0 && online.length === data.devices.length;
  // Radar blips = punches in the last 15 minutes (the sweep caps them at 16).
  const recentPunches = all.reduce((t, d) => t + d.punches.filter((p) => p >= now - 15 * 60_000).length, 0);
  // Categories people are in that have no hours today — nobody there is judged.
  const missingTimings = groups.flatMap((g) => g.shifts).filter((x) => x.categoryId && !x.timing);
  const shifts = groups.flatMap((g) => g.shifts.map((x) => ({ ...x, group: g.group })));
  const side: PersonKind = groups[0]?.group ?? "staff";

  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateLine = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);

  const ACTIONS: { label: string; href: string; icon: LucideIcon; badge?: number }[] = [
    { label: "Attendance", href: "/hr/attendance", icon: CalendarCheck },
    { label: "Leave approvals", href: "/hr/time-off/approvals", icon: ClipboardCheck, badge: data.pendingTimeOff.length },
    { label: side === "worker" ? "Add worker" : "Add staff", href: side === "worker" ? "/hr/workers?new=1" : "/hr/staff?new=1", icon: UserPlus },
    { label: "Issue memo", href: "/hr/conduct/memos?new=1", icon: MailWarning },
    { label: "Payroll", href: "/hr/payroll", icon: Wallet },
    { label: "Leave calendar", href: "/hr/time-off/calendar", icon: CalendarDays },
  ];

  const PIPELINE: { label: string; n: number; href: string; icon: LucideIcon }[] = [
    { label: "Open jobs", n: data.pipeline.openJobs, href: "/hr/recruitment/jobs", icon: Briefcase },
    { label: "Candidates in process", n: data.pipeline.candidates, href: "/hr/recruitment/candidates", icon: UserRoundSearch },
    { label: "Joining in progress", n: data.pipeline.joining, href: "/hr/team/joining", icon: UserCheck },
    { label: "Exits open", n: data.pipeline.exits, href: "/hr/team/exits", icon: LogOut },
    { label: "Open memos", n: data.pipeline.memos, href: "/hr/conduct/memos", icon: FileWarning },
    { label: "Disciplinary cases", n: data.pipeline.cases, href: "/hr/conduct/cases", icon: Gavel },
  ];

  const TH = "px-5 py-2 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400";
  const TD = "px-5 py-2.5 text-sm";

  return (
    /*
     * FULL BLEED: `<main>` pads its child by p-4 (md:pb-6) with `w-full`; the
     * negative margins and widened width cancel that. `shrink-0` is what lets
     * it scroll: `<main>` is a scrolling flex column.
     */
    <div className="-mx-4 -mt-4 min-h-[calc(100%+2rem)] shrink-0 bg-gradient-to-br from-indigo-50 via-slate-50 to-fuchsia-50 px-4 pb-8 pt-5 text-slate-700 !w-[calc(100%+2rem)] md:-mb-6 md:min-h-[calc(100%+2.5rem)] md:px-8 md:pt-7 dark:bg-slate-950 dark:text-slate-300">
      <AutoRefresh seconds={60} />
      <div className="mx-auto max-w-[1440px] space-y-6">
        {/* ── Header ───────────────────────────────────────── */}
        <header className="relative isolate flex flex-wrap items-end justify-between gap-4 overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-6 py-6 text-white shadow-lg shadow-indigo-500/20">
          <div aria-hidden className="absolute -right-16 -top-20 -z-10 h-56 w-56 rounded-full bg-white/15 blur-2xl" />
          <div aria-hidden className="absolute -bottom-24 left-1/3 -z-10 h-56 w-56 rounded-full bg-cyan-300/25 blur-3xl" />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/75">HR &amp; Payroll</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">{greeting} 👋</h1>
            <p className="mt-1 text-sm text-white/80">
              {dateLine} · <b className="font-semibold text-white">{present}</b> of {enrolled} in today
              {data.waitingOnMe > 0 && (
                <>
                  {" · "}
                  <Link href="/approvals" className="font-semibold text-white underline underline-offset-2">
                    {data.waitingOnMe} approval{data.waitingOnMe === 1 ? "" : "s"} waiting on you
                  </Link>
                </>
              )}
            </p>
          </div>
          <TeamScene className="hidden h-28 shrink-0 drop-shadow-xl transition-transform duration-500 hover:-translate-y-1 lg:block" />
          <div className="flex flex-wrap items-center gap-2">
            {groups.map((g) => (
              <span key={g.group} className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-3 py-1.5 text-xs ring-1 ring-white/20 backdrop-blur">
                <Dot className={GROUP[g.group].dot} />
                {kindLabel(g.group)}
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
              <Radio className="h-3.5 w-3.5" aria-hidden /> Live monitor <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        </header>

        {filter}

        {(missingTimings.length > 0 || data.noCategory > 0 || data.unlinkedIds > 0) && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/5 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            <ul className="min-w-0 flex-1 space-y-0.5">
              {missingTimings.length > 0 && (
                <li>
                  No Punch In / Out set for {missingTimings.map((x) => x.name).join(", ")}, so nobody there is marked late.{" "}
                  <Link href="/masters/hr/work-timing" className="font-semibold underline underline-offset-2">
                    Set Work Timing
                  </Link>
                </li>
              )}
              {data.noCategory > 0 && (
                <li>
                  {data.noCategory} enrolled {data.noCategory === 1 ? "person has" : "people have"} no Employee Category, so no timing
                  applies. Set it on their Staff or Worker record.
                </li>
              )}
              {data.unlinkedIds > 0 && (
                <li>
                  {data.unlinkedIds} device {data.unlinkedIds === 1 ? "ID" : "IDs"} punched today but {data.unlinkedIds === 1 ? "is" : "are"} not
                  linked to any active staff or worker.
                </li>
              )}
            </ul>
          </div>
        )}

        {/* ── KPI cards ────────────────────────────────────── */}
        {/* The day's head-count first (user 2026-10-31: "on roll, present,
            leave, on duty, permission, absent", then late and left early),
            then the rest. One grid, every cell the same size: equal columns,
            and `auto-rows-fr` makes every row as tall as the tallest card.
            The "Right now" strip of 2026-11-02 folded back into these cards
            (user: "like before it can all be the cards"). */}
        <section className="grid auto-rows-fr grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <Kpi
            label="On roll"
            value={enrolled}
            art="/hr/3d/onroll.png"
            tone="indigo"
            href={show("onroll")}
            note={`on the punch reader · ${roster.length} active`}
          />
          <Kpi
            label="Present"
            value={present}
            unit={`/ ${enrolled}`}
            art="/hr/3d/present.png"
            bar={pctOf(present, enrolled)}
            tone="emerald"
            href={show("present")}
            note={<Delta today={present} yesterday={prev?.present} goodWhen="up" />}
          />
          <Kpi
            label="Leave"
            value={onLeave}
            art="/hr/3d/leave.png"
            tone="sky"
            href={show("leave")}
            note={onLeave ? `${pctOf(onLeave, enrolled)}% on approved leave` : "nobody on leave"}
          />
          <Kpi
            label="On duty"
            value={onDuty}
            art="/hr/3d/onduty.png"
            tone="violet"
            href={show("onduty")}
            note={onDuty ? "away on company work" : "nobody on duty outside"}
          />
          <Kpi
            label="Permission"
            value={onPermission}
            art="/hr/3d/permission.png"
            tone="amber"
            href={show("permission")}
            note={onPermission ? "short time off today" : "no permission today"}
          />
          <Kpi
            label="Absent"
            value={absent}
            art="/hr/3d/absent.png"
            tone="rose"
            href={show("absent")}
            note={notIn ? `${notIn} not due yet` : `${pctOf(absent, enrolled)}% of workforce`}
          />
          <Kpi
            label="Late arrivals"
            value={late}
            art="/hr/3d/late.png"
            tone="amber"
            href={show("late")}
            note={<Delta today={late} yesterday={prev?.late} goodWhen="down" />}
          />
          <Kpi
            label="Left early"
            value={leftEarly}
            art="/hr/3d/left.png"
            tone="violet"
            href={show("early")}
            note={`${gone} gone home for the day`}
          />
          <Kpi
            label="On-time rate"
            value={`${onTimeRate}%`}
            art="/hr/3d/ontime.png"
            tone="emerald"
            bar={onTimeRate}
            href={show("ontime")}
            note={
              <Delta
                today={onTimeRate}
                yesterday={prev ? pctOf(prev.present - prev.late, prev.present) : undefined}
                goodWhen="up"
                unit=" pts"
              />
            }
          />
          <Kpi
            label="On premises"
            value={inside}
            art="/hr/3d/premises.png"
            tone="sky"
            href={show("premises")}
            note={`${outNow} out right now · ${trips} trips out`}
          />
        </section>

        {/* ── Week + today's breakdown ─────────────────────── */}
        <div className="grid gap-6 xl:grid-cols-12">
          <Panel accent="sky"
            title="Attendance trend"
            subtitle={weekNote ?? `Last 7 days · average ${avgWeek} present a day · ${weekRate}% attendance`}
            icon={CalendarDays}
            className="xl:col-span-8"
            action={
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-gradient-to-t from-indigo-600 to-violet-400" /> On time</span>
                <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-gradient-to-b from-amber-300 to-orange-500" /> Late</span>
                <span className="flex items-center gap-1.5"><Dot className={cn(S.idle.bg, "rounded-sm")} /> Not present</span>
              </div>
            }
          >
            {week.length ? (
              <div className="flex gap-3">
                <div className="flex h-60 flex-col justify-between pb-7 text-right text-[10px] tabular-nums text-slate-400">
                  {[4, 3, 2, 1, 0].map((k) => (
                    <span key={k}>{(wTop / 4) * k}</span>
                  ))}
                </div>
                <div className="relative flex-1">
                  <div className="absolute inset-x-0 bottom-7 top-0 flex flex-col justify-between" aria-hidden>
                    {[0, 1, 2, 3, 4].map((k) => (
                      <div key={k} className={cn("border-t border-slate-100 dark:border-slate-800", k === 4 && "border-slate-200 dark:border-slate-700")} />
                    ))}
                  </div>
                  <div className="relative grid h-60 grid-cols-7 gap-3 sm:gap-6">
                    {week.map((w) => {
                      const isToday = w.day === today;
                      const ok = Math.max(0, w.present - w.late);
                      return (
                        <div key={w.day} className="group relative flex flex-col items-center">
                          <div className="flex w-full flex-1 flex-col items-center justify-end">
                            <div className="flex w-full max-w-10 flex-col gap-[2px]" style={{ height: `${(w.enrolled / wTop) * 100}%` }}>
                              {w.away > 0 && <div className={cn("rounded-t-[4px]", S.idle.bg, "opacity-60")} style={{ flexGrow: w.away }} />}
                              {w.late > 0 && <div className={cn("bg-gradient-to-b from-amber-300 to-orange-500", !w.away && "rounded-t-[4px]")} style={{ flexGrow: w.late }} />}
                              {ok > 0 && <div className={cn("bg-gradient-to-t", isToday ? "from-fuchsia-600 to-pink-400" : "from-indigo-600 to-violet-400", !w.away && !w.late && "rounded-t-[4px]")} style={{ flexGrow: ok }} />}
                            </div>
                          </div>
                          <div className="h-7 pt-2 text-center text-[11px] leading-none">
                            <span className={cn(isToday ? "font-semibold text-slate-900 dark:text-white" : "text-slate-500")}>
                              {isToday ? "Today" : `${w.weekday} ${w.dd}`}
                            </span>
                          </div>
                          {/* Hover tooltip */}
                          <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-40 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white opacity-0 shadow-lg transition group-hover:opacity-100 dark:bg-slate-700">
                            <p className="font-semibold">{fmtDate(w.day)}</p>
                            <p className="mt-1 flex justify-between"><span>On time</span><b className="tabular-nums">{ok}</b></p>
                            <p className="flex justify-between"><span>Late</span><b className="tabular-nums">{w.late}</b></p>
                            <p className="flex justify-between"><span>Not present</span><b className="tabular-nums">{w.away}</b></p>
                            <p className="mt-1 flex justify-between border-t border-white/15 pt-1"><span>Attendance</span><b className="tabular-nums">{pctOf(w.present, w.enrolled)}%</b></p>
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

          <Panel accent="teal" title="Today's breakdown" subtitle={`${enrolled} people on the punch reader`} icon={PieChart} className="xl:col-span-4">
            <div className="flex flex-col items-center gap-5 sm:flex-row xl:flex-col 2xl:flex-row">
              <Donut
                total={`${pctOf(present, enrolled)}%`}
                label="attendance"
                slices={[
                  { v: onTime, hex: S.ontime.hex },
                  { v: late, hex: S.late.hex },
                  { v: onLeave + onDuty, hex: S.leave.hex },
                  { v: absent, hex: S.absent.hex },
                  { v: notIn, hex: S.idle.hex },
                ]}
              />
              <ul className="w-full space-y-2">
                {[
                  { label: "On time", v: onTime, dot: S.ontime.bg },
                  { label: "Late", v: late, dot: S.late.bg },
                  { label: "Leave / on duty", v: onLeave + onDuty, dot: S.leave.bg },
                  { label: "Absent", v: absent, dot: S.absent.bg },
                  { label: "Not due yet", v: notIn, dot: S.idle.bg },
                ]
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
            <dl className="mt-5 grid grid-cols-2 divide-x divide-slate-100 rounded-xl bg-slate-50 py-3 text-center dark:divide-slate-800 dark:bg-slate-800/40">
              <div>
                <dd className="text-base font-semibold tabular-nums text-slate-900 dark:text-white">{onTimeRate}%</dd>
                <dt className="text-[11px] text-slate-500">On time</dt>
              </div>
              <div>
                <dd className="text-base font-semibold tabular-nums text-slate-900 dark:text-white">{mins(avgLate)}</dd>
                <dt className="text-[11px] text-slate-500">Avg late</dt>
              </div>
            </dl>
          </Panel>
        </div>

        {/* ── Act on it: attention + approvals & quick actions ── */}
        <div className="grid gap-6 xl:grid-cols-12">
          <NeedsAttention attention={data.attention} now={now} className="xl:col-span-8" />

          <div className="flex flex-col gap-6 xl:col-span-4">
            <Panel accent="amber"
              title="Pending leave & permission"
              subtitle={data.pendingTimeOff.length ? `${data.pendingTimeOff.length} waiting for a decision` : "Nothing waiting"}
              icon={ClipboardCheck}
              action={<ViewAll href="/hr/time-off/approvals">Review</ViewAll>}
            >
              {data.pendingTimeOff.length ? (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.pendingTimeOff.slice(0, 4).map((t) => (
                    <li key={t.id} className="flex items-center gap-3 py-2">
                      <Avatar name={t.name} />
                      <span className="min-w-0 flex-1">
                        <Truncated text={t.name} className="block text-sm font-medium text-slate-900 dark:text-slate-100" />
                        <Truncated
                          text={`${t.type} · ${fmtDate(t.from)}${t.to !== t.from ? ` – ${fmtDate(t.to)}` : ""}`}
                          className="block text-xs text-slate-500"
                        />
                      </span>
                      <Pill tone={t.kind === "permission" ? "late" : "leave"}>{t.kind === "permission" ? "Permission" : `${t.days || 1}d`}</Pill>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty icon={BadgeCheck}>Every request has been answered.</Empty>
              )}
            </Panel>

            <Panel accent="indigo" title="Quick actions" icon={ArrowRight}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
                {ACTIONS.map((a) => (
                  <Link
                    key={a.label}
                    href={a.href}
                    className="group/act relative flex flex-col items-center gap-1.5 rounded-xl border border-slate-200/80 px-2 py-3 text-center text-xs font-medium text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50/60 hover:text-indigo-700 dark:border-slate-800 dark:text-slate-300 dark:hover:border-indigo-500/40 dark:hover:bg-indigo-500/10"
                  >
                    <a.icon className="h-5 w-5 text-slate-400 transition group-hover/act:text-indigo-600" aria-hidden />
                    {a.label}
                    {!!a.badge && (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-rose-600 px-1.5 text-[10px] font-bold tabular-nums text-white">{a.badge}</span>
                    )}
                  </Link>
                ))}
              </div>
            </Panel>
          </div>
        </div>

        {/* ── Department · away · celebrations ─────────────── */}
        <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
          <Panel accent="cyan" title="Attendance by department" subtitle="Today, present of on roll" icon={Building2}>
            {depts.length ? (
              <>
                <ul className="space-y-3">
                  {depts.slice(0, 7).map((d) => {
                    const p = d.ontime + d.late;
                    return (
                      <li key={d.name}>
                        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                          <Truncated text={d.name} className="min-w-0 font-medium text-slate-700 dark:text-slate-200" />
                          <span className="shrink-0 tabular-nums text-slate-500">
                            <b className="font-semibold text-slate-900 dark:text-white">{p}</b>/{d.onroll} · {pctOf(p, d.onroll)}%
                          </span>
                        </div>
                        <div className="flex h-2 gap-[2px] overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" title={`${d.ontime} on time · ${d.late} late · ${d.onroll - p} not present`}>
                          {d.ontime > 0 && <span className={S.ontime.bg} style={{ width: `${(d.ontime / d.onroll) * 100}%` }} />}
                          {d.late > 0 && <span className={S.late.bg} style={{ width: `${(d.late / d.onroll) * 100}%` }} />}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {depts.length > 7 && <p className="mt-3 text-xs text-slate-500">+{depts.length - 7} smaller departments — use the filter above.</p>}
              </>
            ) : (
              <Empty>Nobody on the punch reader yet.</Empty>
            )}
          </Panel>

          <Panel accent="violet"
            title="Who's away today"
            subtitle={`${onLeave} on leave · ${onDuty} on duty · ${onPermission} permission`}
            icon={Plane}
            action={<ViewAll href="/hr/time-off/calendar">Calendar</ViewAll>}
          >
            {away.length ? (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {away.slice(0, 6).map((t) => (
                  <li key={t.bio} className="flex items-center gap-3 py-2">
                    <Avatar name={t.person!.name} />
                    <span className="min-w-0 flex-1">
                      <Truncated text={t.person!.name} className="block text-sm font-medium text-slate-900 dark:text-slate-100" />
                      <Truncated
                        text={[t.type || null, t.person!.departmentName ?? "No department"].filter(Boolean).join(" · ")}
                        className="block text-xs text-slate-500"
                      />
                    </span>
                    <Pill tone={t.kind === "on_duty" ? "duty" : t.kind === "permission" ? "late" : "leave"}>
                      {t.kind === "on_duty" ? "On duty" : t.kind === "permission" ? "Permission" : "Leave"}
                    </Pill>
                  </li>
                ))}
                {away.length > 6 && (
                  <li className="pt-2">
                    <Link href={show("leave")} className={LINK}>
                      +{away.length - 6} more
                    </Link>
                  </li>
                )}
              </ul>
            ) : (
              <Empty icon={UserCheck}>Everyone is expected in today.</Empty>
            )}
          </Panel>

          <Panel accent="fuchsia" title="Celebrations" subtitle="Birthdays and work anniversaries, next 7 days" icon={Cake} className="lg:col-span-2 xl:col-span-1">
            {celebrations.length ? (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {celebrations.slice(0, 6).map((c) => (
                  <li key={c.key} className="flex items-center gap-3 py-2">
                    <span
                      className={cn(
                        "grid h-8 w-8 shrink-0 place-items-center rounded-full",
                        c.days === 0 ? "bg-pink-100 text-pink-600 dark:bg-pink-500/15 dark:text-pink-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800",
                      )}
                    >
                      <c.icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <Truncated text={c.p.name} className="block text-sm font-medium text-slate-900 dark:text-slate-100" />
                      <Truncated text={[c.what, c.p.departmentName].filter(Boolean).join(" · ")} className="block text-xs text-slate-500" />
                    </span>
                    <span className={cn("shrink-0 text-xs font-semibold", c.days === 0 ? "text-pink-600 dark:text-pink-300" : "text-slate-500")}>{whenLabel(c.days)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty icon={Cake}>No birthdays or anniversaries this week.</Empty>
            )}
            {joiners.length > 0 && (
              <div className="mt-3 rounded-xl bg-indigo-50/70 px-3 py-2.5 text-xs text-indigo-900 dark:bg-indigo-500/10 dark:text-indigo-200">
                <span className="font-semibold">Welcome aboard · </span>
                {joiners.length} joined in the last 30 days — {joiners.slice(0, 3).map((p) => p.name).join(", ")}
                {joiners.length > 3 ? ` and ${joiners.length - 3} more` : ""}.
              </div>
            )}
          </Panel>
        </div>

        {/* ── Workforce · HR pipeline · shift hours ────────── */}
        <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
          <Panel accent="emerald" title="Workforce mix" subtitle={`${roster.length} active ${kindLabel(side).toLowerCase()} · average tenure ${avgTenure} years`} icon={Users}>
            {roster.length ? (
              <div className="space-y-5">
                <div>
                  <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full">
                    {gender.male > 0 && <span className="bg-indigo-500" style={{ flexGrow: gender.male }} />}
                    {gender.female > 0 && <span className="bg-pink-500" style={{ flexGrow: gender.female }} />}
                    {gender.other > 0 && <span className="bg-slate-300 dark:bg-slate-600" style={{ flexGrow: gender.other }} />}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                    <span className="flex items-center gap-1.5"><Dot className="bg-indigo-500" /> Male <b className="tabular-nums">{gender.male}</b> <span className="text-slate-400">{pctOf(gender.male, roster.length)}%</span></span>
                    <span className="flex items-center gap-1.5"><Dot className="bg-pink-500" /> Female <b className="tabular-nums">{gender.female}</b> <span className="text-slate-400">{pctOf(gender.female, roster.length)}%</span></span>
                    {gender.other > 0 && (
                      <span className="flex items-center gap-1.5"><Dot className="bg-slate-300 dark:bg-slate-600" /> Not set <b className="tabular-nums">{gender.other}</b></span>
                    )}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-slate-500">Tenure</p>
                  <ul className="space-y-1.5">
                    {tenure.map((t) => (
                      <BarRow key={t.label} label={t.label} value={t.n} max={Math.max(...tenure.map((x) => x.n), 1)} />
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-slate-500">Age</p>
                  <ul className="space-y-1.5">
                    {ages.map((t) => (
                      <BarRow key={t.label} label={t.label} value={t.n} max={Math.max(...ages.map((x) => x.n), 1)} className="bg-indigo-400" />
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <Empty>No active people in this view.</Empty>
            )}
          </Panel>

          <Panel accent="orange" title="HR pipeline" subtitle="Open work across recruitment, lifecycle and conduct" icon={Briefcase}>
            <div className="grid grid-cols-2 gap-2.5">
              {PIPELINE.map((p) => (
                <Link
                  key={p.label}
                  href={p.href}
                  className="group/pl flex flex-col gap-2 rounded-xl border border-slate-200/80 p-3 transition hover:border-indigo-300 hover:bg-indigo-50/50 dark:border-slate-800 dark:hover:border-indigo-500/40 dark:hover:bg-indigo-500/5"
                >
                  <span className="flex items-center justify-between">
                    <p.icon className="h-4 w-4 text-slate-400 group-hover/pl:text-indigo-600" aria-hidden />
                    <ArrowUpRight className="h-3.5 w-3.5 text-slate-300 group-hover/pl:text-indigo-500" aria-hidden />
                  </span>
                  <span className="text-xl font-semibold tabular-nums text-slate-900 dark:text-white">{p.n}</span>
                  <span className="text-xs text-slate-500">{p.label}</span>
                </Link>
              ))}
            </div>
          </Panel>

          <Panel accent="indigo"
            title="Shift hours"
            subtitle={`${kindLabel(side)} · by employee category`}
            icon={Clock}
            className="lg:col-span-2 xl:col-span-1"
            action={<ViewAll href="/masters/hr/work-timing">Change</ViewAll>}
          >
            {shifts.length ? (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {shifts.map((x) => (
                  <li key={`${x.group}-${x.categoryId ?? "none"}`} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <Truncated text={x.name} className="block text-sm font-medium text-slate-900 dark:text-slate-100" />
                      <span className="text-xs text-slate-500">
                        {x.people} {x.people === 1 ? "person" : "people"}
                        {x.upcoming ? ` · changes ${fmtDate(x.upcoming.effective_from)}` : ""}
                      </span>
                    </span>
                    {x.timing ? (
                      <span className="shrink-0 text-right">
                        <span className="flex items-center justify-end gap-1 text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                          {fmtTime(x.timing.in_time)}
                          <ArrowRight className="h-3 w-3 text-slate-400" aria-hidden />
                          {fmtTime(x.timing.out_time)}
                          {isOvernight(x.timing) && <Moon className="h-3 w-3 text-indigo-500" aria-label="overnight" />}
                        </span>
                        <span className="text-xs tabular-nums text-slate-500">
                          {mins(shiftMinutes(x.timing))} · {x.timing.grace_minutes}m grace
                        </span>
                      </span>
                    ) : (
                      <Pill tone="late">No timing</Pill>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Nobody here is enrolled on the punch reader yet.</Empty>
            )}
          </Panel>
        </div>

        {/* ── People — the names behind any tile ───────────── */}
        <DashboardPeople rows={peopleRows} now={now} />

        {/* ── Activity log + devices ───────────────────────── */}
        <div className="grid gap-6 xl:grid-cols-12">
          <Panel accent="fuchsia"
            title="Live activity"
            subtitle="Latest punches, labelled by their place in each person's day"
            icon={Fingerprint}
            className="xl:col-span-8"
            bodyClass="p-0"
            action={<ViewAll href="/hr/attendance?view=live" />}
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
                        <td className={TD}>
                          <span className="flex items-center gap-2.5">
                            <Avatar name={p.name ?? p.bio} className="h-7 w-7 text-[10px]" />
                            <span className="font-medium text-slate-900 dark:text-slate-100">{p.name ?? `ID ${p.bio}`}</span>
                          </span>
                        </td>
                        <td className={TD}>{p.kind ? <GroupChip group={p.kind} /> : "—"}</td>
                        <td className={cn(TD, "text-right")}>
                          <Pill tone={p.label === "In" ? "ontime" : p.label === "Out" ? "idle" : "leave"}>
                            {p.label === "In" ? "Check in" : p.label === "Out" ? "Check out" : "Returned"}
                          </Pill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-5">
                <Empty icon={Fingerprint} art={<WaitingScene className="h-28" />}>No punches recorded yet today.</Empty>
              </div>
            )}
          </Panel>

          <Panel accent="emerald" title="Devices" subtitle={`${online.length} of ${data.devices.length} online`} icon={Wifi} className="xl:col-span-4" bodyClass="p-0">
            <RadarPanel healthy={allOnline} blips={recentPunches} />
            {data.devices.length ? (
              <ul className="divide-y divide-slate-100 px-5 pb-2 dark:divide-slate-800">
                {data.devices.map((d) => {
                  const on = !!d.last_seen && now - Date.parse(d.last_seen) <= ONLINE_WINDOW_MS;
                  return (
                    <li key={d.serial_no} className="flex items-center gap-3 py-2.5">
                      <span className={cn("grid h-9 w-9 place-items-center rounded-lg", on ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10" : "bg-rose-50 text-rose-600 dark:bg-rose-500/10")}>
                        {on ? <Wifi className="h-4 w-4" aria-hidden /> : <WifiOff className="h-4 w-4" aria-hidden />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <Truncated text={d.name ?? d.serial_no} className="block text-sm font-medium text-slate-900 dark:text-slate-100" />
                        <Truncated
                          text={`${d.serial_no} · ${d.last_seen ? `seen ${clock(Date.parse(d.last_seen))}` : "never connected"}`}
                          className="block text-xs text-slate-500"
                        />
                      </span>
                      <Pill tone={on ? "ontime" : "absent"}>{on ? "Online" : "Offline"}</Pill>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="p-5">
                <Empty icon={WifiOff}>No device has connected yet.</Empty>
              </div>
            )}
          </Panel>
        </div>

        <p className="text-center text-xs text-slate-400">Refreshes every minute · all times IST</p>
      </div>
    </div>
  );
}

