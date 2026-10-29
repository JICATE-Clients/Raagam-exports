import "server-only";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { getCurrentLocationId } from "@/lib/auth/location";
import { withCreators } from "@/lib/created-by";
import { isInactive } from "@/lib/masters/inactive";
import { utilisationPct } from "./logic";
import {
  ACTIVE_TRIP_STATUSES,
  type OrderSourceOption,
  type PlaceOption,
  type PoolGroup,
  type Requisition,
  type RequisitionStatus,
  type TransportPlace,
  type Trip,
  type TripAllocation,
  type TripDetail,
  type TripEvent,
  type TripRow,
  type TripStatus,
  type Vehicle,
  type VehicleOption,
} from "./types";

/*
 * Reads for Logistics ▸ Transport (doc/vehicle program/plan.md, migration 0766).
 *
 * A FAILED READ IS AN ERROR, NOT AN EMPTY LIST (AGENTS.md "A second FK"): an
 * empty pool reads as "nothing waiting for a vehicle", which nobody questions.
 * Every read here throws on `error`; none returns `data ?? []` over one.
 *
 * NO EMBEDS. `transport_requisitions` has two FKs to `transport_places` (origin,
 * destination), so a bare embed is PGRST201-ambiguous; the place names, vehicle
 * numbers and events are read in one parallel round and joined here instead.
 */

const num = (v: unknown) => (v == null ? 0 : Number(v));
const numN = (v: unknown) => (v == null ? null : Number(v));

const VEHICLE_COLS = "id, vehicle_number, vehicle_type, max_payload_kg, gps_device_id, status, inactive, created_at, created_by";
const PLACE_COLS = "id, name, kind, location_id, vendor_id, lat, lng, radius_m, inactive, created_at, created_by";
const REQ_COLS =
  "id, req_no, location_id, source_kind, source_id, source_no, origin_place_id, destination_place_id, material_type, " +
  "material_weight_kg, required_dispatch_at, status, trip_id, remarks, created_at, created_by";
const TRIP_COLS =
  "id, trip_no, location_id, vehicle_id, driver_name, driver_phone, total_loaded_weight_kg, start_odometer_km, " +
  "end_odometer_km, fuel_cost, driver_allowance, toll_cost, other_cost, total_cost, trip_status, planned_at, " +
  "completed_at, created_at, created_by";

type Raw = Record<string, unknown>;

function toVehicle(r: Raw): Vehicle {
  return {
    id: String(r.id),
    vehicle_number: String(r.vehicle_number ?? ""),
    vehicle_type: r.vehicle_type as Vehicle["vehicle_type"],
    max_payload_kg: num(r.max_payload_kg),
    gps_device_id: (r.gps_device_id as string | null) ?? null,
    status: r.status as Vehicle["status"],
    inactive: !!r.inactive,
    created_at: String(r.created_at),
    created_by: (r.created_by as string | null) ?? null,
  };
}

function toPlace(r: Raw): TransportPlace {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    kind: r.kind as TransportPlace["kind"],
    location_id: (r.location_id as string | null) ?? null,
    vendor_id: (r.vendor_id as string | null) ?? null,
    lat: numN(r.lat),
    lng: numN(r.lng),
    radius_m: num(r.radius_m),
    inactive: !!r.inactive,
    created_at: String(r.created_at),
    created_by: (r.created_by as string | null) ?? null,
  };
}

function toRequisition(r: Raw, placeName: Map<string, string>): Requisition {
  return {
    id: String(r.id),
    req_no: String(r.req_no ?? ""),
    location_id: String(r.location_id),
    source_kind: r.source_kind as Requisition["source_kind"],
    source_id: (r.source_id as string | null) ?? null,
    source_no: (r.source_no as string | null) ?? null,
    origin_place_id: String(r.origin_place_id),
    destination_place_id: String(r.destination_place_id),
    origin_name: placeName.get(String(r.origin_place_id)) ?? "—",
    destination_name: placeName.get(String(r.destination_place_id)) ?? "—",
    material_type: String(r.material_type ?? ""),
    material_weight_kg: num(r.material_weight_kg),
    required_dispatch_at: String(r.required_dispatch_at),
    status: r.status as RequisitionStatus,
    trip_id: (r.trip_id as string | null) ?? null,
    remarks: (r.remarks as string | null) ?? null,
    created_at: String(r.created_at),
    created_by: (r.created_by as string | null) ?? null,
  };
}

function toTrip(r: Raw, vehicleNumber: string): Trip {
  return {
    id: String(r.id),
    trip_no: String(r.trip_no ?? ""),
    location_id: String(r.location_id),
    vehicle_id: String(r.vehicle_id),
    vehicle_number: vehicleNumber,
    driver_name: String(r.driver_name ?? ""),
    driver_phone: (r.driver_phone as string | null) ?? null,
    total_loaded_weight_kg: num(r.total_loaded_weight_kg),
    start_odometer_km: numN(r.start_odometer_km),
    end_odometer_km: numN(r.end_odometer_km),
    fuel_cost: num(r.fuel_cost),
    driver_allowance: num(r.driver_allowance),
    toll_cost: num(r.toll_cost),
    other_cost: num(r.other_cost),
    total_cost: num(r.total_cost),
    trip_status: r.trip_status as TripStatus,
    planned_at: String(r.planned_at),
    completed_at: (r.completed_at as string | null) ?? null,
    created_at: String(r.created_at),
    created_by: (r.created_by as string | null) ?? null,
  };
}

/** id → name for every place (active or not — a request keeps the place it named). */
async function placeNames(): Promise<Map<string, string>> {
  const s = await createClient();
  const { data, error } = await s.from("transport_places").select("id, name");
  if (error) throw new Error(`Could not read the transport places: ${error.message}`);
  return new Map(((data ?? []) as Raw[]).map((p) => [String(p.id), String(p.name ?? "")]));
}

// ---------- masters ----------

/** Vehicle master listing — alphabetical, as masters are; inactive rows included (switched back on here). */
export async function listVehicles(): Promise<Vehicle[]> {
  const s = await createClient();
  const { data, error } = await s.from("transport_vehicles").select(VEHICLE_COLS).order("vehicle_number");
  if (error) throw new Error(`Could not read the vehicles: ${error.message}`);
  return withCreators(((data ?? []) as Raw[]).map(toVehicle));
}

/** Transport places listing — alphabetical; inactive rows included. */
export async function listPlaces(): Promise<TransportPlace[]> {
  const s = await createClient();
  const { data, error } = await s.from("transport_places").select(PLACE_COLS).order("name");
  if (error) throw new Error(`Could not read the transport places: ${error.message}`);
  return withCreators(((data ?? []) as Raw[]).map(toPlace));
}

/**
 * Vehicle picker feed. Carries `inactive` so `DataPicker` hides switched-off rows
 * while a trip that already holds one still resolves it (AGENTS.md, Disabled rows).
 */
// created-by: exempt -- options feeder
export async function vehicleOptions(): Promise<VehicleOption[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("transport_vehicles")
    .select("id, vehicle_number, vehicle_type, max_payload_kg, status, inactive")
    .order("vehicle_number");
  if (error) throw new Error(`Could not read the vehicles: ${error.message}`);
  return ((data ?? []) as Raw[]).map((r) => ({
    id: String(r.id),
    vehicle_number: String(r.vehicle_number ?? ""),
    vehicle_type: r.vehicle_type as VehicleOption["vehicle_type"],
    max_payload_kg: num(r.max_payload_kg),
    status: r.status as VehicleOption["status"],
    inactive: !!r.inactive,
  }));
}

// created-by: exempt -- options feeder
export async function placeOptions(): Promise<PlaceOption[]> {
  const s = await createClient();
  const { data, error } = await s.from("transport_places").select("id, name, kind, inactive").order("name");
  if (error) throw new Error(`Could not read the transport places: ${error.message}`);
  return ((data ?? []) as Raw[]).map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ""),
    kind: r.kind as PlaceOption["kind"],
    inactive: !!r.inactive,
  }));
}

/** The units a `unit` place can be (the Places form). Active units only — a place names where we work. */
// created-by: exempt -- options feeder
export async function unitOptions(): Promise<{ id: string; code: string | null; name: string }[]> {
  const s = await createClient();
  const { data, error } = await s.from("locations").select("id, code, name").eq("is_active", true).order("code");
  if (error) throw new Error(`Could not read the units: ${error.message}`);
  return ((data ?? []) as Raw[]).map((l) => ({
    id: String(l.id),
    code: (l.code as string | null) ?? null,
    name: String(l.name ?? l.code ?? ""),
  }));
}

/**
 * Vendors a `vendor` place can be (`master_vendors`, never the purchase-side
 * `public.vendors`). Carries `inactive` so the picker hides a switched-off
 * vendor while a place that already names one still shows it.
 *
 * `inactive`, NOT `blocked`: 0299 renamed master_vendors' flag, so selecting
 * `blocked` failed the whole Places page (2026-10-29). Read through
 * `isInactive()` (AGENTS.md "Disabled rows"), never by hand.
 */
// created-by: exempt -- options feeder
export async function vendorOptions(): Promise<{ id: string; name: string; inactive: boolean }[]> {
  const s = await createClient();
  const { data, error } = await s.from("master_vendors").select("id, name, inactive").order("name");
  if (error) throw new Error(`Could not read the vendors: ${error.message}`);
  return ((data ?? []) as Raw[]).map((v) => ({ id: String(v.id), name: String(v.name ?? ""), inactive: isInactive(v) }));
}

/**
 * The orders a movement can be charged to (plan D2) — every LIVE document of the
 * three kinds in the caller's current unit, read from the order headers.
 *
 * NOT Raise PO's `po_requirement_lines`, deliberately (lead, 2026-10-29): that
 * lists only documents with a PURCHASE balance left — an RE fully bought whose
 * fabric still has to go to the dyer never appeared — and it answers only for
 * `materials_purchase:view`, so a logistics-only requester could book nothing.
 *
 *   RE  — `garment_order_amendments` (not a draft) whose `sales_orders` row is in
 *         this unit and not closed / cancelled. source_id = the garment order,
 *         source_no = the sales order's number — Raise PO's own pair.
 *   SWO — `sample_product_groups` not completed. source_id = the GROUP (the SWO
 *         itself, group_code); its unit is the unit of the IWO it buys through,
 *         and a group with no IWO yet is visible in every unit (0680's rule for a
 *         nullable owner). Raise PO keys an SWO on its accessories IWO instead —
 *         a PO line needs the IWO; a trip is charged to the SWO.
 *   IWO — `internal_work_orders` in this unit, not cancelled / completed, and not
 *         one of an SWO's own IWOs (those are booked as the SWO).
 *
 * WHY THE ADMIN CLIENT. The order tables answer to `orders:view`; a logistics
 * clerk need not hold it to name the order a lorry is for. So the gate is
 * `logistics:view`, checked here, and the UNIT is applied here by hand from
 * `getCurrentLocationId()` — no unit, no rows, never every unit (AGENTS.md
 * "Locations"). Only the number, kind and customer leave this function. Plain
 * reads, no embeds.
 */
// created-by: exempt -- options feeder
export async function orderSourceOptions(sourceIds?: readonly string[]): Promise<OrderSourceOption[]> {
  if (!(await can("logistics", "view"))) return [];
  const loc = await getCurrentLocationId();
  if (!loc) return [];
  const db = createAdminClient();
  const want = sourceIds && sourceIds.length ? new Set(sourceIds) : null;

  const [sos, iwos, groups] = await Promise.all([
    db.from("sales_orders").select("id, order_number, status").eq("location_id", loc),
    db.from("internal_work_orders").select("id, code, status, location_id, style_ref_no, reference_no"),
    db.from("sample_product_groups").select("id, group_code, status, season, season_year, iwo_id, accessories_iwo_id"),
  ]);
  if (sos.error) throw new Error(`Could not read the sales orders: ${sos.error.message}`);
  if (iwos.error) throw new Error(`Could not read the internal work orders: ${iwos.error.message}`);
  if (groups.error) throw new Error(`Could not read the sample work orders: ${groups.error.message}`);

  const liveSo = new Map(
    ((sos.data ?? []) as Raw[])
      .filter((r) => r.status !== "closed" && r.status !== "cancelled")
      .map((r) => [String(r.id), String(r.order_number ?? "—")]),
  );
  const iwoRows = (iwos.data ?? []) as Raw[];
  const iwoUnit = new Map(iwoRows.map((w) => [String(w.id), (w.location_id as string | null) ?? null]));

  const out: OrderSourceOption[] = [];

  // RE
  if (liveSo.size) {
    const { data: goas, error } = await db
      .from("garment_order_amendments")
      .select("id, sales_order_id, customer_id")
      .eq("is_draft", false)
      .in("sales_order_id", [...liveSo.keys()]);
    if (error) throw new Error(`Could not read the garment orders: ${error.message}`);
    const rows = ((goas ?? []) as Raw[]).filter((g) => !want || want.has(String(g.id)));
    const custIds = [...new Set(rows.map((g) => g.customer_id).filter((c): c is string => typeof c === "string"))];
    const cust = custIds.length ? await db.from("customers").select("id, name").in("id", custIds) : { data: [], error: null };
    if (cust.error) throw new Error(`Could not read the customers: ${cust.error.message}`);
    const custName = new Map(((cust.data ?? []) as Raw[]).map((c) => [String(c.id), String(c.name ?? "")]));
    for (const g of rows)
      out.push({
        source_kind: "re",
        source_id: String(g.id),
        source_no: liveSo.get(String(g.sales_order_id)) ?? "—",
        customer: g.customer_id ? (custName.get(String(g.customer_id)) ?? null) : null,
      });
  }

  // SWO
  const swoIwos = new Set<string>();
  for (const g of (groups.data ?? []) as Raw[]) {
    const linked = [g.iwo_id, g.accessories_iwo_id].filter((x): x is string => typeof x === "string");
    linked.forEach((x) => swoIwos.add(x));
    if (g.status === "completed") continue;
    if (linked.length && !linked.some((x) => iwoUnit.get(x) === loc)) continue;
    if (want && !want.has(String(g.id))) continue;
    out.push({
      source_kind: "swo",
      source_id: String(g.id),
      source_no: String(g.group_code ?? "—"),
      customer: `SAMPLE ${g.season ?? ""} ${g.season_year ?? ""}`.trim(),
    });
  }

  // IWO
  for (const w of iwoRows) {
    if (w.location_id !== loc || w.status === "cancelled" || w.status === "completed") continue;
    if (swoIwos.has(String(w.id)) || (want && !want.has(String(w.id)))) continue;
    const ref = [w.style_ref_no, w.reference_no].filter((x) => typeof x === "string" && x.trim()).join(" · ");
    out.push({ source_kind: "iwo", source_id: String(w.id), source_no: String(w.code ?? "—"), customer: ref || null });
  }

  const order = { re: 0, swo: 1, iwo: 2 } as const;
  return out.sort((a, b) => order[a.source_kind] - order[b.source_kind] || a.source_no.localeCompare(b.source_no));
}

// ---------- requisitions ----------

export type RequisitionFilters = {
  status?: RequisitionStatus | readonly RequisitionStatus[];
  trip_id?: string;
  /** Required dispatch on or after (ISO date / timestamp). */
  from?: string;
  /** Required dispatch on or before. */
  to?: string;
};

export async function listRequisitions(filters: RequisitionFilters = {}): Promise<Requisition[]> {
  const s = await createClient();
  // LISTED IN ENTRY ORDER — 1, 2, 3
  let q = s.from("transport_requisitions").select(REQ_COLS).order("created_at", { ascending: true });
  if (filters.status) q = Array.isArray(filters.status) ? q.in("status", [...filters.status]) : q.eq("status", filters.status as string);
  if (filters.trip_id) q = q.eq("trip_id", filters.trip_id);
  if (filters.from) q = q.gte("required_dispatch_at", filters.from);
  if (filters.to) q = q.lte("required_dispatch_at", filters.to);
  const [{ data, error }, names] = await Promise.all([q, placeNames()]);
  if (error) throw new Error(`Could not read the transport requests: ${error.message}`);
  return withCreators(((data ?? []) as unknown as Raw[]).map((r) => toRequisition(r, names)));
}

/** The dispatch pool (plan D4): pending requests grouped by destination, earliest need first. */
// created-by: exempt -- a work queue; each request inside carries created_by and is resolved
export async function getPendingPool(): Promise<PoolGroup[]> {
  const reqs = await listRequisitions({ status: ["pending", "pooled"] });
  const groups = new Map<string, PoolGroup>();
  for (const r of reqs) {
    const g = groups.get(r.destination_place_id) ?? {
      destination_place_id: r.destination_place_id,
      destination_name: r.destination_name,
      total_weight_kg: 0,
      earliest_dispatch_at: r.required_dispatch_at,
      requisitions: [],
    };
    g.requisitions.push(r);
    g.total_weight_kg = Math.round((g.total_weight_kg + r.material_weight_kg) * 100) / 100;
    if (r.required_dispatch_at < g.earliest_dispatch_at) g.earliest_dispatch_at = r.required_dispatch_at;
    groups.set(r.destination_place_id, g);
  }
  for (const g of groups.values()) g.requisitions.sort((a, b) => a.required_dispatch_at.localeCompare(b.required_dispatch_at));
  return [...groups.values()].sort((a, b) => a.earliest_dispatch_at.localeCompare(b.earliest_dispatch_at));
}

// ---------- trips ----------

export type TripFilters = {
  status?: TripStatus | readonly TripStatus[];
  /** Only trips still holding their vehicle (the Fleet Board). */
  active?: boolean;
};

/** Trip rows decorated with what the board shows: vehicle, places, orders, utilisation, last event. */
async function decorateTrips(rows: Raw[]): Promise<TripRow[]> {
  if (rows.length === 0) return [];
  const s = await createClient();
  const tripIds = rows.map((r) => String(r.id));
  const vehicleIds = [...new Set(rows.map((r) => String(r.vehicle_id)))];
  const [veh, reqs, evs, names] = await Promise.all([
    s.from("transport_vehicles").select("id, vehicle_number, max_payload_kg").in("id", vehicleIds),
    s.from("transport_requisitions").select(REQ_COLS).in("trip_id", tripIds),
    s.from("transport_trip_events").select("trip_id, event_at").in("trip_id", tripIds).order("event_at", { ascending: false }),
    placeNames(),
  ]);
  if (veh.error) throw new Error(`Could not read the vehicles: ${veh.error.message}`);
  if (reqs.error) throw new Error(`Could not read the trip requests: ${reqs.error.message}`);
  if (evs.error) throw new Error(`Could not read the trip events: ${evs.error.message}`);

  const vehicleOf = new Map(((veh.data ?? []) as Raw[]).map((v) => [String(v.id), v]));
  const reqsOf = new Map<string, Requisition[]>();
  for (const r of (reqs.data ?? []) as unknown as Raw[]) {
    const req = toRequisition(r, names);
    const list = reqsOf.get(req.trip_id!) ?? [];
    list.push(req);
    reqsOf.set(req.trip_id!, list);
  }
  const lastEvent = new Map<string, string>();
  for (const e of (evs.data ?? []) as Raw[]) if (!lastEvent.has(String(e.trip_id))) lastEvent.set(String(e.trip_id), String(e.event_at));

  return withCreators(
    rows.map((r) => {
      const v = vehicleOf.get(String(r.vehicle_id));
      const trip = toTrip(r, String(v?.vehicle_number ?? "—"));
      const tripReqs = reqsOf.get(trip.id) ?? [];
      const maxPayload = num(v?.max_payload_kg);
      return {
        ...trip,
        max_payload_kg: maxPayload,
        utilisation_pct: utilisationPct([trip.total_loaded_weight_kg], maxPayload),
        origin_names: [...new Set(tripReqs.map((q) => q.origin_name))],
        destination_names: [...new Set(tripReqs.map((q) => q.destination_name))],
        source_nos: [...new Set(tripReqs.map((q) => q.source_no).filter((n): n is string => !!n))].sort(),
        last_event_at: lastEvent.get(trip.id) ?? null,
      };
    }),
  );
}

export async function listTrips(filters: TripFilters = {}): Promise<TripRow[]> {
  const s = await createClient();
  // LISTED IN ENTRY ORDER — 1, 2, 3
  let q = s.from("transport_trips").select(TRIP_COLS).order("created_at", { ascending: true });
  if (filters.active) q = q.in("trip_status", [...ACTIVE_TRIP_STATUSES]);
  if (filters.status) q = Array.isArray(filters.status) ? q.in("trip_status", [...filters.status]) : q.eq("trip_status", filters.status as string);
  const { data, error } = await q;
  if (error) throw new Error(`Could not read the trips: ${error.message}`);
  return decorateTrips((data ?? []) as unknown as Raw[]);
}

/** One trip as a document: header, its requests, the cost split and the events timeline. NULL = not found / not this unit. */
export async function getTrip(id: string): Promise<TripDetail | null> {
  const s = await createClient();
  const { data, error } = await s.from("transport_trips").select(TRIP_COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not read the trip: ${error.message}`);
  if (!data) return null;
  const [[row], reqs, allocs, evs] = await Promise.all([
    decorateTrips([data as unknown as Raw]),
    listRequisitions({ trip_id: id }),
    s
      .from("transport_trip_allocations")
      .select("trip_id, requisition_id, source_kind, source_id, source_no, weight_kg, weight_pct, allocated_cost")
      .eq("trip_id", id),
    s
      .from("transport_trip_events")
      .select("id, trip_id, from_status, to_status, source, event_at, lat, lng, place_id, note, created_by")
      .eq("trip_id", id)
      .order("event_at", { ascending: true }),
  ]);
  if (allocs.error) throw new Error(`Could not read the cost split: ${allocs.error.message}`);
  if (evs.error) throw new Error(`Could not read the trip events: ${evs.error.message}`);

  const reqNo = new Map(reqs.map((r) => [r.id, r.req_no]));
  const allocations: TripAllocation[] = ((allocs.data ?? []) as Raw[])
    .map((a) => ({
      trip_id: String(a.trip_id),
      requisition_id: String(a.requisition_id),
      source_kind: a.source_kind as TripAllocation["source_kind"],
      source_id: (a.source_id as string | null) ?? null,
      source_no: (a.source_no as string | null) ?? null,
      weight_kg: num(a.weight_kg),
      weight_pct: num(a.weight_pct),
      allocated_cost: num(a.allocated_cost),
    }))
    .sort((a, b) => (reqNo.get(a.requisition_id) ?? "").localeCompare(reqNo.get(b.requisition_id) ?? ""));

  const rawEvents = await withCreators((evs.data ?? []) as Raw[]);
  const events: TripEvent[] = rawEvents.map((e) => ({
    id: String(e.id),
    trip_id: String(e.trip_id),
    from_status: (e.from_status as TripStatus | null) ?? null,
    to_status: e.to_status as TripStatus,
    source: e.source as TripEvent["source"],
    at: String(e.event_at),
    lat: numN(e.lat),
    lng: numN(e.lng),
    place_id: (e.place_id as string | null) ?? null,
    note: (e.note as string | null) ?? null,
    by: (e.created_by as string | null) ?? null,
    by_name: ((e as { created_by_name?: string | null }).created_by_name as string | null) ?? null,
  }));

  return { ...row, requisitions: reqs, allocations, events };
}
