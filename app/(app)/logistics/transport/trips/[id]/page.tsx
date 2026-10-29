import { notFound } from "next/navigation";
import { can, requirePermission } from "@/lib/auth/server";
import { getTrip } from "@/lib/logistics/transport/service";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { tripDistanceKm } from "@/lib/logistics/transport/logic";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import {
  TRANSPORT_SOURCE_KIND_LABEL,
  TRANSPORT_STATUS_LABEL,
  type Requisition,
  type TripAllocation,
} from "@/lib/logistics/transport/types";
import { Pair, TransportStatusPill, UtilisationBar, fmtKg } from "../../_shared/transport-ui";
import { TripActions } from "./trip-actions";
import { CompleteTripForm } from "./complete-trip-form";

const orderNo = (r: { source_kind: string; source_no: string | null }) =>
  r.source_kind === "ho" ? TRANSPORT_SOURCE_KIND_LABEL.ho : (r.source_no ?? "—");

const tripRequestColumns: Column<Requisition>[] = [
  { header: "Request No", cell: (r) => <span className="text-sm font-medium">{r.req_no}</span> },
  { header: "Order", cell: (r) => <span className="text-sm">{orderNo(r)}</span> },
  { header: "From → To", cell: (r) => <span className="text-sm">{`${r.origin_name} → ${r.destination_name}`}</span> },
  { header: "Material", cell: (r) => <span className="text-sm">{r.material_type}</span> },
  { header: "Weight", align: "right", cell: (r) => <span className="text-sm tabular-nums">{fmtKg(r.material_weight_kg)}</span> },
];

const allocationColumns: Column<TripAllocation>[] = [
  { header: "Order", cell: (a) => <span className="text-sm">{orderNo(a)}</span> },
  { header: "Weight", align: "right", cell: (a) => <span className="text-sm tabular-nums">{fmtKg(a.weight_kg)}</span> },
  { header: "Share", align: "right", cell: (a) => <span className="text-sm tabular-nums">{a.weight_pct.toFixed(2)}%</span> },
  { header: "Cost", align: "right", cell: (a) => <span className="text-sm tabular-nums">{fmtMoney(a.allocated_cost)}</span> },
];

/**
 * LOGISTICS ▸ TRANSPORT ▸ TRIP — the trip as a DOCUMENT (plan Screens 6),
 * modelled on the shipment page (`/logistics/[shipmentId]`): a header with the
 * status pill, a label · value band, then the trip's own tables.
 *
 * Every table here is part of the document, so `paginate={false}` on all three
 * (AGENTS.md "Pagination": a 12-request trip shown as 10 + Next hides lines).
 *
 * THE COMPLETE FORM appears while the trip is unloading, and ALSO on a trip the
 * GPS has already completed but nobody has costed — a geofence exit finishes the
 * run, it cannot know what the diesel cost. Once allocations exist the form gives
 * way to the allocation table and the trip is closed.
 */
export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("logistics", "view");
  const { id } = await params;
  const [trip, canEdit] = await Promise.all([getTrip(id), can("logistics", "edit")]);
  if (!trip) notFound();

  const costed = trip.allocations.length > 0;
  const canComplete = canEdit && !costed && (trip.trip_status === "unloading" || trip.trip_status === "completed");
  const distance = tripDistanceKm(trip.start_odometer_km, trip.end_odometer_km);
  const events = [...trip.events].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Trip ${trip.trip_no}`}
        description={`${trip.vehicle_number} · ${trip.driver_name}`}
        actions={
          <div className="flex items-center gap-2">
            <TransportStatusPill status={trip.trip_status} />
            {canEdit && <TripActions tripId={trip.id} status={trip.trip_status} />}
          </div>
        }
      />

      <dl className="flex flex-wrap gap-x-8 gap-y-3 rounded-lg border border-border bg-surface px-4 py-3">
        <Pair label="Vehicle">{trip.vehicle_number}</Pair>
        <Pair label="Driver">
          {trip.driver_name}
          {trip.driver_phone ? ` · ${trip.driver_phone}` : ""}
        </Pair>
        <Pair label="Route">
          {trip.origin_names.join(", ") || "—"} → {trip.destination_names.join(", ") || "—"}
        </Pair>
        <Pair label="Dispatched">{fmtDateTime(trip.planned_at)}</Pair>
        <Pair label="Completed">{fmtDateTime(trip.completed_at)}</Pair>
        <Pair label="Odometer">
          {trip.start_odometer_km ?? "—"} → {trip.end_odometer_km ?? "—"}
          {distance != null ? ` (${distance} km)` : ""}
        </Pair>
        {costed && <Pair label="Trip Cost">{fmtMoney(trip.total_cost)}</Pair>}
        <div className="min-w-[14rem]">
          <dt className="text-xs text-muted-foreground">
            Load {fmtKg(trip.total_loaded_weight_kg)} of {fmtKg(trip.max_payload_kg)}
          </dt>
          <dd className="pt-1">
            <UtilisationBar pct={trip.utilisation_pct} />
          </dd>
        </div>
      </dl>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-heading">Requests on this trip</h2>
        <DataTable columns={tripRequestColumns} rows={trip.requisitions} getKey={(r) => r.id} paginate={false} compact />
      </section>

      {canComplete && (
        <section id="complete" className="space-y-2">
          <h2 className="text-sm font-semibold text-heading">Complete the trip</h2>
          <CompleteTripForm trip={trip} />
        </section>
      )}

      {costed && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-heading">Cost by order · {fmtMoney(trip.total_cost)}</h2>
          <div className="w-fit max-w-full">
            <DataTable
              columns={allocationColumns}
              rows={trip.allocations}
              getKey={(a) => a.requisition_id}
              paginate={false}
              compact
            />
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-heading">Events</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        ) : (
          <ol className="space-y-2 border-l-2 border-border pl-4">
            {events.map((e) => (
              <li key={e.id} className="text-sm">
                <span className="tabular-nums text-muted-foreground">{fmtDateTime(e.at)}</span>
                {" · "}
                {e.from_status ? `${TRANSPORT_STATUS_LABEL[e.from_status]} → ` : "Dispatched → "}
                <span className="font-medium">{TRANSPORT_STATUS_LABEL[e.to_status]}</span>
                <span className="text-muted-foreground">
                  {" · "}
                  {e.source === "gps" ? "GPS" : (e.by_name ?? "Manual")}
                  {e.note ? ` · ${e.note}` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
