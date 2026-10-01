import { requireUser } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import { getCalendar } from "@/lib/my-calendar/data";
import { calendarWindow, readCalParams, type CalParams } from "@/lib/my-calendar/view";
import { PageHeader } from "@/components/ui/page-header";
import { MyCalendar } from "@/components/my-calendar/my-calendar";

/**
 * MY CALENDAR (user 2026-10-01) — a page of its own: on the Dashboard the
 * calendar "took one page content". Opened from the Dashboard banner's
 * "My calendar" button.
 *
 * `requireUser`, not `requirePermission`: every login has one. What it holds
 * needs Orders access, and `getCalendar` says so on the page when it is
 * missing rather than refusing the route.
 */
export default async function MyCalendarPage({ searchParams }: { searchParams: Promise<CalParams> }) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const cal = readCalParams(sp, today());
  const data = await getCalendar(user, {
    scope: cal.scope,
    ...calendarWindow(cal.view, cal.cursor),
    withOverdue: cal.view === "day",
  });
  return (
    <div className="mx-auto max-w-[90rem] space-y-4">
      <PageHeader
        title="My Calendar"
        description="Your T&A tasks, buyer approvals, Work Flow milestones, CAD work and ship dates — by day, month or year."
      />
      <MyCalendar data={data} view={cal.view} cursor={cal.cursor} />
    </div>
  );
}
