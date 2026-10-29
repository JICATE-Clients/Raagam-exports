import { z } from "zod";
import { capsName, capsTextNullable } from "@/lib/validation/formats";
import { SOURCE_KIND_LABEL, type SourceKind } from "@/lib/purchase/re-po/types";

/**
 * VEHICLE & TRANSPORT (doc/vehicle program/plan.md — the shared contract).
 *
 * Pure — no `server-only` — so the screens, the server actions, the GPS webhook
 * and `scripts/check-transport-logic.mts` read one set of words. Statuses are
 * lowercase snake in the database (plan D9) and the check constraints in the
 * migration list exactly the values below; change one and change the other.
 */

// ---------- the order a movement is charged to (plan D2) ----------

/** Raise PO's own pair (re | iwo | swo) — re-exported, never redeclared. */
export type { SourceKind };

/**
 * A transport request names its order the way a Raise PO line does, plus `ho`:
 * a movement charged to NO order (samples to an office, returnable machinery) —
 * its cost stays with the unit and its `source_id` is null.
 */
export const TRANSPORT_SOURCE_KINDS = ["re", "iwo", "swo", "ho"] as const;
export type TransportSourceKind = (typeof TRANSPORT_SOURCE_KINDS)[number];
export const TRANSPORT_SOURCE_KIND_LABEL: Record<TransportSourceKind, string> = {
  ...SOURCE_KIND_LABEL,
  ho: "HO (no order)",
};

/** One pickable order for the request form (`orderSourceOptions`). */
export type OrderSourceOption = {
  source_kind: SourceKind;
  source_id: string;
  /** What the operator reads: "HO/RE/26-27/0013", "SWO/26-27/0001 · SIW/26-27/0002". */
  source_no: string;
  customer: string | null;
};

// ---------- vocabularies ----------

export const VEHICLE_TYPES = ["pickup_truck", "lorry", "container", "van"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];
export const VEHICLE_TYPE_LABEL: Record<VehicleType, string> = {
  pickup_truck: "Pickup Truck",
  lorry: "Lorry",
  container: "Container",
  van: "Van",
};

export const VEHICLE_STATUSES = ["idle", "loading", "en_route", "unloading", "maintenance"] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];
/** The two a person sets by hand; the other three are set by the trip the vehicle is on. */
export const VEHICLE_MANUAL_STATUSES = ["idle", "maintenance"] as const;

export const REQUISITION_STATUSES = ["pending", "pooled", "assigned", "completed", "cancelled"] as const;
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

export const TRIP_STATUSES = ["planned", "loading", "en_route", "unloading", "completed", "cancelled"] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
/** A trip in one of these still holds its vehicle (the board's cards). */
export const ACTIVE_TRIP_STATUSES = ["planned", "loading", "en_route", "unloading"] as const satisfies readonly TripStatus[];

export const PLACE_KINDS = ["unit", "vendor", "other"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export const TRIP_EVENT_SOURCES = ["gps", "manual"] as const;
export type TripEventSource = (typeof TRIP_EVENT_SOURCES)[number];

/** Display words for every status above — the pill text; the colour is `statusTone`. */
export const TRANSPORT_STATUS_LABEL: Record<VehicleStatus | RequisitionStatus | TripStatus, string> = {
  idle: "Idle",
  loading: "Loading",
  en_route: "En Route",
  unloading: "Unloading",
  maintenance: "Maintenance",
  pending: "Pending",
  pooled: "Pooled",
  assigned: "Assigned",
  completed: "Completed",
  cancelled: "Cancelled",
  planned: "Planned",
};

/** What a trip's status means for its vehicle. A finished or cancelled trip frees it. */
export const VEHICLE_STATUS_FOR_TRIP: Record<TripStatus, VehicleStatus> = {
  planned: "loading",
  loading: "loading",
  en_route: "en_route",
  unloading: "unloading",
  completed: "idle",
  cancelled: "idle",
};

// ---------- rows ----------

export type Vehicle = {
  id: string;
  vehicle_number: string;
  vehicle_type: VehicleType;
  max_payload_kg: number;
  gps_device_id: string | null;
  status: VehicleStatus;
  inactive: boolean;
  created_at: string;
  created_by: string | null;
};

export type TransportPlace = {
  id: string;
  name: string;
  kind: PlaceKind;
  location_id: string | null;
  vendor_id: string | null;
  lat: number | null;
  lng: number | null;
  radius_m: number;
  inactive: boolean;
  created_at: string;
  created_by: string | null;
};

export type Requisition = {
  id: string;
  req_no: string;
  location_id: string;
  source_kind: TransportSourceKind;
  /** NULL only for `ho`. */
  source_id: string | null;
  source_no: string | null;
  origin_place_id: string;
  destination_place_id: string;
  origin_name: string;
  destination_name: string;
  material_type: string;
  material_weight_kg: number;
  /** ISO timestamp. */
  required_dispatch_at: string;
  status: RequisitionStatus;
  trip_id: string | null;
  remarks: string | null;
  created_at: string;
  created_by: string | null;
};

export type Trip = {
  id: string;
  trip_no: string;
  /** The trip's unit — the webhook states it explicitly (the admin client has no current unit). */
  location_id: string;
  vehicle_id: string;
  vehicle_number: string;
  driver_name: string;
  driver_phone: string | null;
  total_loaded_weight_kg: number;
  start_odometer_km: number | null;
  end_odometer_km: number | null;
  fuel_cost: number;
  driver_allowance: number;
  toll_cost: number;
  other_cost: number;
  /** fuel + allowance + toll + other (a generated column). */
  total_cost: number;
  trip_status: TripStatus;
  planned_at: string;
  completed_at: string | null;
  created_at: string;
  created_by: string | null;
};

/** A trip as the board and the trips list show it. */
export type TripRow = Trip & {
  max_payload_kg: number;
  utilisation_pct: number;
  origin_names: string[];
  destination_names: string[];
  source_nos: string[];
  last_event_at: string | null;
};

export type TripAllocation = {
  trip_id: string;
  requisition_id: string;
  source_kind: TransportSourceKind;
  source_id: string | null;
  source_no: string | null;
  weight_kg: number;
  weight_pct: number;
  allocated_cost: number;
};

export type TripEvent = {
  id: string;
  trip_id: string;
  /** NULL on the dispatch event that created the trip. */
  from_status: TripStatus | null;
  to_status: TripStatus;
  source: TripEventSource;
  at: string;
  lat: number | null;
  lng: number | null;
  place_id: string | null;
  note: string | null;
  /** The person (manual) — NULL for a GPS event. */
  by: string | null;
  by_name: string | null;
};

export type TripDetail = TripRow & {
  requisitions: Requisition[];
  allocations: TripAllocation[];
  events: TripEvent[];
};

/** The dispatch pool: pending requests grouped by where they are going (plan D4). */
export type PoolGroup = {
  destination_place_id: string;
  destination_name: string;
  total_weight_kg: number;
  earliest_dispatch_at: string;
  requisitions: Requisition[];
};

export type VehicleOption = {
  id: string;
  vehicle_number: string;
  vehicle_type: VehicleType;
  max_payload_kg: number;
  status: VehicleStatus;
  inactive: boolean;
};

export type PlaceOption = { id: string; name: string; kind: PlaceKind; inactive: boolean };

// ---------- inputs (Zod) ----------

const uuid = z.string().uuid();
const money = z.coerce.number().min(0, "Cannot be negative").default(0);
const nullableNumber = (min: number, max: number, msg: string) =>
  z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.coerce.number().min(min, msg).max(max, msg).nullable(),
  );
/** A device id or a phone number: trimmed, kept as typed, blank = null. */
const plainNullable = z
  .string()
  .trim()
  .transform((s) => (s === "" ? null : s))
  .optional()
  .nullable();

/** Every master / request input may carry its own id (the SimpleMasterScreen shape) or take it as an argument. */
const optionalId = uuid.optional();

export const vehicleInput = z.object({
  id: optionalId,
  vehicle_number: capsName("Vehicle number is required"),
  vehicle_type: z.enum(VEHICLE_TYPES),
  max_payload_kg: z.coerce.number().positive("Max payload must be more than 0 kg"),
  /** Stored in CAPITALS (the screen capitalises every box); the webhook matches it upper-cased. */
  gps_device_id: capsTextNullable().transform((s) => (s ? s : null)),
  status: z.enum(VEHICLE_MANUAL_STATUSES).default("idle"),
  inactive: z.boolean().default(false),
});
export type VehicleInput = z.input<typeof vehicleInput>;

export const placeInput = z
  .object({
    id: optionalId,
    name: capsName("Place name is required"),
    kind: z.enum(PLACE_KINDS),
    location_id: uuid.nullable().optional(),
    vendor_id: uuid.nullable().optional(),
    lat: nullableNumber(-90, 90, "Latitude is between -90 and 90"),
    lng: nullableNumber(-180, 180, "Longitude is between -180 and 180"),
    radius_m: z.coerce.number().int().min(20, "Radius is at least 20 m").max(50000).default(200),
    inactive: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "unit" && !v.location_id)
      ctx.addIssue({ code: "custom", path: ["location_id"], message: "Pick the unit this place is" });
    if (v.kind === "vendor" && !v.vendor_id)
      ctx.addIssue({ code: "custom", path: ["vendor_id"], message: "Pick the vendor this place is" });
    if ((v.lat == null) !== (v.lng == null))
      ctx.addIssue({ code: "custom", path: ["lng"], message: "Give both latitude and longitude, or neither" });
  });
export type PlaceInput = z.input<typeof placeInput>;

export const requisitionInput = z
  .object({
    id: optionalId,
    source_kind: z.enum(TRANSPORT_SOURCE_KINDS),
    source_id: uuid.nullable().optional(),
    source_no: capsTextNullable(),
    origin_place_id: uuid,
    destination_place_id: uuid,
    material_type: capsName("Material type is required"),
    material_weight_kg: z.coerce.number().positive("Weight must be more than 0 kg"),
    required_dispatch_at: z.string().trim().min(1, "Required dispatch date & time is required"),
    remarks: capsTextNullable(),
  })
  .superRefine((v, ctx) => {
    if (v.source_kind !== "ho" && !v.source_id)
      ctx.addIssue({ code: "custom", path: ["source_id"], message: "Pick the order this movement is for" });
    if (v.origin_place_id === v.destination_place_id)
      ctx.addIssue({ code: "custom", path: ["destination_place_id"], message: "From and To are the same place" });
    if (Number.isNaN(Date.parse(v.required_dispatch_at)))
      ctx.addIssue({ code: "custom", path: ["required_dispatch_at"], message: "Not a valid date & time" });
  });
export type RequisitionInput = z.input<typeof requisitionInput>;

export const dispatchInput = z.object({
  vehicle_id: uuid,
  driver_name: capsName("Driver name is required"),
  driver_phone: plainNullable,
  requisition_ids: z.array(uuid).min(1, "Tick at least one request"),
  start_odometer_km: nullableNumber(0, 10_000_000, "Odometer cannot be negative"),
});
export type DispatchInput = z.input<typeof dispatchInput>;

export const completeTripInput = z.object({
  end_odometer_km: nullableNumber(0, 10_000_000, "Odometer cannot be negative"),
  fuel_cost: money,
  driver_allowance: money,
  toll_cost: money,
  other_cost: money,
});
export type CompleteTripInput = z.input<typeof completeTripInput>;

/** What a GPS provider posts to /api/transport/telematics. */
export const telematicsEvent = z.object({
  gps_device_id: z.string().trim().min(1),
  event: z.enum(["enter", "exit"]),
  place_id: uuid.optional(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  at: z.string().datetime({ offset: true }),
});
export type TelematicsEvent = z.infer<typeof telematicsEvent>;

/** A geofence event once the webhook has placed it against the trip's own route. */
export type GeofenceEvent = { kind: "enter" | "exit"; at: "origin" | "destination" };

/** Server action result — writes return errors, they do not throw them. */
export type TransportResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
