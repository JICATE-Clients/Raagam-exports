import { cache, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarClock,
  CheckCheck,
  CircleCheck,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Flag,
  IndianRupee,
  PackageOpen,
  Plus,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";
import { getBoard } from "@/lib/dashboard/board";
import { getAlerts } from "@/lib/dashboard/service";
import type { DashboardCaps, DashboardTone } from "@/lib/dashboard/types";
import { fmtCompactInr, fmtCompactNumber } from "@/lib/dashboard/format";
import { fmtMoneyShort } from "@/components/dashboard/board";
import { iconFor } from "@/components/dashboard/icon";
import { addDays, today } from "@/lib/calendar";
import { getCalendar, type CalEvent } from "@/lib/my-calendar/data";
import { hasPermission, type Action, type AppUser, type Module } from "@/lib/auth/types";
import { screenOfPath } from "@/lib/permissions/screen-catalog";
import { Truncated } from "@/components/ui/truncated";
import { cn } from "@/lib/utils";

/**
 * THE PHONE HOME (user 2026-11-04, mock-up https://claude.ai/artifact/1wBnFsT36NUb6LBasuGSxm
 * v2, "this is only for mobile view understand built this").
 *
 * Below `md` the desktop dashboard's cards were simply stacked, so a phone got a 350px
 * chart, ring labels cut to "Pre-productio…" and a long scroll with nothing leading. This
 * is the same figures laid out the way a phone app reads (reference: the client's
 * IndianOil One screenshot), with colour given ONE JOB per role — the 60 · 30 · 10 rule:
 *
 * - 60 neutral — the page and the white tiles;
 * - 30 Raagam blue — the band under the top bar and the one headline card (the order book);
 * - 10 Raagam green — "your action": Your day, its button, an on-track pill, the peak month;
 * - red / amber only where something is wrong, so a problem is what the eye finds first.
 *
 * THE COLOURED GROUNDS ARE THE PHONE HOME'S ONLY. The standing rule elsewhere is "white is
 * enough" (raagam-brand-colours); the client asked for this one surface by name, mobile only.
 *
 * Every figure is read through the loaders the desktop cards already use (`getBoard`,
 * `getAlerts`, `getCalendar`), so the phone can never disagree with the desktop. Both
 * layouts render on every request and CSS hides one; `getBoard` and `getAlerts` are
 * memoised per request, so the hidden one costs no second set of queries.
 */

/** The blue family, fixed: the band must read the same in light and dark. */
const NAVY = "#0a2e4d";

/** One week of the viewer's calendar, shared by Your day and This week (one read, not two). */
const weekOf = cache(async (user: AppUser, monday: string) =>
  getCalendar(user, { scope: "mine", from: monday, to: addDays(monday, 6), withOverdue: true }),
);

function mondayOf(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, -((dow + 6) % 7));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthShort = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/* Complete literal class strings — Tailwind scans source text (see tone.ts). */
const SOLID: Record<DashboardTone, string> = {
  primary: "bg-primary", accent: "bg-accent", success: "bg-success", warning: "bg-warning",
  danger: "bg-danger", info: "bg-info", pos: "bg-pos", muted: "bg-muted-foreground",
};
const SOFT: Record<DashboardTone, string> = {
  primary: "bg-primary-soft text-primary", accent: "bg-accent-soft text-accent", success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning", danger: "bg-danger-soft text-danger", info: "bg-info-soft text-info",
  pos: "bg-success-soft text-pos", muted: "bg-surface-muted text-muted-foreground",
};
const EDGE: Record<DashboardTone, string> = {
  primary: "border-primary/25", accent: "border-accent/25", success: "border-success/25", warning: "border-warning/30",
  danger: "border-danger/25", info: "border-info/25", pos: "border-pos/25", muted: "border-border",
};
/** Alarm order for the tiles: the most urgent kind first. */
const RANK: Record<DashboardTone, number> = { danger: 0, warning: 1, accent: 2, info: 3, primary: 4, pos: 5, success: 6, muted: 7 };

/** A tile card. White, hairline, the softest shadow — the ground the colour sits on. */
const CARD = "rounded-[18px] border border-border bg-surface shadow-[0_2px_8px_rgb(15_27_45/0.04)]";

function SectionHead({ title, href, cta, note }: { title: string; href?: string; cta?: string; note?: string }) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-2">
      <h2 className="text-[16.5px] font-bold text-heading">{title}</h2>
      {note && <span className="shrink-0 text-[12.5px] font-semibold text-muted-foreground">{note}</span>}
      {href && cta && (
        <Link href={href} className="shrink-0 text-[12.5px] font-bold text-primary">
          {cta} ›
        </Link>
      )}
    </div>
  );
}

/** A lucide glyph drawn two-tone: a tinted fill under its own stroke. */
function TwoTone({ icon: I, className }: { icon: LucideIcon; className?: string }) {
  return <I aria-hidden className={className} fill="currentColor" fillOpacity={0.18} strokeWidth={2.1} />;
}

/* ───────────────────────── 1 · the band + the order book ───────────────────────── */

/**
 * The band continues the top bar's navy into the page, and the order book card overlaps
 * it — the one card that wins the first glance (reference: the Points card).
 */
export async function MobileHero({ caps }: { caps: DashboardCaps }) {
  const o = (await getBoard(caps)).orders;
  const band = (
    <div
      aria-hidden
      className="-mx-4 -mt-4 h-14"
      style={{ background: `linear-gradient(180deg, ${NAVY} 0%, #0c4470 100%)` }}
    />
  );
  if (!o || o === "error") {
    return (
      <div>
        {band}
        {o === "error" && (
          <p className={cn(CARD, "relative -mt-8 p-4 text-sm text-danger")}>Could not load the order book.</p>
        )}
      </div>
    );
  }

  const lateValue = o.ageing.reduce((n, a) => n + a.value, 0);
  const thisMonth = today().slice(0, 7);
  const months = [...o.byMonth].sort((a, z) => a.month.localeCompare(z.month)).slice(0, 5);
  const measure = (m: (typeof months)[number]) => (o.currency ? m.value : m.orders);
  const peak = Math.max(1, ...months.map(measure));

  return (
    <div>
      {band}
      <Link
        href="/orders/all"
        className="relative -mt-11 block overflow-hidden rounded-[20px] p-4 text-white shadow-[0_14px_30px_rgb(3_123_184/0.32)]"
        style={{ background: "linear-gradient(120deg, #0b3a5e 0%, #0a6aa6 60%, #2a9bd8 100%)" }}
      >
        <span aria-hidden className="absolute -bottom-10 -right-8 size-44 rounded-full bg-brand-green/20" />
        <div className="relative flex gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold tracking-wide text-[#cfe6f5]">
              OPEN ORDER BOOK{o.currency ? ` · ${o.currency}` : ""}
            </p>
            <p className="mt-0.5 text-[30px] font-extrabold leading-tight tracking-tight">
              {o.value != null ? fmtMoneyShort(o.value, o.currency) : `${fmtCompactNumber(o.open)} orders`}
            </p>
            <p className="text-xs text-[#cfe6f5]">
              {o.open} open · {fmtCompactNumber(o.qty)} pcs
            </p>
            <span
              className={cn(
                "mt-2.5 inline-block rounded-full px-2.5 py-1 text-[11.5px] font-bold",
                o.late > 0 ? "bg-[#ffd6d6] text-[#8a1414]" : "bg-brand-green text-[#16300a]",
              )}
            >
              {o.late > 0
                ? `● ${o.late} late${o.currency ? ` · ${fmtMoneyShort(lateValue, o.currency)}` : ""}`
                : "● Nothing late · on track"}
            </span>
            <span className="mt-3 flex w-fit items-center gap-1 rounded-full border border-white/35 bg-white/18 px-3.5 py-1.5 text-[13px] font-bold">
              Open orders ›
            </span>
          </div>
          {/* WHEN THE WORK IS DUE, AS FIVE BARS. A past month is red — its orders are
              late — and the heaviest month is green, the one to plan for. */}
          {months.length > 1 && (
            <div className="flex shrink-0 flex-col items-end justify-start pt-1" aria-label="Open orders by delivery month">
              <div className="flex h-16 items-end gap-1.5">
                {months.map((m) => (
                  <i
                    key={m.month}
                    title={`${monthShort(m.month)} · ${m.orders} orders`}
                    className={cn(
                      "block w-3 rounded-t-[4px] rounded-b-[2px]",
                      m.month < thisMonth ? "bg-[#ff9a9a]" : measure(m) === peak ? "bg-brand-green" : "bg-white/40",
                    )}
                    style={{ height: `${Math.max(8, (measure(m) / peak) * 100)}%` }}
                  />
                ))}
              </div>
              <div className="mt-1 flex gap-1.5 text-[9.5px] text-[#cfe6f5]">
                {months.map((m) => (
                  <span key={m.month} className="w-3 text-center">
                    {monthShort(m.month).charAt(0)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </Link>
    </div>
  );
}

/* ───────────────────────── 2 · your day ───────────────────────── */

export async function MobileDay({ user }: { user: AppUser }) {
  const t = today();
  const data = await weekOf(user, mondayOf(t));
  const own = data.available && !data.autoTeam;
  const overdue = own ? data.events.filter((e) => !e.done && e.date < t).length : 0;
  const dueToday = own ? data.events.filter((e) => e.date === t && !e.done).length : 0;
  const total = overdue + dueToday;
  const href = `/my-calendar?cv=day&cd=${t}`;

  const title = !own ? "Vanakkam!" : total === 0 ? "Vanakkam! All clear today" : `Vanakkam! ${total} thing${total === 1 ? "" : "s"} today`;
  const line = !data.available
    ? (data.reason ?? "Your tasks are not available.")
    : data.autoTeam
      ? "Link your login to a staff record to see your own tasks."
      : overdue > 0
        ? `${overdue} ${overdue === 1 ? "is" : "are"} overdue. Start with ${overdue === 1 ? "that" : "those"}, and the day gets easier.`
        : total > 0
          ? "Nothing overdue. A good day to stay ahead."
          : "Nothing due and nothing overdue.";

  return (
    <section
      aria-label="Your day"
      className="flex items-center gap-2.5 rounded-[18px] border border-[#d9ecbb] py-3.5 pl-4 pr-2 dark:border-success/30"
      style={{ background: "linear-gradient(110deg, var(--surface) 0%, var(--success-soft) 100%)" }}
    >
      <div className="min-w-0 flex-1">
        <p className="font-baloo text-[19px] font-bold leading-tight text-success">{title}</p>
        <p className="mt-1 text-[12.5px] leading-snug text-foreground/80">{line}</p>
        {own && (
          <Link
            href={href}
            className="mt-2.5 inline-block rounded-control bg-success px-3.5 py-2 text-[12.5px] font-bold text-white"
          >
            {overdue > 0 ? "Start with overdue" : "Open my day"}
          </Link>
        )}
      </div>
      <NoolMini />
    </section>
  );
}

/** A still Nool for the phone strip — the full-body animated one is the desktop's. */
function NoolMini() {
  return (
    <svg width="84" height="88" viewBox="0 0 92 96" aria-hidden className="shrink-0">
      <ellipse cx="48" cy="90" rx="30" ry="5" fill="var(--success-soft)" />
      <rect x="30" y="16" width="36" height="8" rx="3" fill="#0493db" />
      <rect x="34" y="24" width="28" height="34" rx="6" fill="#85c227" />
      <path d="M34 30h28M34 36h28M34 42h28M34 48h28" stroke="#6ea81c" strokeWidth="2" />
      <rect x="30" y="58" width="36" height="8" rx="3" fill="#0493db" />
      <circle cx="43" cy="37" r="2.6" fill="#16300a" />
      <circle cx="54" cy="37" r="2.6" fill="#16300a" />
      <path d="M44 45q4.5 4 9 0" stroke="#16300a" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M62 34q14-6 16-20" stroke="#85c227" strokeWidth="5" fill="none" strokeLinecap="round" />
      <circle cx="78" cy="12" r="6" fill="#85c227" />
      <path d="M34 40q-10 8-8 20" stroke="#85c227" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M42 66v16M54 66v16" stroke="#85c227" strokeWidth="5" strokeLinecap="round" />
      <rect x="35" y="80" width="12" height="7" rx="3" fill="#0493db" />
      <rect x="50" y="80" width="12" height="7" rx="3" fill="#0493db" />
    </svg>
  );
}

/* ───────────────────────── 3 · waiting on you ───────────────────────── */

/**
 * The desktop's "What waits on me?" rings as tiles (reference: My Favourites). The count
 * is the badge in the corner, coloured by how bad it is; the label gets two full lines.
 */
export async function MobileWaiting({ caps }: { caps: DashboardCaps }) {
  const alerts = [...(await getAlerts(caps))].sort((a, z) => RANK[a.tone] - RANK[z.tone]);
  const total = alerts.reduce((n, a) => n + (a.count ?? 0), 0);

  return (
    <section aria-label="Waiting on you">
      {/* A count, not a link: these are alerts, each tile opens its own list — none of them is the approvals queue. */}
      <SectionHead title="Waiting on you" note={total ? `${total} items` : undefined} />
      {alerts.length === 0 ? (
        <p className={cn(CARD, "flex items-center gap-2.5 p-3.5 text-[13px] text-muted-foreground")}>
          <span className="grid size-8 place-items-center rounded-lg bg-success-soft text-success">
            <CheckCheck className="size-4" />
          </span>
          Nothing needs your attention.
        </p>
      ) : (
        <ul className="grid grid-cols-4 gap-2 pt-1.5">
          {alerts.map((a) => {
            const I = iconFor(a.icon);
            const num = a.count != null ? `${a.count}${a.countPlus ? "+" : ""}` : "•";
            const body = (
              <>
                <span className={cn("absolute -right-1.5 -top-2 grid h-[22px] min-w-6 place-items-center rounded-full border-2 border-[var(--panel)] px-1.5 text-[11.5px] font-extrabold tabular-nums text-white", SOLID[a.tone])}>
                  {num}
                </span>
                <span className={cn("grid size-10 place-items-center rounded-xl", SOFT[a.tone])}>
                  <TwoTone icon={I} className="size-[22px]" />
                </span>
                {/* truncate-reveal: exempt -- short kind labels, three lines allowed ("Deliveries late"); the tile's aria-label carries the full title and body */}
                <span className="line-clamp-3 text-[11px] font-semibold leading-tight tracking-tight text-foreground">{a.label ?? a.title}</span>
              </>
            );
            const cls = cn(
              "relative flex h-full flex-col items-center gap-1.5 rounded-2xl border-[1.5px] bg-surface px-0.5 pb-2.5 pt-3 text-center [-webkit-tap-highlight-color:transparent] active:scale-[0.97]",
              EDGE[a.tone],
            );
            return (
              <li key={a.key} className="min-w-0">
                {a.href ? (
                  <Link href={a.href} aria-label={`${a.title}. ${a.body}`} className={cls}>
                    {body}
                  </Link>
                ) : (
                  <div aria-label={`${a.title}. ${a.body}`} className={cls}>
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ───────────────────────── 4 · orders at a glance ───────────────────────── */

interface Glance {
  key: string;
  title: string;
  sub: string;
  value: ReactNode;
  tone: DashboardTone;
  icon: LucideIcon;
  href: string;
  tag?: string;
}

/** A row you swipe (reference: Explore Our Services) — the next card peeks in. */
function SwipeRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      role="list"
      aria-label={label}
      className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1.5 pt-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {children}
    </div>
  );
}

export async function MobileGlance({ caps }: { caps: DashboardCaps }) {
  const b = await getBoard(caps);
  const out: Glance[] = [];
  const o = b.orders !== "error" ? b.orders : null;
  if (o) {
    out.push({
      key: "late", title: "Late orders", sub: "Past delivery date",
      value: o.late, tone: o.late > 0 ? "danger" : "success", icon: o.late > 0 ? Clock : CircleCheck,
      href: "/orders/progress", tag: o.late === 0 && o.dated > 0 ? "On track" : undefined,
    });
    out.push({
      key: "due", title: "Due in 30 days", sub: `Ship by ${(() => { const d = addDays(today(), 30); return `${Number(d.slice(8, 10))} ${monthShort(d)}`; })()}`,
      value: <>{o.due30} <span className="text-[13px] font-semibold text-muted-foreground">orders</span></>,
      tone: "warning", icon: CalendarClock, href: "/orders/progress",
    });
  }
  const m = b.milestones !== "error" ? b.milestones : null;
  if (m && m.total > 0)
    out.push({
      key: "ms", title: "Milestones", sub: "T&A steps done",
      value: <>{m.done}<span className="text-[15px] font-semibold text-muted-foreground"> / {m.total}</span></>,
      tone: "accent", icon: Flag, href: "/orders/progress",
    });
  const r = b.receivables !== "error" ? b.receivables : null;
  if (r && r.open > 0)
    out.push({
      key: "ar", title: "Receivables", sub: `${fmtCompactInr(r.collected)} collected`,
      value: fmtCompactInr(r.open), tone: "primary", icon: IndianRupee, href: "/finance/receivables",
    });
  if (out.length === 0) return null;

  return (
    <section aria-label="Orders at a glance">
      <SectionHead title="Orders at a glance" href="/orders/all" cta="Orders" />
      <SwipeRow label="Order figures">
        {out.map((g) => (
          <Link
            key={g.key}
            role="listitem"
            href={g.href}
            className={cn(CARD, "relative h-[146px] w-[172px] shrink-0 snap-start overflow-hidden px-3.5 pt-3.5")}
          >
            <span className="flex items-center justify-between text-[13.5px] font-bold text-heading">
              {g.title}
              <ArrowUpRight className="size-4 text-primary" aria-hidden />
            </span>
            <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{g.sub}</span>
            <span
              className={cn(
                "relative z-10 mt-2.5 block text-2xl font-extrabold tabular-nums tracking-tight",
                g.key === "late" && g.tone === "danger" && "text-danger",
                g.key === "late" && g.tone === "success" && "text-success",
              )}
            >
              {g.value}
            </span>
            <span aria-hidden className={cn("absolute -bottom-8 -right-7 size-28 rounded-full", SOFT[g.tone])} />
            <TwoTone icon={g.icon} className={cn("absolute bottom-3 right-3 size-9", SOFT[g.tone].split(" ")[1])} />
            {g.tag && (
              <span className={cn("absolute bottom-3 left-0 rounded-r-lg py-[3px] pl-3.5 pr-2.5 text-[10.5px] font-bold text-white", SOLID[g.tone])}>
                {g.tag}
              </span>
            )}
          </Link>
        ))}
      </SwipeRow>
    </section>
  );
}

/* ───────────────────────── 5 · this week ───────────────────────── */

export async function MobileWeek({ user }: { user: AppUser }) {
  const t = today();
  const monday = mondayOf(t);
  const data = await weekOf(user, monday);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const team = data.scope === "team";
  const dayHref = (d: string) => `/my-calendar?cv=day&cd=${d}${team ? "&cs=team" : ""}`;

  const late = (e: CalEvent) => !e.done && e.date < t;
  const next = data.events
    .filter((e) => !e.done && e.date <= days[6])
    .sort((a, z) => a.date.localeCompare(z.date))
    .slice(0, 3);

  return (
    <section aria-label="This week">
      <SectionHead title={team ? "This week · team" : "This week"} href={`/my-calendar?cv=day&cd=${t}`} cta="My Calendar" />
      <div className={CARD}>
        {!data.available ? (
          <p className="p-4 text-center text-sm text-muted-foreground">{data.reason}</p>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1 p-2.5">
              {days.map((d, i) => {
                const ev = data.events.filter((e) => e.date === d);
                const isToday = d === t;
                return (
                  <Link
                    key={d}
                    href={dayHref(d)}
                    aria-label={`${WEEKDAYS[i]} ${Number(d.slice(8, 10))}: ${ev.length} items`}
                    className={cn(
                      "rounded-xl py-1.5 text-center",
                      isToday && "text-white shadow-[0_6px_14px_rgb(3_123_184/0.35)]",
                    )}
                    style={isToday ? { background: "linear-gradient(160deg, #0493db, var(--primary))" } : undefined}
                  >
                    <span className={cn("block text-[10.5px] font-bold", isToday ? "text-[#d8effb]" : "text-muted-foreground")}>{WEEKDAYS[i]}</span>
                    <span className={cn("my-0.5 block text-base font-extrabold", !isToday && i > 4 && "text-muted-foreground")}>
                      {Number(d.slice(8, 10))}
                    </span>
                    {/* One dot per item, up to three — red while it is overdue. */}
                    <span className="flex h-1.5 justify-center gap-0.5">
                      {ev.slice(0, 3).map((e) => (
                        <i key={e.id} className={cn("block size-1.5 rounded-full", isToday ? "bg-white" : late(e) ? "bg-danger" : "bg-primary")} />
                      ))}
                    </span>
                  </Link>
                );
              })}
            </div>
            {next.length > 0 && (
              <ul className="border-t border-border px-3">
                {next.map((e) => {
                  const overdue = late(e);
                  const isToday = e.date === t;
                  return (
                    <li key={e.id} className="border-b border-border/60 last:border-b-0">
                      <Link href={e.href} className="flex items-center gap-2.5 py-2.5 text-[13.5px] font-medium">
                        <span className={cn("grid size-[30px] shrink-0 place-items-center rounded-[9px]", overdue ? SOFT.danger : SOFT.primary)}>
                          {overdue ? <Clock className="size-4" /> : <ClipboardCheck className="size-4" />}
                        </span>
                        {/* The row is a link, so the bubble is hover-only (touch={false}): a long-press must not fight the tap. */}
                        <Truncated touch={false} className="min-w-0 flex-1" text={e.reNo ? `${e.title} · ${e.reNo}` : e.title} />
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold", overdue ? SOFT.danger : isToday ? SOFT.primary : SOFT.muted)}>
                          {overdue ? "Overdue" : isToday ? "Today" : `${Number(e.date.slice(8, 10))} ${monthShort(e.date)}`}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/* ───────────────────────── 6 · insights ───────────────────────── */

function Columns({ bars }: { bars: { label: string; value: number; text: string; className: string }[] }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="mt-4">
      <div className="mx-1 flex h-[100px] items-end gap-3 border-b border-border">
        {bars.map((b) => (
          <div key={b.label} className="relative flex-1 rounded-t-lg" style={{ height: `${Math.max(4, (b.value / max) * 100)}%` }}>
            <span className={cn("absolute inset-0 rounded-t-lg", b.className)} />
            <b className="absolute -top-4 inset-x-0 text-center text-[11px] font-extrabold tabular-nums text-heading">{b.text}</b>
          </div>
        ))}
      </div>
      <div className="mx-1 mt-1 flex gap-3 text-[11px] font-semibold text-muted-foreground">
        {bars.map((b) => (
          // truncate-reveal: exempt -- axis labels are a month or a day bucket ("Dec", "31–60 d")
          <span key={b.label} className="flex-1 truncate text-center">
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

const INSIGHT = cn(CARD, "w-[290px] shrink-0 snap-start p-3.5");

export async function MobileInsights({ caps }: { caps: DashboardCaps }) {
  const b = await getBoard(caps);
  const o = b.orders !== "error" ? b.orders : null;
  const p = b.purchase !== "error" ? b.purchase : null;
  const cards: ReactNode[] = [];
  const thisMonth = today().slice(0, 7);

  if (o && o.byMonth.length > 0) {
    const months = [...o.byMonth].sort((a, z) => a.month.localeCompare(z.month)).slice(0, 5);
    const v = (m: (typeof months)[number]) => (o.currency ? m.value : m.orders);
    const peak = Math.max(...months.map(v));
    cards.push(
      <Link key="due" href="/orders/all" role="listitem" className={INSIGHT}>
        <h3 className="text-[14.5px] font-bold text-heading">When is work due?</h3>
        <p className="text-xs text-muted-foreground">{o.currency ? "Open order value" : "Open orders"} by delivery month</p>
        <Columns
          bars={months.map((m) => ({
            label: monthShort(m.month),
            value: v(m),
            text: o.currency ? fmtMoneyShort(m.value, o.currency) : String(m.orders),
            className: m.month < thisMonth ? "bg-danger/70" : v(m) === peak ? "bg-primary" : "bg-primary/45",
          }))}
        />
      </Link>,
    );
  }
  if (o) {
    const TONES = ["bg-warning/60", "bg-warning", "bg-danger/80", "bg-danger"];
    cards.push(
      <Link key="late" href="/orders/progress" role="listitem" className={INSIGHT}>
        <h3 className="text-[14.5px] font-bold text-heading">How late?</h3>
        <p className="text-xs text-muted-foreground">Late orders by days past delivery</p>
        <Columns bars={o.ageing.map((a, i) => ({ label: `${a.label} d`, value: a.orders, text: String(a.orders), className: TONES[i] ?? "bg-danger" }))} />
      </Link>,
    );
  }
  if (p && p.byClass.length > 0) {
    const rows = p.byClass.slice(0, 5);
    const max = Math.max(1, ...rows.map((r) => r.amount));
    cards.push(
      <Link key="buy" href="/purchase/requirement-po" role="listitem" className={INSIGHT}>
        <h3 className="text-[14.5px] font-bold text-heading">What are we buying?</h3>
        <p className="text-xs text-muted-foreground">
          {p.total} POs · {p.pending} pending · in ₹
        </p>
        <ul className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <li key={r.label} className="text-xs">
              <span className="flex justify-between gap-2">
                <Truncated touch={false} className="min-w-0 font-medium" text={r.label} />
                <span className="font-bold tabular-nums">{fmtCompactInr(r.amount)}</span>
              </span>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-muted">
                <i className={cn("block h-full rounded-full", i === 0 ? "bg-success" : "bg-success/55")} style={{ width: `${(r.amount / max) * 100}%` }} />
              </span>
            </li>
          ))}
        </ul>
      </Link>,
    );
  }
  if (cards.length === 0) return null;
  return (
    <section aria-label="Insights">
      <SectionHead title="Insights" href="/reports" cta="Reports" />
      <SwipeRow label="Charts">{cards}</SwipeRow>
    </section>
  );
}

/* ───────────────────────── 7 · quick start ───────────────────────── */

const SHORTCUTS: { href: string; label: string; icon: LucideIcon; tone: DashboardTone; module: Module; action: Action }[] = [
  { href: "/orders/garment-orders", label: "Order Entry", icon: Plus, tone: "primary", module: "orders", action: "create" },
  { href: "/purchase/requirement-po", label: "Raise PO", icon: ShoppingCart, tone: "success", module: "materials_purchase", action: "create" },
  { href: "/purchase/grn", label: "GRN", icon: PackageOpen, tone: "warning", module: "materials_purchase", action: "view" },
  { href: "/approvals", label: "Approvals", icon: ClipboardList, tone: "accent", module: "dashboard", action: "view" },
];

/**
 * The phone has no sidebar and no Ctrl+K, so the four screens most often opened from a
 * phone sit here (reference: My Favourites). A shortcut the viewer may not open is left
 * out rather than greyed. Approvals needs no permission — your own queue is always yours.
 */
export function MobileQuickStart({ user }: { user: AppUser }) {
  const shown = SHORTCUTS.filter(
    (s) => s.href === "/approvals" || hasPermission(user, s.module, s.action, screenOfPath(s.href)),
  );
  if (shown.length === 0) return null;
  return (
    <section aria-label="Quick start">
      <SectionHead title="Quick start" />
      <ul className="grid grid-cols-4 gap-2.5">
        {shown.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="flex h-full flex-col items-center gap-1.5 rounded-2xl border-[1.5px] border-border bg-surface px-1 pb-2.5 pt-3 text-center active:scale-[0.97]"
            >
              <span className={cn("grid size-11 place-items-center rounded-[13px]", SOFT[s.tone])}>
                <TwoTone icon={s.icon} className="size-[22px]" />
              </span>
              <span className="text-[11.5px] font-semibold leading-tight">{s.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Streaming placeholder for any one phone section. */
export function MobileSkeleton({ h = "h-28" }: { h?: string }) {
  return <div className={cn("animate-pulse rounded-[18px] bg-surface-muted", h)} />;
}
