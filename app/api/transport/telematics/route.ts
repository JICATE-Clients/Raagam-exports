import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications/notify";
import { ACTIVE_TRIP_STATUSES, telematicsEvent, type TripStatus } from "@/lib/logistics/transport/types";
import { distanceM, nextTripStatus } from "@/lib/logistics/transport/logic";
import { applyTripEvent } from "@/lib/logistics/transport/trip-events";

/**
 * POST /api/transport/telematics — a GPS vendor's geofence webhook
 * (doc/vehicle program/plan.md D6, payload in `telematics.md` beside it).
 *
 * GPS IS OPTIONAL. The Fleet Board's manual buttons move a trip on day one;
 * this route lets a GPS provider move it instead, through the SAME door —
 * `applyTripEvent`, source `gps` — so the state machine and the events
 * timeline (D7) cannot differ between the two.
 *
 * ## THE SECRET IS CHECKED HERE BECAUSE `proxy.ts` STANDS DOWN FOR /api/transport/
 *
 * Same shape as `/api/cron/approval-sla`: a vendor carries no session, and the
 * login gate's 307 would be a request it retries forever. So auth moves into
 * this handler — `x-transport-secret` against `TRANSPORT_WEBHOOK_SECRET`,
 * compared in constant time. UNSET, EVERYTHING IS REFUSED with 503: this route
 * moves trips and frees vehicles, and an environment variable nobody set is
 * not consent.
 *
 * ## AN EVENT THAT CAN NEVER APPLY ANSWERS 200
 *
 * A vendor retries anything non-2xx. An unknown device, a vehicle with no open
 * trip, or an exit before an enter will be exactly as unappliable on the
 * hundredth retry, so they answer 200 `{ ignored: reason }`. Only a failure on
 * OUR side (the database) answers 500, because that one is worth retrying.
 *
 * ## THE PRIVILEGED CLIENT HAS NO CURRENT UNIT (AGENTS.md "Locations")
 *
 * Trips are unit-scoped and the admin client has no `current_location()`, so
 * nothing here may lean on a default: the trip's own `location_id` is read and
 * handed to `applyTripEvent` explicitly. Today the event row follows its trip
 * (a child table, no unit column of its own), so the value is belt and braces
 * — it stops being optional the day anything the door writes gains one.
 */

/** Never prerendered, never cached — it mutates. */
export const dynamic = "force-dynamic";

type Place = { id: string; lat: number | null; lng: number | null; radius_m: number | null };

/** sha-256 both sides first, so the compare is constant-time AND length-blind. */
function secretMatches(given: string | null, secret: string): boolean {
  if (!given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

const ignored = (reason: string) => NextResponse.json({ ignored: reason });
const failed = (error: string) => NextResponse.json({ error }, { status: 500 });

export async function POST(request: NextRequest) {
  const secret = process.env.TRANSPORT_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "TRANSPORT_WEBHOOK_SECRET is not set on this deployment, so GPS events are refused" },
      { status: 503 },
    );
  }
  if (!secretMatches(request.headers.get("x-transport-secret"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Body is not valid JSON" }, { status: 400 });
  }
  const parsed = telematicsEvent.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  }
  const ev = parsed.data;

  const db = createAdminClient();

  // ---- vehicle ---------------------------------------------------------------
  const { data: vehicle, error: vErr } = await db
    .from("transport_vehicles")
    .select("id, inactive")
    // Stored in CAPITALS (vehicleInput upper-cases it); a vendor may send any case.
    .eq("gps_device_id", ev.gps_device_id.trim().toUpperCase())
    .maybeSingle();
  if (vErr) return failed(vErr.message);
  if (!vehicle) return ignored("unknown_device");
  if (vehicle.inactive) return ignored("vehicle_inactive");

  // ---- its open trip ------------------------------------------------------------
  const { data: trips, error: tErr } = await db
    .from("transport_trips")
    .select("id, trip_no, trip_status, location_id")
    .eq("vehicle_id", vehicle.id)
    .in("trip_status", [...ACTIVE_TRIP_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1);
  if (tErr) return failed(tErr.message);
  const trip = trips?.[0] as { id: string; trip_no: string; trip_status: TripStatus; location_id: string } | undefined;
  if (!trip) return ignored("no_open_trip");

  // ---- the place -------------------------------------------------------------
  let placeId: string | null = null;
  if (ev.place_id) {
    const { data: p, error } = await db.from("transport_places").select("id").eq("id", ev.place_id).maybeSingle();
    if (error) return failed(error.message);
    placeId = p?.id ?? null;
  } else {
    const { data: places, error } = await db
      .from("transport_places")
      .select("id, lat, lng, radius_m")
      .eq("inactive", false)
      .not("lat", "is", null)
      .not("lng", "is", null);
    if (error) return failed(error.message);
    let best: { id: string; d: number } | null = null;
    for (const p of (places ?? []) as Place[]) {
      if (p.lat == null || p.lng == null || !p.radius_m) continue;
      const d = distanceM({ lat: ev.lat, lng: ev.lng }, { lat: Number(p.lat), lng: Number(p.lng) });
      if (d <= Number(p.radius_m) && (!best || d < best.d)) best = { id: p.id, d };
    }
    placeId = best?.id ?? null;
  }
  if (!placeId) return ignored("no_place");

  // ---- origin or destination, from the trip's own requests ----------------------
  const { data: reqs, error: rErr } = await db
    .from("transport_requisitions")
    .select("origin_place_id, destination_place_id, created_by, req_no")
    .eq("trip_id", trip.id);
  if (rErr) return failed(rErr.message);
  const isOrigin = (reqs ?? []).some((r) => r.origin_place_id === placeId);
  const isDest = (reqs ?? []).some((r) => r.destination_place_id === placeId);
  if (!isOrigin && !isDest) return ignored("place_not_on_trip");
  /* A place that is both (one request's drop is another's pickup) reads by
     where the trip is: before it has left, it is the origin. */
  const beforeLeaving = trip.trip_status === "planned" || trip.trip_status === "loading";
  const at: "origin" | "destination" = isOrigin && (!isDest || beforeLeaving) ? "origin" : "destination";

  const to = nextTripStatus(trip.trip_status, { kind: ev.event, at });
  if (!to) return ignored("no_transition");

  const res = await applyTripEvent(db, trip.id, to, "gps", {
    at: ev.at,
    lat: ev.lat,
    lng: ev.lng,
    place_id: placeId,
    location_id: trip.location_id,
  });
  if (res.error) return failed(res.error);
  // The SQL door re-checks the transition under a row lock; a GPS event that
  // raced a manual button is a no-op there, not a failure.
  if (res.ignored) return ignored("no_transition");

  /* A GPS "exit destination" completes the trip through trip-events.ts, which
     tells nobody — the manual path notifies in its action. Same event, same
     words and the same dedupe key as `notifyRequesters` (actions.ts), so a
     later Complete-with-costs on this trip cannot tell the requesters twice. */
  if (to === "completed") {
    const userIds = [...new Set((reqs ?? []).map((r) => r.created_by as string | null).filter((u): u is string => !!u))];
    if (userIds.length) {
      await notify(
        "transport.trip_completed",
        { userIds },
        {
          title: `Trip ${trip.trip_no} delivered`,
          body: (reqs ?? []).map((r) => r.req_no as string).join(", "),
          href: `/logistics/transport/trips/${trip.id}`,
          type: "success",
        },
        { dedupeKey: `transport.trip_completed:${trip.id}`, source: "cron" },
      );
    }
  }

  return NextResponse.json({ ok: true, trip_id: trip.id, from: trip.trip_status, to });
}
