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
import AttendanceClient from "./attendance-client";
import MusterClient from "./muster-client";

interface Props {
  searchParams: Promise<{
    date?: string;
    location?: string;
    view?: string;
    month?: string;
  }>;
}

/**
 * TWO VIEWS OF ONE THING, AT ONE URL. `?view=month` is the muster roll; the
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

  const locationParam = locationId ? `&location=${locationId}` : "";
  const tabs = [
    { label: "Day", href: `/hr/attendance?view=day${locationParam}`, on: !isMonth },
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
