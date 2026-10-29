import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SEG_IDLE, SEG_ITEM, SEG_LIT, SEG_TRACK } from "@/components/ui/segmented";
import { StatusPill } from "@/components/ui/status-pill";
import { EventCard, KINDS } from "@/components/my-calendar/my-calendar";
import { GLASS } from "@/components/dashboard/glass";
import { dashHref, type Carry } from "@/components/dashboard/hero";
import { addDays } from "@/lib/calendar";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AppUser } from "@/lib/auth/types";
import { getCalendar, type CalEvent, type CalKind, type CalScope } from "@/lib/my-calendar/data";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** How many of the chosen day's items the panel lists before "+N more". */
const SHOWN = 3;

/** Monday of the week holding `iso` (YYYY-MM-DD, read as UTC so no DST drift). */
function mondayOf(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
}
const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/**
 * THE CALENDAR PANEL, ONE WEEK AT A GLANCE (user 2026-10-29, plan
 * https://claude.ai/artifact/HR3L5D6gDKbcvLS3Cj1S9v: the month grid, its
 * five-word legend and the day list made this the tallest card on the page).
 *
 * Seven day cells with a coloured dot per kind of work due (My Calendar's own
 * `KINDS` colours, named in each cell's tooltip in place of the legend), the
 * overdue count, and the picked day's first few items. ‹ › step a week. The
 * full Today · Month · Year page is one link away. Same `getCalendar` and the
 * same Mine / Team rule, so this cannot disagree with My Calendar.
 *
 * Every control is a link rewriting `cd` (the chosen day) and `cs` (scope) on
 * `/`, carrying the period and filters, so picking a day never resets the
 * figures beside it.
 */
export async function CalendarSection({
  user,
  cursor,
  scope,
  carry,
}: {
  user: AppUser;
  cursor: string;
  scope: CalScope;
  carry: Carry;
}) {
  const monday = mondayOf(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const data = await getCalendar(user, { scope, from: days[0], to: days[6], withOverdue: true });
  const t = data.today;
  const href = (set: Carry) => dashHref(carry, set);
  const dayHref = (d: string) => href({ cd: d });

  const byDate = new Map<string, CalEvent[]>();
  for (const e of data.events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  const onDay = byDate.get(cursor) ?? [];
  const overdue = data.events.filter((e) => !e.done && e.date < t).length;
  // Today's own work is the welcome card's list; repeating it here put the same
  // rows on screen twice. Team, or another day, still lists.
  const todayInCard = cursor === t && data.scope === "mine" && !data.autoTeam;
  const full = `/my-calendar?cv=day&cd=${cursor}${data.scope === "team" ? "&cs=team" : ""}`;
  const thisWeek = days.includes(t);

  return (
    <Card className={cn(GLASS, "flex min-w-0 flex-col gap-2.5 p-4 pt-3")}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-heading">{thisWeek ? "This week" : `${dayMonth(days[0])} – ${dayMonth(days[6])}`}</h2>
        <div className="flex items-center gap-1.5">
          {data.canTeam && (
            <div role="group" aria-label="Whose calendar" data-segmented="" className={SEG_TRACK}>
              {(["mine", "team"] as const).map((k) => (
                <Link
                  key={k}
                  href={href({ cs: k === "team" ? "team" : undefined })}
                  aria-current={data.scope === k ? "true" : undefined}
                  className={cn(SEG_ITEM, data.scope === k ? SEG_LIT : SEG_IDLE)}
                >
                  {k === "mine" ? "Mine" : "Team"}
                </Link>
              ))}
            </div>
          )}
          <Link href={dayHref(addDays(cursor, -7))} aria-label="Previous week" className="grid size-8 place-items-center rounded-control hover:bg-surface-muted">
            <ChevronLeft className="size-4" />
          </Link>
          <Link href={dayHref(addDays(cursor, 7))} aria-label="Next week" className="grid size-8 place-items-center rounded-control hover:bg-surface-muted">
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </div>

      {!data.available ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{data.reason}</p>
      ) : (
        <>
          {data.autoTeam && (
            <p className="text-xs text-muted-foreground">Your login is not linked to a staff record, so the team&apos;s calendar is shown.</p>
          )}

          <div className="grid grid-cols-7 gap-1">
            {days.map((d, i) => {
              const evs = byDate.get(d) ?? [];
              const kinds = [...new Set(evs.map((e) => e.kind))] as CalKind[];
              const isToday = d === t;
              const picked = d === cursor;
              const tip = evs.length
                ? `${fmtDate(d)} · ${kinds.map((k) => `${evs.filter((e) => e.kind === k).length} ${KINDS[k].label}`).join(", ")}`
                : `${fmtDate(d)} · nothing due`;
              return (
                <Link
                  key={d}
                  href={dayHref(d)}
                  title={tip}
                  aria-current={picked ? "date" : undefined}
                  className={cn(
                    "flex flex-col items-center rounded-lg border border-transparent py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-surface-muted",
                    isToday && "bg-primary text-primary-foreground hover:bg-primary",
                    picked && !isToday && "border-primary",
                  )}
                >
                  {WEEKDAYS[i]}
                  <b className={cn("text-sm tabular-nums", isToday ? "text-primary-foreground" : "text-foreground")}>{Number(d.slice(8, 10))}</b>
                  <span className="mt-0.5 flex h-1.5 gap-0.5" aria-hidden>
                    {kinds.slice(0, 3).map((k) => (
                      <span key={k} className={cn("size-1.5 rounded-full", isToday ? "bg-primary-foreground" : KINDS[k].dot)} />
                    ))}
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-[var(--glass-edge)] pt-2.5">
            <h3 className="text-[13px] font-semibold">{cursor === t ? "Today" : fmtDate(cursor)}</h3>
            <span className="flex gap-1.5">
              {overdue > 0 && <StatusPill tone="danger">{overdue} overdue</StatusPill>}
              {!todayInCard && <StatusPill tone="neutral">{onDay.length} due</StatusPill>}
            </span>
          </div>
          {todayInCard ? (
            <p className="text-xs text-muted-foreground">Today&apos;s work is at the top of the dashboard. Pick a day to see its work.</p>
          ) : onDay.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing due on this day.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {onDay.slice(0, SHOWN).map((e) => (
                <EventCard key={e.id} e={e} today={t} showDate={false} />
              ))}
            </ul>
          )}
          {data.errors.length > 0 && <p className="text-xs text-danger">Could not load: {data.errors.join(" · ")}</p>}
          <Link href={full} className="text-xs font-semibold text-primary hover:underline">
            {!todayInCard && onDay.length > SHOWN ? `+${onDay.length - SHOWN} more · ` : ""}Open full calendar →
          </Link>
        </>
      )}
    </Card>
  );
}
