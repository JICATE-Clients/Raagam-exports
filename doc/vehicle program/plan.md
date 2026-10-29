# Vehicle & Transport — build plan (2026-10-29)

Source spec: `vechicle fprogram.md` (same folder). This file is the team's SHARED
CONTRACT — every builder reads it before writing code, and changes to a contract
section are made here first.

## Decisions (made by the lead; the user is new to ERP, so these are explained, not asked)

| # | Decision | Why |
|---|---|---|
| D1 | Lives under **Logistics ▸ Transport** — a new `kind: "group"`, slug `transport`, in `lib/nav/module-groups.ts`. Permission key `logistics`. | Logistics already owns outward movement (shipments). A new top-level module would cost a rail row and a permission key for five screens. |
| D2 | Order link is **`source_kind` + `source_id`** (`re` · `swo` · `iwo` · `ho`), the same pair Raise PO uses (`lib/purchase/re-po/types.ts` `SourceKind`). Never a bare `order_id`. | The spec's "FK to RE / SWO / IWO" cannot be one FK — they are different tables. Raise PO already solved this. Reuse its source lookup for the picker. |
| D3 | **Places are a table** (`transport_places`: name, kind `unit`/`vendor`/`other`, optional `location_id`, optional `vendor_id` → `master_vendors`, `lat`, `lng`, `radius_m`). Origin and destination are FKs to it, not free text. | Geofencing needs coordinates, and "Dyeing Unit A" typed three ways is three places. |
| D4 | **Pooling v1 = same destination place**, pending, dispatch window overlapping. The pool screen groups by destination and shows the utilisation bar against a chosen vehicle. The operator ticks what goes on the trip — the system suggests, never auto-assigns. | The spec's "route overlap exceeds threshold" has no route data behind it. Same-destination is honest and useful; true route overlap is a later phase once GPS history exists. |
| D5 | **Trip cost** = fuel + driver allowance + toll + other (four numeric columns, total derived). Distance = end − start odometer. Allocation = pro-rata by weight, rounded to paise, **remainder to the largest line** so the parts always sum to the total. | Spec §3C, made exact. A sum that is 1 paisa off is a reconciliation query later. |
| D6 | **GPS is optional.** Build `POST /api/transport/telematics` (secret `TRANSPORT_WEBHOOK_SECRET`, refuses with 503 when unset — the `/api/cron` shape) **and** manual status buttons on each trip (Start loading · Left origin · Reached · Complete). Both go through ONE server function that applies the state machine. | No GPS provider is chosen yet. A board that only moves by GPS shows nothing on day one. |
| D7 | Every status change writes a row to `vehicle_trip_events` (trip, from, to, source `gps`/`manual`, at, lat/lng, by). | "Why does it say En Route?" must have an answer. |
| D8 | Vehicles are **shared master data** (no `location_id`), per AGENTS.md "Master Data = shared". Requisitions and trips are **unit-scoped** (`location_id default current_location()`), allocations/events follow their trip via `lv_<owner>` predicates. | AGENTS.md "Locations: allocated units only". |
| D9 | Statuses are lowercase snake in the DB (`pending`, `en_route` …); labels via `statusTone`. Requisition: pending → pooled → assigned → completed / cancelled. Trip: planned → loading → en_route → unloading → completed / cancelled. Vehicle: idle · loading · en_route · unloading · maintenance. | Matches every other status in the app and `lib/ui/status-tone.ts`. |
| D10 | **The migration is WRITTEN, not APPLIED.** AGENTS.md: a database write needs the user's go-ahead. The DB builder writes the file and stops; the lead asks the user before `apply_migration` on project `xcidbfgujrxginrgvbjw` (the ONLY project). | Standing rule. |

## Contract — types (`lib/logistics/transport/types.ts`, written FIRST by the DB builder)

Plain TS + Zod. At minimum:

- `VehicleType`, `VehicleStatus`, `RequisitionStatus`, `TripStatus`, `SourceKind` (re-export Raise PO's).
- `Vehicle { id, vehicle_number, vehicle_type, max_payload_kg, gps_device_id, status, inactive, created_at, created_by }`
- `TransportPlace { id, name, kind, location_id, vendor_id, lat, lng, radius_m, inactive }`
- `Requisition { id, req_no, source_kind, source_id, source_no, origin_place_id, destination_place_id, origin_name, destination_name, material_type, material_weight_kg, required_dispatch_at, status, trip_id, remarks, created_at, created_by }`
- `Trip { id, trip_no, vehicle_id, vehicle_number, driver_name, driver_phone, total_loaded_weight_kg, start_odometer_km, end_odometer_km, fuel_cost, driver_allowance, toll_cost, other_cost, total_cost, trip_status, planned_at, completed_at, created_at, created_by }`
- `TripAllocation { trip_id, requisition_id, source_kind, source_id, source_no, weight_kg, weight_pct, allocated_cost }`
- `TripEvent { trip_id, from_status, to_status, source, at, lat, lng, by }`
- Zod inputs: `vehicleInput`, `placeInput`, `requisitionInput`, `dispatchInput { vehicle_id, driver_name, driver_phone, requisition_ids[], start_odometer_km }`, `completeTripInput { end_odometer_km, fuel_cost, driver_allowance, toll_cost, other_cost }`, `telematicsEvent { gps_device_id, event: "enter"|"exit", place_id?, lat, lng, at }`. Text through `capsName()` / `capsTextNullable()` (CAPITALS rule).

## Contract — pure logic (`lib/logistics/transport/logic.ts`, DB builder, no I/O)

- `utilisationPct(weights: number[], maxPayloadKg: number): number`
- `allocateCost(totalCost: number, lines: {key, weight_kg}[]): {key, weight_pct, allocated_cost}[]` — D5 rounding.
- `nextTripStatus(current: TripStatus, event: {kind: "enter"|"exit", at: "origin"|"destination"}): TripStatus | null` — §3B; null = ignore.
- A vector script `scripts/check-transport-logic.mts` + `npm run check:transport` that asserts all three (sum-to-total, remainder rule, every state transition, ignored events). Made to FAIL first.

## Contract — server (`lib/logistics/transport/service.ts` reads, `actions.ts` "use server" writes)

Reads: `listVehicles`, `listPlaces`, `listRequisitions(filters)`, `getPendingPool()` (grouped by destination), `listTrips(filters)`, `getTrip(id)` (with allocations + events), `vehicleOptions`, `placeOptions`, `orderSourceOptions` (reuse Raise PO's source lookup).
Writes: `saveVehicle`, `savePlace`, `saveRequisition`, `cancelRequisition`, `dispatchTrip` (creates trip, marks requisitions assigned, vehicle → loading/planned), `applyTripEvent(tripId, toStatus, source, meta)` (THE one state-machine door — manual buttons and webhook both call it), `completeTrip` (computes cost, writes allocations, frees vehicle).
Every list wrapped in `withCreators()`; every write `can("logistics", …)`; errors returned, never `data ?? []` swallowed.

## Screens (UI builder) — all under `/logistics/transport/*`

1. `vehicles` — Vehicle master (`SimpleMasterScreen` or `MasterListShell`): number, type, payload, GPS device, status. Dup-check on vehicle number.
2. `places` — Transport places: name, kind, unit/vendor link, lat/lng/radius.
3. `requests` — Trip Requests list + booking editor: Order (RE/SWO/IWO/HO picker), From, To, Material type, Weight kg, Required dispatch date-time. Mandatory fields hold the cursor.
4. `dispatch` — Pending pool grouped by destination; pick a vehicle → utilisation bar fills as requests are ticked (red past 100%, Dispatch disabled); driver name/phone, start odometer; Dispatch.
5. `board` — Fleet board: one card per active trip (vehicle, driver, status pill, destinations, utilisation bar, last event time) + the manual status buttons; idle/maintenance vehicles listed beneath.
6. `trips/[id]` — Trip document: header, requests on it, events timeline, Complete form (end odometer + four costs) → allocation table (order no, kg, %, ₹). `paginate={false}` (it is a document).

Rules every screen follows: AGENTS.md (hooks above early returns, `useUnsavedGuard`, Tab/Enter contract, Created Date/User columns, CAPITALS, DD/MM/YYYY via `fmtDate`, one filled button, icons not ⋮, inactive rows hidden from pickers, build compact first, `check:grid-budget`).

## Telematics (integration builder)

- `app/api/transport/telematics/route.ts` — secret header check (503 without env, 401 wrong), Zod parse, resolve vehicle by `gps_device_id`, resolve place (by id, or by lat/lng within `radius_m`), map enter/exit at origin/destination through `nextTripStatus`, call `applyTripEvent` via the admin client stating the trip's unit explicitly (AGENTS.md: the privileged client has no current unit).
- `proxy.ts` stands down for `/api/transport/` exactly as for `/api/cron/`.
- Notification events (`lib/notifications/events.ts` + seed row + call): `transport.trip_dispatched` (to requesters), `transport.trip_completed` (to requesters). `npm run check:notification-events` must pass.
- `doc/vehicle program/telematics.md` — the payload a GPS vendor must send, with a curl example.

## Order of work

1. DB builder: `types.ts` + `logic.ts` + check script → tell the lead. (UI and integration builders read the contract above meanwhile and scaffold.)
2. DB builder: migration file (NOT applied) + `service.ts` + `actions.ts`.
3. UI builder: screens + nav registry entries; integration builder: webhook + proxy + notifications.
4. Lead: ask the user to approve applying the migration, apply, generate types, run `npm run build:check`.

## Done means

`npx tsc --noEmit` clean, `npm run check:hooks`, `check:nav`, `check:grid-budget`, `check:transport`, `check:notification-events` pass; migration file reviewed; nothing committed (the user commits).
