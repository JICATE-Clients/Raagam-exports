import { requirePermission } from "@/lib/auth/server";
import { listActiveWorkers, getAttendanceForDate } from "@/lib/hr/attendance-service";
import { getLocations, getSettings } from "@/lib/hr/masters-service";
import { PageHeader } from "@/components/ui/page-header";
import AttendanceClient from "./attendance-client";

interface Props {
  searchParams: Promise<{ date?: string; location?: string }>;
}

export default async function AttendancePage({ searchParams }: Props) {
  await requirePermission("hr_payroll", "view");

  const { date, location } = await searchParams;
  const today = new Date().toISOString().split("T")[0];
  const selectedDate = date ?? today;
  const locationId = location || null;

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
