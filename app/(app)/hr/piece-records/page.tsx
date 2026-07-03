import { requirePermission, can } from "@/lib/auth/server";
import { getPieceRecords } from "@/lib/hr/attendance-service";
import { listActiveWorkers } from "@/lib/hr/attendance-service";
import { getLocations, getOrdersForPicker } from "@/lib/hr/masters-service";
import { PageHeader } from "@/components/ui/page-header";
import PieceRecordsClient from "./piece-records-client";

interface Props {
  searchParams: Promise<{ date?: string; worker?: string; location?: string }>;
}

export default async function PieceRecordsPage({ searchParams }: Props) {
  await requirePermission("hr_payroll", "view");

  const { date, worker, location } = await searchParams;
  const today = new Date().toISOString().split("T")[0];
  const selectedDate = date ?? today;
  const locationId = location || null;

  const [records, workers, locations, orders, canExport] = await Promise.all([
    getPieceRecords({
      date: selectedDate,
      workerId: worker,
      locationId,
    }),
    listActiveWorkers(locationId),
    getLocations(),
    getOrdersForPicker(),
    can("hr_payroll", "export"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Piece Records"
        description="Enter and correct piece counts per worker per day."
      />
      <PieceRecordsClient
        records={records}
        workers={workers}
        locations={locations}
        orders={orders}
        selectedDate={selectedDate}
        selectedLocationId={locationId}
        selectedWorkerId={worker ?? null}
        canExport={canExport}
      />
    </div>
  );
}
