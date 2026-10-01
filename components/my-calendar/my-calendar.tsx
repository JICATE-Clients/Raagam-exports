import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { addDays, dayOfWeek } from "@/lib/calendar";
import type { CalEvent, CalKind, CalendarData } from "@/lib/my-calendar/data";
import { monthDays, monthGrid, stepCursor, type CalView } from "@/lib/my-calendar/view";
import { Card } from "@/components/ui/card";
import { Truncated } from "@/components/ui/truncated";

/**
 * MY CALENDAR — the page body, laid out to the approved design (artifact
 * "Dashboard Calendar & Scorecards", 2026-10-01):
 *
 *   Today  — mini month on the left (dots per kind, Mine/Team), and three
 *            columns on the right: Overdue · the day · Next 7 days, so the
 *            right side is never one empty box.
 *   Month  — a full month grid of labelled chips, "+N more" on a busy day.
 *   Year   — twelve months shaded by how busy each day is; red = overdue.
 *
 * A server component: every control is a link rewriting `cv` / `cd` / `cs`.
 */

const KINDS: Record<CalKind, { label: string; dot: string; chip: string }> = {
  ta: { label: "T&A", dot: "bg-info", chip: "bg-info-soft text-info" },
  approval: { label: "Buyer approval", dot: "bg-warning", chip: "bg-warning-soft text-warning" },
  milestone: { label: "Work Flow", dot: "bg-primary", chip: "bg-primary/10 text-primary" },
  cad: { label: "CAD", dot: "bg-success", chip: "bg-success-soft text-success" },
  ship: { label: "Ship date", dot: "bg-foreground/70", chip: "bg-surface-muted text-foreground" },
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const monthTitle = (iso: string) => `${MONTHS_LONG[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const weekday = (iso: string) => WEEKDAYS[(dayOfWeek(iso) + 6) % 7];
const isLate = (e: CalEvent, today: string) => !e.done && e.date < today;

export function MyCalendar({ data, view, cursor }: { data: CalendarData; view: CalView; cursor: string }) {
  const href = (p: { cv?: CalView; cd?: string; cs?: string }) => {
    const q = new URLSearchParams();
    q.set("cv", p.cv ?? view);
    q.set("cd", p.cd ?? cursor);
    if ((p.cs ?? data.scope) === "team") q.set("cs", "team");
    return `/my-calendar?${q.toString()}`;
  };
  const t = data.today;
  const byDate = new Map<string, CalEvent[]>();
  for (const e of data.events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  const title = view === "day" ? `${weekday(cursor)} ${fmtDate(cursor)}` : view === "month" ? monthTitle(cursor) : cursor.slice(0, 4);

  // The header's three counts — what the operator reads before anything else.
  const overdue = data.events.filter((e) => isLate(e, t));
  const onDay = byDate.get(cursor) ?? [];
  const weekEnd = addDays(cursor, 7);
  const next = data.events.filter((e) => e.date > cursor && e.date <= weekEnd);

  return (
    <div className="space-y-3">
      {/* Controls — one header row, `h-9` like every header band here. */}
      <div className="flex flex-wrap items-center gap-2">
        <NavLink href={href({ cd: stepCursor(view, cursor, -1) })} label="Previous">
          <ChevronLeft className="size-4" />
        </NavLink>
        <NavLink href={href({ cd: stepCursor(view, cursor, 1) })} label="Next">
          <ChevronRight className="size-4" />
        </NavLink>
        <h2 className="ml-1 text-base font-semibold tabular-nums">{title}</h2>
        {cursor !== t && (
          <Link href={href({ cv: view, cd: t })} className="text-sm font-semibold text-primary hover:underline">
            Today
          </Link>
        )}
        {data.available && (
          <span className="ml-2 flex flex-wrap gap-1.5 text-xs font-semibold">
            {overdue.length > 0 && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-danger">{overdue.length} overdue</span>}
            {view === "day" && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-warning">{onDay.length} on this day</span>}
            {view === "day" && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-foreground">{next.length} next 7 days</span>}
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {data.canTeam && (
            <Segmented
              active={data.scope}
              items={[
                { key: "mine", label: "Mine", href: href({ cs: "mine" }) },
                { key: "team", label: "Team", href: href({ cs: "team" }) },
              ]}
            />
          )}
          <Segmented
            active={view}
            items={[
              { key: "day", label: "Today", href: href({ cv: "day" }) },
              { key: "month", label: "Month", href: href({ cv: "month" }) },
              { key: "year", label: "Year", href: href({ cv: "year" }) },
            ]}
          />
        </span>
      </div>

      {data.autoTeam && (
        <p className="text-sm text-muted-foreground">Your login is not linked to a staff record, so the team&apos;s calendar is shown.</p>
      )}
      {data.errors.length > 0 && <p className="text-sm text-danger">Could not load: {data.errors.join(" · ")}</p>}

      {!data.available ? (
        <Card className="px-4 py-10 text-center text-sm text-muted-foreground">{data.reason}</Card>
      ) : view === "day" ? (
        <div className="grid gap-3 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <MiniMonth cursor={cursor} byDate={byDate} today={t} dayHref={(d) => href({ cv: "day", cd: d })} />
          <Card className="grid overflow-hidden md:grid-cols-3">
            <Column title="Overdue" tone="danger" empty="Nothing overdue." events={overdue} today={t} showDate />
            <Column title={cursor === t ? "Today" : `${weekday(cursor)} ${fmtDate(cursor)}`} tone="warning" empty="Nothing on this day." events={onDay} today={t} />
            <Column title="Next 7 days" tone="neutral" empty="Nothing in the next 7 days." events={next} today={t} showDate />
          </Card>
        </div>
      ) : view === "month" ? (
        <MonthGrid cursor={cursor} byDate={byDate} today={t} dayHref={(d) => href({ cv: "day", cd: d })} />
      ) : (
        <YearGrid cursor={cursor} byDate={byDate} today={t} monthHref={(m) => href({ cv: "month", cd: m })} />
      )}

      {data.available && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {(Object.keys(KINDS) as CalKind[]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", KINDS[k].dot)} aria-hidden />
              {KINDS[k].label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function NavLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <Link href={href} aria-label={label} className="grid size-9 place-items-center rounded-lg border border-border hover:bg-surface-muted">
      {children}
    </Link>
  );
}

function Segmented({ items, active }: { items: { key: string; label: string; href: string }[]; active: string }) {
  return (
    <div className="inline-flex h-9 items-center rounded-lg border border-border p-0.5 text-sm">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === active ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1 font-semibold",
            i.key === active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-muted",
          )}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}

/* ---- Today ------------------------------------------------------------- */

function MiniMonth({
  cursor,
  byDate,
  today,
  dayHref,
}: {
  cursor: string;
  byDate: Map<string, CalEvent[]>;
  today: string;
  dayHref: (d: string) => string;
}) {
  const month = cursor.slice(0, 7);
  return (
    <Card className="p-3">
      <p className="mb-2 text-center text-sm font-semibold">{monthTitle(cursor)}</p>
      <div className="grid grid-cols-7 pb-1 text-center text-[11px] font-semibold text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w[0]}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {monthGrid(cursor).map((d) => {
          const evs = byDate.get(d) ?? [];
          const late = evs.some((e) => isLate(e, today));
          const kinds = [...new Set(evs.map((e) => e.kind))].slice(0, 3);
          const isToday = d === today;
          return (
            <Link
              key={d}
              href={dayHref(d)}
              title={evs.length ? `${evs.length} on ${fmtDate(d)}` : fmtDate(d)}
              className={cn(
                "flex h-11 flex-col items-center justify-center gap-1 rounded-lg text-xs tabular-nums",
                isToday ? "bg-primary text-primary-foreground" : late ? "bg-danger-soft hover:bg-danger-soft" : "hover:bg-surface-muted",
                d === cursor && !isToday && "ring-2 ring-primary",
                d.slice(0, 7) !== month && !isToday && "text-muted-foreground/50",
              )}
            >
              <span className={cn("font-semibold", late && !isToday && "text-danger")}>{Number(d.slice(8))}</span>
              <span className="flex h-1.5 gap-0.5">
                {kinds.map((k) => (
                  <span key={k} className={cn("size-1.5 rounded-full", isToday ? "bg-primary-foreground" : KINDS[k].dot)} />
                ))}
              </span>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

function Column({
  title,
  tone,
  empty,
  events,
  today,
  showDate = false,
}: {
  title: string;
  tone: "danger" | "warning" | "neutral";
  empty: string;
  events: CalEvent[];
  today: string;
  showDate?: boolean;
}) {
  const SHOWN = 8;
  const head = { danger: "text-danger", warning: "text-warning", neutral: "text-foreground" }[tone];
  return (
    <section className={cn("flex min-w-0 flex-col gap-2 border-border p-3 md:border-r md:last:border-r-0", tone === "danger" && events.length > 0 && "bg-danger-soft/40")}>
      <h3 className={cn("text-xs font-bold uppercase tracking-wide", head)}>
        {title} · {events.length}
      </h3>
      {events.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {events.slice(0, SHOWN).map((e) => (
            <EventCard key={e.id} e={e} today={today} showDate={showDate} />
          ))}
        </ul>
      )}
      {events.length > SHOWN && <p className="text-xs text-muted-foreground">+{events.length - SHOWN} more</p>}
    </section>
  );
}

function EventCard({ e, today, showDate }: { e: CalEvent; today: string; showDate: boolean }) {
  const late = isLate(e, today);
  const daysLate = late ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${e.date}T00:00:00Z`)) / 86_400_000) : 0;
  const pill = late
    ? { text: `${daysLate} d late`, cls: "bg-danger-soft text-danger" }
    : e.done && e.kind !== "ship"
      ? { text: "Done", cls: "bg-success-soft text-success" }
      : showDate
        ? { text: `${weekday(e.date)} ${e.date.slice(8)}`, cls: "bg-surface-muted text-foreground" }
        : null;
  return (
    <li>
      <Link href={e.href} className="flex flex-col gap-0.5 rounded-lg border border-border px-2.5 py-2 hover:bg-surface-muted">
        <span className="flex items-center gap-2">
          <span className={cn("size-2 shrink-0", e.kind === "ship" ? "rounded-[2px]" : "rounded-full", KINDS[e.kind].dot)} aria-hidden />
          <span className="min-w-0 flex-1 text-sm font-semibold">
            <Truncated text={e.title} />
          </span>
          {pill && <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", pill.cls)}>{pill.text}</span>}
        </span>
        {e.reNo && <span className="pl-4 text-xs text-muted-foreground">{e.reNo}</span>}
      </Link>
    </li>
  );
}

/* ---- Month ------------------------------------------------------------- */

function MonthGrid({
  cursor,
  byDate,
  today,
  dayHref,
}: {
  cursor: string;
  byDate: Map<string, CalEvent[]>;
  today: string;
  dayHref: (d: string) => string;
}) {
  const month = cursor.slice(0, 7);
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border text-xs font-semibold text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <span key={w} className="px-2 py-2">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {monthGrid(cursor).map((d) => {
          const evs = byDate.get(d) ?? [];
          return (
            <Link
              key={d}
              href={dayHref(d)}
              className={cn(
                "flex min-h-24 min-w-0 flex-col gap-1 border-b border-r border-border p-1.5 hover:bg-surface-muted",
                d.slice(0, 7) !== month && "bg-surface-muted/50",
                d === today && "ring-2 ring-inset ring-primary",
              )}
            >
              <span className={cn("text-xs font-bold tabular-nums", d.slice(0, 7) !== month && "text-muted-foreground/60", d === today && "text-primary")}>
                {Number(d.slice(8))}
              </span>
              {evs.slice(0, 3).map((e) => (
                <span
                  key={e.id}
                  className={cn("min-w-0 rounded px-1.5 py-0.5 text-[11px] font-semibold", isLate(e, today) ? "bg-danger-soft text-danger" : KINDS[e.kind].chip)}
                >
                  <Truncated text={e.reNo ? `${e.title} · ${e.reNo}` : e.title} touch={false} />
                </span>
              ))}
              {evs.length > 3 && <span className="text-[11px] font-semibold text-muted-foreground">+{evs.length - 3} more</span>}
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

/* ---- Year -------------------------------------------------------------- */

function YearGrid({
  cursor,
  byDate,
  today,
  monthHref,
}: {
  cursor: string;
  byDate: Map<string, CalEvent[]>;
  today: string;
  monthHref: (m: string) => string;
}) {
  const y = cursor.slice(0, 4);
  return (
    <Card className="p-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {MONTHS.map((label, i) => {
          const first = `${y}-${String(i + 1).padStart(2, "0")}-01`;
          const days = monthDays(first);
          const evs = days.flatMap((d) => byDate.get(d) ?? []);
          const late = evs.filter((e) => isLate(e, today)).length;
          const lead = (dayOfWeek(first) + 6) % 7;
          return (
            <Link key={label} href={monthHref(first)} className="rounded-lg border border-border p-2 hover:bg-surface-muted">
              <p className="mb-1.5 flex items-baseline justify-between text-xs">
                <span className="font-bold">{label}</span>
                <span className={cn("tabular-nums", late ? "font-semibold text-danger" : "text-muted-foreground")}>
                  {evs.length ? (late ? `${late} late · ${evs.length}` : evs.length) : ""}
                </span>
              </p>
              <div className="grid grid-cols-7 gap-[3px]">
                {Array.from({ length: lead }, (_, k) => (
                  <span key={`b${k}`} />
                ))}
                {days.map((d) => {
                  const list = byDate.get(d) ?? [];
                  const n = list.length;
                  const dayLate = list.some((e) => isLate(e, today));
                  return (
                    <span
                      key={d}
                      className={cn(
                        "aspect-square rounded-[3px]",
                        dayLate ? "bg-danger" : n >= 4 ? "bg-primary" : n >= 2 ? "bg-primary/60" : n === 1 ? "bg-primary/30" : "bg-surface-muted",
                        d === today && "ring-2 ring-foreground",
                      )}
                    />
                  );
                })}
              </div>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
