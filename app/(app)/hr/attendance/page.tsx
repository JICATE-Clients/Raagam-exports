import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { today } from "@/lib/calendar";
import {
  listActiveWorkers,
  getAttendanceForDate,
  getAttendanceForMonth,
  getHolidaysForMonth,
  getLeaveForMonth,
} from "@/lib/hr/attendance-service";
import { getLocations, getSettings } from "@/lib/hr/masters-service";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { filterHrDashboard, getHrDashboard } from "@/lib/hr/dashboard-service";
import { HrDashboardFilter } from "@/components/hr/dashboard-filter";
import type { PersonKind } from "@/lib/masters/category-timing-types";
import { HrDashboardView } from "../dashboard/hr-dashboard";
import AttendanceClient from "./attendance-client";
import MusterClient from "./muster-client";

interface Props {
  searchParams: Promise<{
    date?: string;
    location?: string;
    view?: string;
    month?: string;
    /** The report's Staff | Worker side and departments (?show= is read in the browser). */
    kind?: string;
    dept?: string;
    /** The report's day (not `date`, which is the Day sheet's). */
    day?: string;
  }>;
}

/**
 * ATTENDANCE REPORT FIRST (user 2026-11-03: "in attendance report there should
 * be only the up cards and this whole thing from the dashboard"). With no
 * `view` and no `date` this page is the dashboard's ten cards and its People
 * table — the same `HrDashboardView`, in its `report` variant, so the two can
 * never count a day differently. The Day sheet and Month muster below are
 * still here at `?view=day` / `?view=month` (and a bare `?date=`, which their
 * own date pickers push): the dashboard's "Fix" on a missing Out opens the
 * Day sheet, so they stay reachable rather than being deleted.
 *
 * TWO VIEWS OF ONE THING, AT ONE URL. `?view=month` is the muster roll and
 * the default is the day entry sheet. Live left this page on 2026-11-02 for its
 * own sidebar row (`/hr/live`, user: "this only live thing can come under as
 * name Live after the Leave & Encashment"); a stale `?view=live` lands on the
 * report (see the redirect below for why not on Live).
 *
 * NOT A SECOND SIDEBAR ROW, deliberately. The month grid is the same table,
 * read through the same location filter, and a cell on it links to the day
 * sheet — registering it as its own leaf would put a row beneath a row in the
 * nav (the rule in AGENTS.md) and split one screen's filters across two.
 */
export default async function AttendancePage({ searchParams }: Props) {
  await requirePermission("hr_payroll", "view");

  const { date, location, view, month, kind: kindParam, dept, day } = await searchParams;
  const locationId = location || null;
  const isMonth = view === "month";
  /*
   * `?view=live` LANDS HERE, NOT ON LIVE (user 2026-11-03: "if I click
   * attendance report it again goes to the live"). The workspace tabs remember
   * each screen's last query (lib/workspace-tabs.ts) and the sidebar row
   * reopens a screen as it was left — so an Attendance tab last standing on
   * ?view=live was sent to /hr/live by the redirect that used to be here, on
   * every click, forever. Dropping the query instead lets the tab remember the
   * bare address. Nothing links to ?view=live any more; Live is /hr/live.
   */
  if (view === "live") redirect("/hr/attendance");

  if ((!view || view === "report") && !date) {
    // The dashboard page's own reading of ?kind / ?dept (hr/dashboard/page.tsx).
    const kind: PersonKind = kindParam === "worker" ? "worker" : "staff";
    const depts = (dept ?? "")
      .split(",")
      .filter(Boolean)
      .map((d) => (d === "none" ? "" : d));
    const full = await getHrDashboard(new Date().getTime(), day);
    const todayIso = today();
    const shown = filterHrDashboard(full, { kind, depts });
    const counts = {
      staff: full.groups.find((g) => g.group === "staff")?.people.length ?? 0,
      worker: full.groups.find((g) => g.group === "worker")?.people.length ?? 0,
    };
    return (
      <HrDashboardView
        variant="report"
        data={shown.data}
        query={new URLSearchParams({ kind, ...(dept ? { dept } : {}), ...(full.live ? {} : { day: full.day }) }).toString()}
        filter={<HrDashboardFilter kind={kind} counts={counts} depts={shown.depts} picked={shown.picked} day={full.day} today={todayIso} />}
        peopleFilter={
          <HrDashboardFilter variant="table" kind={kind} counts={counts} depts={shown.depts} picked={shown.picked} day={full.day} today={todayIso} />
        }
      />
    );
  }

  const locationParam = locationId ? `&location=${locationId}` : "";
  const tabs = [
    {
      label: "Day",
      href: `/hr/attendance?view=day${locationParam}`,
      on: !isMonth,
    },
    { label: "Month", href: `/hr/attendance?view=month${locationParam}`, on: isMonth },
  ];
  const viewSwitch = (
    <div className="flex rounded-lg border border-border bg-surface p-0.5">
      {tabs.map((t) => (
        <Link
          key={t.label}
          href={t.href}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium",
            t.on
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );

  // The factory's calendar date (IST), not the server's. Vercel runs in UTC,
  // so `new Date().toISOString()` / `getMonth()` answered with YESTERDAY for
  // the first 5½ hours of every day — and the month view with last month on
  // the 1st until 05:30. `today()` is the app's one IST date (lib/calendar.ts).
  const todayIst = today();

  if (isMonth) {
    // "YYYY-MM", and it stays a string: see the note on dates in
    // attendance-service. `new Date(y, m, 0)` is the one Date used here and it
    // only counts days — day 0 of the NEXT month is the last day of this one.
    const selectedMonth = month ?? todayIst.slice(0, 7);
    const year = Number(selectedMonth.slice(0, 4));
    const mon = Number(selectedMonth.slice(5, 7));
    const daysInMonth = new Date(year, mon, 0).getDate();
    const from = `${selectedMonth}-01`;
    const to = `${selectedMonth}-${String(daysInMonth).padStart(2, "0")}`;

    const [workers, attendance, holidays, leave, locations] = await Promise.all([
      listActiveWorkers(locationId),
      getAttendanceForMonth(from, to, locationId),
      getHolidaysForMonth(from, to),
      getLeaveForMonth(from, to),
      getLocations(),
    ]);

    return (
      <div className="space-y-4">
        <PageHeader
          title="Muster Roll"
          description="A month of attendance, one row per worker."
          actions={viewSwitch}
        />
        <MusterClient
          workers={workers}
          attendance={attendance}
          holidays={holidays}
          leave={leave}
          locations={locations}
          month={selectedMonth}
          daysInMonth={daysInMonth}
          selectedLocationId={locationId}
        />
      </div>
    );
  }

  const selectedDate = date ?? todayIst;

  const [workers, existing, locations, settings] = await Promise.all([
    listActiveWorkers(locationId),
    getAttendanceForDate(selectedDate, locationId),
    getLocations(),
    getSettings(),
  ]);

  // Build a map of existing attendance keyed by worker_id
  const attendanceByWorker = Object.fromEntries(
    existing.map((a) => [a.worker_id, a]),
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Attendance Entry"
        description="Record daily attendance, OT, and extra hours for workers."
        actions={viewSwitch}
      />
      {/*
        KEYED BY DATE + LOCATION. The sheet seeds its rows with a `useState`
        initialiser, which runs once per mount — and Load only changes the URL,
        so without a key the same instance stayed mounted and showed the
        PREVIOUS date's ticks under the new date. Saving then wrote them onto
        the wrong day. A new key is a fresh sheet for every date loaded.
      */}
      <AttendanceClient
        key={`${selectedDate}|${locationId ?? ""}`}
        workers={workers}
        attendanceByWorker={attendanceByWorker}
        locations={locations}
        selectedDate={selectedDate}
        selectedLocationId={locationId}
        maxOtPerDay={settings?.max_ot_hours_per_day ?? 4}
      />
    </div>
  );
}
