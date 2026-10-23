import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
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
import {
  listDevices,
  listPunchesToday,
  countPunchesToday,
  getPunchIdentities,
} from "@/lib/hr/punch-service";
import AttendanceClient from "./attendance-client";
import MusterClient from "./muster-client";
import LiveClient from "./live-client";

interface Props {
  searchParams: Promise<{
    date?: string;
    location?: string;
    view?: string;
    month?: string;
  }>;
}

/**
 * THREE VIEWS OF ONE THING, AT ONE URL. `?view=month` is the muster roll,
 * `?view=live` is what the biometric devices are sending right now, and the
 * default is the day entry sheet.
 *
 * NOT A SECOND SIDEBAR ROW, deliberately. The month grid is the same table,
 * read through the same location filter, and a cell on it links to the day
 * sheet — registering it as its own leaf would put a row beneath a row in the
 * nav (the rule in AGENTS.md) and split one screen's filters across two.
 */
export default async function AttendancePage({ searchParams }: Props) {
  await requirePermission("hr_payroll", "view");

  const { date, location, view, month } = await searchParams;
  const locationId = location || null;
  const isMonth = view === "month";
  const isLive = view === "live";

  const locationParam = locationId ? `&location=${locationId}` : "";
  const tabs = [
    {
      label: "Day",
      href: `/hr/attendance?view=day${locationParam}`,
      on: !isMonth && !isLive,
    },
    { label: "Month", href: `/hr/attendance?view=month${locationParam}`, on: isMonth },
    { label: "Live", href: `/hr/attendance?view=live`, on: isLive },
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

  if (isLive) {
    /**
     * ADMINS ONLY (user 2026-10-23). The page above is gated on `hr_payroll`
     * view, which is every HR user; this tab is one step tighter because what
     * it shows is the RAW device feed — a user id as enrolled on a reader,
     * with no person behind it yet. That is a diagnostic, not an HR record,
     * and it is the wrong thing to put in front of someone looking for
     * somebody's attendance.
     *
     * `has_permission` bypasses for a super admin, so this needs no change to
     * 0733's RLS: an admin already reads `punches` through the `hr_payroll`
     * policy. Widen to HR admins by also accepting `hr_payroll` edit.
     */
    await requirePermission("system_admin", "view");

    /**
     * The IST day boundary and the clock are both resolved HERE, on the server,
     * and handed down as props — `live-client.tsx` must not call `Date.now()`
     * in a render (impure, and it would be the viewer's clock rather than the
     * one the punches were stamped against).
     *
     * No location filter: a punch is scoped by its DEVICE's unit through RLS,
     * not by this screen's picker, so narrowing it here would hide rows the
     * viewer is entitled to see.
     */
    const serverNowIso = new Date().toISOString();
    const todayIst = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
    }).format(new Date(serverNowIso));
    const todayFromIso = `${todayIst}T00:00:00+05:30`;

    const [devices, punches, todayCount, identities, deviceLocations] =
      await Promise.all([
        listDevices(),
        listPunchesToday(todayFromIso),
        countPunchesToday(todayFromIso),
        getPunchIdentities(),
        getLocations(),
      ]);

    return (
      <div className="space-y-4">
        <PageHeader
          title="Live Punches"
          description="What the biometric devices are sending, as it arrives."
          actions={viewSwitch}
        />
        <LiveClient
          devices={devices}
          punches={punches}
          identities={identities}
          locations={deviceLocations}
          todayCount={todayCount}
          todayFromIso={todayFromIso}
          serverNowIso={serverNowIso}
        />
      </div>
    );
  }

  if (isMonth) {
    // "YYYY-MM", and it stays a string: see the note on dates in
    // attendance-service. `new Date(y, m, 0)` is the one Date used here and it
    // only counts days — day 0 of the NEXT month is the last day of this one.
    const now = new Date();
    const selectedMonth =
      month ??
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
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

  const today = new Date().toISOString().split("T")[0];
  const selectedDate = date ?? today;

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
      <AttendanceClient
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
