"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { checkDuplicateName } from "@/lib/masters/dup-guard";
import { notify } from "@/lib/notifications/notify";
import { allocateCost, canTransition, tripTotalCost } from "./logic";
import { applyTripEvent as applyTripEventWith } from "./trip-events";
import { orderSourceOptions } from "./service";
import {
  completeTripInput,
  dispatchInput,
  placeInput,
  requisitionInput,
  vehicleInput,
  type CompleteTripInput,
  type DispatchInput,
  type PlaceInput,
  type RequisitionInput,
  type TransportResult,
  type TripStatus,
  type VehicleInput,
} from "./types";

/*
 * Writes for Logistics ▸ Transport (doc/vehicle program/plan.md, migration 0766).
 *
 * Every write checks `can("logistics", …)` first, parses through the Zod input
 * (which is where CAPITALS happen), and RETURNS its error — never throws it at
 * the screen. Dispatch, a status change and completion are each ONE database
 * function (transport_dispatch / transport_apply_event / transport_complete_trip),
 * so none of them can half-happen. A "use server" file may export only async
 * functions: every type lives in types.ts.
 */

const ROOT = "/logistics/transport";
const forbidden = { ok: false as const, error: "You do not have permission to do this" };
const firstIssue = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Invalid input";

/** A unique-index refusal in the operator's words. */
function friendly(message: string): string {
  if (/transport_vehicles_number_uidx/.test(message)) return "That vehicle number already exists";
  if (/transport_vehicles_gps_uidx/.test(message)) return "That GPS device is already fitted to another vehicle";
  if (/transport_places_name_uidx/.test(message)) return "That place name already exists";
  if (/transport_trips_one_open_uidx/.test(message)) return "That vehicle is already on an open trip";
  return message;
}

// ---------- masters ----------

export async function saveVehicle(raw: VehicleInput, idArg?: string): Promise<TransportResult<{ id: string }>> {
  const id = idArg ?? raw.id;
  if (!(await can("logistics", id ? "edit" : "create"))) return forbidden;
  const parsed = vehicleInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const v = parsed.data;
  const s = await createClient();

  const dup = await checkDuplicateName(s, "transport_vehicles", v.vehicle_number, {
    nameColumn: "vehicle_number",
    excludeId: id,
    label: "vehicle number",
  });
  if (!dup.ok) return { ok: false, error: dup.error };

  // idle / maintenance are the operator's; loading / en_route / unloading belong to the trip.
  let status: string | undefined = v.status;
  if (id) {
    const { data: cur, error } = await s.from("transport_vehicles").select("status").eq("id", id).maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!cur) return { ok: false, error: "Vehicle not found" };
    if (cur.status !== "idle" && cur.status !== "maintenance") {
      if (v.status === "maintenance" || v.inactive)
        return { ok: false, error: "This vehicle is on a trip — finish or cancel the trip first" };
      status = undefined;
    }
  }

  const row = {
    vehicle_number: v.vehicle_number,
    vehicle_type: v.vehicle_type,
    max_payload_kg: v.max_payload_kg,
    gps_device_id: v.gps_device_id ?? null,
    inactive: v.inactive,
    ...(status ? { status } : {}),
  };
  const res = id
    ? await s.from("transport_vehicles").update(row).eq("id", id).select("id").maybeSingle()
    : await s.from("transport_vehicles").insert(row).select("id").single();
  if (res.error) return { ok: false, error: friendly(res.error.message) };
  if (!res.data) return { ok: false, error: "Vehicle not found, or you may not change it" };
  revalidatePath(ROOT, "layout");
  return { ok: true, data: { id: String(res.data.id) } };
}

export async function savePlace(raw: PlaceInput, idArg?: string): Promise<TransportResult<{ id: string }>> {
  const id = idArg ?? raw.id;
  if (!(await can("logistics", id ? "edit" : "create"))) return forbidden;
  const parsed = placeInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const p = parsed.data;
  const s = await createClient();

  const dup = await checkDuplicateName(s, "transport_places", p.name, { excludeId: id });
  if (!dup.ok) return { ok: false, error: dup.error };

  const row = {
    name: p.name,
    kind: p.kind,
    // A unit place names a unit, a vendor place a vendor — never both, never a stale one.
    location_id: p.kind === "unit" ? (p.location_id ?? null) : null,
    vendor_id: p.kind === "vendor" ? (p.vendor_id ?? null) : null,
    lat: p.lat,
    lng: p.lng,
    radius_m: p.radius_m,
    inactive: p.inactive,
  };
  const res = id
    ? await s.from("transport_places").update(row).eq("id", id).select("id").maybeSingle()
    : await s.from("transport_places").insert(row).select("id").single();
  if (res.error) return { ok: false, error: friendly(res.error.message) };
  if (!res.data) return { ok: false, error: "Place not found, or you may not change it" };
  revalidatePath(ROOT, "layout");
  return { ok: true, data: { id: String(res.data.id) } };
}

/**
 * Switch a master row off (or back on). Never a delete: a trip or a request that
 * already names it keeps resolving it (AGENTS.md, Disabled rows). A vehicle on an
 * open trip cannot be switched off.
 */
async function setInactive(table: "transport_vehicles" | "transport_places", id: string, inactive: boolean): Promise<TransportResult> {
  if (!(await can("logistics", "edit"))) return forbidden;
  const s = await createClient();
  if (table === "transport_vehicles" && inactive) {
    const { data: cur, error } = await s.from("transport_vehicles").select("status").eq("id", id).maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (cur && cur.status !== "idle" && cur.status !== "maintenance")
      return { ok: false, error: "This vehicle is on a trip — finish or cancel the trip first" };
  }
  const { data, error } = await s.from(table).update({ inactive }).eq("id", id).select("id").maybeSingle();
  if (error) return { ok: false, error: friendly(error.message) };
  if (!data) return { ok: false, error: "Not found, or you may not change it" };
  revalidatePath(ROOT, "layout");
  return { ok: true, data: undefined };
}

export async function setVehicleInactive(id: string, inactive: boolean): Promise<TransportResult> {
  return setInactive("transport_vehicles", id, inactive);
}

export async function setPlaceInactive(id: string, inactive: boolean): Promise<TransportResult> {
  return setInactive("transport_places", id, inactive);
}

// ---------- requisitions ----------

export async function saveRequisition(
  raw: RequisitionInput,
  idArg?: string,
): Promise<TransportResult<{ id: string; req_no: string }>> {
  const id = idArg ?? raw.id;
  if (!(await can("logistics", "create"))) return forbidden;
  const parsed = requisitionInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const r = parsed.data;

  // The order number is read back from the live-order lookup, never trusted from
  // the client. A NEW request must name a live order of this unit; an edit of an
  // older one whose order has since closed keeps the number it already carries.
  let sourceNo = r.source_no ?? null;
  if (r.source_kind !== "ho" && r.source_id) {
    try {
      const [hit] = await orderSourceOptions([r.source_id]);
      if (hit) {
        if (hit.source_kind !== r.source_kind) return { ok: false, error: `That order is an ${hit.source_kind.toUpperCase()}, not an ${r.source_kind.toUpperCase()}` };
        sourceNo = hit.source_no;
      } else if (!id) {
        return { ok: false, error: "That order is not open in your current unit" };
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  const row = {
    source_kind: r.source_kind,
    source_id: r.source_kind === "ho" ? null : (r.source_id ?? null),
    source_no: r.source_kind === "ho" ? null : sourceNo,
    origin_place_id: r.origin_place_id,
    destination_place_id: r.destination_place_id,
    material_type: r.material_type,
    material_weight_kg: r.material_weight_kg,
    required_dispatch_at: new Date(r.required_dispatch_at).toISOString(),
    remarks: r.remarks ?? null,
  };
  const s = await createClient();
  const res = id
    ? await s
        .from("transport_requisitions")
        .update(row)
        .eq("id", id)
        .in("status", ["pending", "pooled"])
        .select("id, req_no")
        .maybeSingle()
    : await s.from("transport_requisitions").insert(row).select("id, req_no").single();
  if (res.error) return { ok: false, error: friendly(res.error.message) };
  if (!res.data) return { ok: false, error: "This request is no longer waiting for a vehicle, or you may not change it" };
  revalidatePath(ROOT, "layout");
  return { ok: true, data: { id: String(res.data.id), req_no: String(res.data.req_no) } };
}

export async function cancelRequisition(id: string): Promise<TransportResult> {
  if (!(await can("logistics", "create"))) return forbidden;
  const s = await createClient();
  const { data, error } = await s
    .from("transport_requisitions")
    .update({ status: "cancelled" })
    .eq("id", id)
    .in("status", ["pending", "pooled"])
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: friendly(error.message) };
  if (!data) return { ok: false, error: "Only a request still waiting for a vehicle can be cancelled" };
  revalidatePath(ROOT, "layout");
  return { ok: true, data: undefined };
}

// ---------- trips ----------

/** Tell the people who booked the trip's requests. Never throws (notify() doesn't). */
async function notifyRequesters(
  event: "transport.trip_dispatched" | "transport.trip_completed",
  tripId: string,
): Promise<void> {
  const s = await createClient();
  const [{ data: trip }, { data: reqs }] = await Promise.all([
    s.from("transport_trips").select("trip_no, driver_name, vehicle_id").eq("id", tripId).maybeSingle(),
    s.from("transport_requisitions").select("created_by, req_no").eq("trip_id", tripId),
  ]);
  const userIds = [...new Set(((reqs ?? []) as { created_by: string | null }[]).map((r) => r.created_by).filter((u): u is string => !!u))];
  if (!trip || userIds.length === 0) return;
  const reqNos = ((reqs ?? []) as { req_no: string }[]).map((r) => r.req_no).join(", ");
  await notify(
    event,
    { userIds },
    event === "transport.trip_dispatched"
      ? { title: `Trip ${trip.trip_no} dispatched`, body: `${reqNos} · driver ${trip.driver_name}`, href: `${ROOT}/trips/${tripId}`, type: "info" }
      : { title: `Trip ${trip.trip_no} delivered`, body: reqNos, href: `${ROOT}/trips/${tripId}`, type: "success" },
    { dedupeKey: `${event}:${tripId}` },
  );
}

/** Spec §4 POST /dispatch — one trip, the ticked requests, the vehicle off to Loading. */
export async function dispatchTrip(raw: DispatchInput): Promise<TransportResult<{ id: string; trip_id: string }>> {
  if (!(await can("logistics", "create")) || !(await can("logistics", "edit"))) return forbidden;
  const parsed = dispatchInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;
  const s = await createClient();
  const { data, error } = await s.rpc("transport_dispatch", {
    p_vehicle_id: d.vehicle_id,
    p_driver_name: d.driver_name,
    p_driver_phone: d.driver_phone ?? null,
    p_requisition_ids: d.requisition_ids,
    p_start_odometer_km: d.start_odometer_km,
  });
  if (error) return { ok: false, error: friendly(error.message) };
  const tripId = String(data);
  await notifyRequesters("transport.trip_dispatched", tripId);
  revalidatePath(ROOT, "layout");
  return { ok: true, data: { id: tripId, trip_id: tripId } };
}

/**
 * The board's manual status buttons (plan D6). `source` is the plan's signature
 * but only `manual` is accepted — a browser cannot claim to be the GPS. The move itself is `trip-events.ts`'s,
 * the same door the webhook uses.
 */
export async function applyTripEvent(
  tripId: string,
  toStatus: TripStatus,
  source: "manual" = "manual",
  meta: { note?: string | null } = {},
): Promise<TransportResult<{ ignored: boolean }>> {
  if (!(await can("logistics", "edit"))) return forbidden;
  if (source !== "manual") return { ok: false, error: "Only a manual move can come from the screen" };
  const s = await createClient();
  const { data: cur, error: readErr } = await s.from("transport_trips").select("trip_status").eq("id", tripId).maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!cur) return { ok: false, error: "Trip not found" };
  const from = cur.trip_status as TripStatus;
  if (from !== toStatus && !canTransition(from, toStatus))
    return { ok: false, error: `A trip cannot move from ${from.replace("_", " ")} to ${toStatus.replace("_", " ")}` };

  const res = await applyTripEventWith(s, tripId, toStatus, source, { note: meta.note ?? null });
  if (res.error) return { ok: false, error: res.error };
  if (!res.ignored && toStatus === "completed") await notifyRequesters("transport.trip_completed", tripId);
  revalidatePath(ROOT, "layout");
  return { ok: true, data: { ignored: !!res.ignored } };
}

/**
 * Spec §4 POST /trips/{id}/complete — the four costs and the end odometer, the
 * pro-rata split (allocateCost: to the paisa, remainder to the largest line),
 * and the final move to Completed. Also accepted on a trip the GPS already
 * completed, to record (or correct) its costs; the split is then replaced.
 */
export async function completeTrip(
  tripId: string,
  raw: CompleteTripInput,
): Promise<TransportResult<{ total_cost: number }>> {
  if (!(await can("logistics", "edit"))) return forbidden;
  const parsed = completeTripInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const c = parsed.data;
  const s = await createClient();

  const [{ data: trip, error: tErr }, { data: reqs, error: rErr }] = await Promise.all([
    s.from("transport_trips").select("trip_status, start_odometer_km").eq("id", tripId).maybeSingle(),
    s.from("transport_requisitions").select("id, material_weight_kg").eq("trip_id", tripId),
  ]);
  if (tErr) return { ok: false, error: tErr.message };
  if (rErr) return { ok: false, error: rErr.message };
  if (!trip) return { ok: false, error: "Trip not found" };
  if (trip.trip_status !== "unloading" && trip.trip_status !== "completed")
    return { ok: false, error: "The trip has not reached its destination yet" };
  if (c.end_odometer_km != null && trip.start_odometer_km != null && c.end_odometer_km < Number(trip.start_odometer_km))
    return { ok: false, error: "End odometer is below the start reading" };

  const total = tripTotalCost(c);
  const split = allocateCost(
    total,
    ((reqs ?? []) as { id: string; material_weight_kg: number }[]).map((r) => ({ key: r.id, weight_kg: Number(r.material_weight_kg) })),
  );
  const { error } = await s.rpc("transport_complete_trip", {
    p_trip_id: tripId,
    p_end_odometer_km: c.end_odometer_km,
    p_fuel_cost: c.fuel_cost,
    p_driver_allowance: c.driver_allowance,
    p_toll_cost: c.toll_cost,
    p_other_cost: c.other_cost,
    p_allocations: split.map((a) => ({ requisition_id: a.key, weight_pct: a.weight_pct, allocated_cost: a.allocated_cost })),
  });
  if (error) return { ok: false, error: friendly(error.message) };
  if (trip.trip_status === "unloading") await notifyRequesters("transport.trip_completed", tripId);
  revalidatePath(ROOT, "layout");
  return { ok: true, data: { total_cost: total } };
}
