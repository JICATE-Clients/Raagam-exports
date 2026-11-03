import Link from "next/link";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SEG_IDLE, SEG_ITEM, SEG_LIT, SEG_TRACK } from "@/components/ui/segmented";
import { Tooltip } from "@/components/ui/tooltip";
import { CardTitle } from "@/components/dashboard/card-title";
import { WeekGlance } from "@/components/dashboard/week-glance";
import { GLASS } from "@/components/dashboard/glass";
import { dashHref, type Carry } from "@/components/dashboard/hero";
import { addDays } from "@/lib/calendar";
import { cn } from "@/lib/utils";
import type { AppUser } from "@/lib/auth/types";
import { getCalendar, type CalScope } from "@/lib/my-calendar/data";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
 * Seven day cells, each a stacked bar of the work due by kind (2026-11-02,
 * `WeekGlance`: load at a glance, the legend is the filter), the overdue count,
 * and the picked day's first few items. ‹ › step a week. The
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

  const thisWeek = days.includes(t);

  return (
    <Card className={cn(GLASS, "flex min-w-0 flex-col gap-2 overflow-hidden px-4 pb-3 pt-2.5")}>
      {/* ONE HEADER LINE (user 2026-11-03, screenshot 141715: "This week / 2 Nov – 8 Nov, fix
          this section"). The title and its dates each wrapped onto two lines because the
          Mine/Team switch and both arrows shared the row. Now the arrows sit either side of
          the dates UNDER the title — they move the dates, so that is where they belong — and
          only the switch stays on the right. */}
      <div className="flex items-center justify-between gap-2">
        <CardTitle
          className="min-w-0"
          title={thisWeek ? "This week" : "Week"}
          subtitle={
            <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
              <Link href={dayHref(addDays(cursor, -7))} aria-label="Previous week" className="-ml-1 grid size-5 place-items-center rounded hover:bg-surface-muted hover:text-foreground">
                <ChevronLeft className="size-3.5" />
              </Link>
              <span className="tabular-nums">
                {dayMonth(days[0])} – {dayMonth(days[6])}
              </span>
              <Link href={dayHref(addDays(cursor, 7))} aria-label="Next week" className="grid size-5 place-items-center rounded hover:bg-surface-muted hover:text-foreground">
                <ChevronRight className="size-3.5" />
              </Link>
            </span>
          }
          icon="calendar"
          tone="info"
        />
        <div className="flex shrink-0 items-center gap-1.5">
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
          {/* The "login not linked" sentence is this ⓘ (2026-11-02) — it took a whole line. */}
          {data.autoTeam && (
            <Tooltip label="Login not linked to a staff record — showing the team's calendar." touch>
              <span
                tabIndex={0}
                aria-label="Login not linked to a staff record — showing the team's calendar."
                className="grid size-5 place-items-center rounded-full border border-border text-muted-foreground"
              >
                <Info className="size-3" aria-hidden />
              </span>
            </Tooltip>
          )}
        </div>
      </div>

      {!data.available ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{data.reason}</p>
      ) : (
        <>

          <WeekGlance
            days={days}
            // A DAY OPENS MY CALENDAR on that day — the list under the week is gone (2026-11-02).
            dayHrefs={days.map((d) => `/my-calendar?cv=day&cd=${d}${data.scope === "team" ? "&cs=team" : ""}`)}
            cursor={cursor}
            today={t}
            events={data.events}
          />
          {data.errors.length > 0 && <p className="text-xs text-danger">Could not load: {data.errors.join(" · ")}</p>}
        </>
      )}
    </Card>
  );
}
