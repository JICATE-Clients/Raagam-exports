import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TripEventSource, TripStatus } from "./types";

/**
 * THE ONE STATE-MACHINE DOOR (plan D6). The board's manual buttons (through the
 * `applyTripEvent` server action, which checks the permission first) and the GPS
 * webhook (`app/api/transport/telematics`, with the admin client) both land here,
 * so a trip cannot move one way by hand and another by GPS.
 *
 * Not "use server": it takes the CLIENT as an argument — a session client from
 * the action, the service-role client from the webhook — and a "use server" file
 * would expose it as a public endpoint. It calls `transport_apply_event` (0766),
 * which locks the trip, lets `transport_trips_guard` refuse an illegal move, and
 * writes the event row in the same transaction. The vehicle and the requests
 * follow by trigger.
 *
 * `location_id` is accepted for the webhook's benefit and not needed: events are
 * a child table, scoped through their trip, so nothing here defaults a unit.
 */
export type TripEventMeta = {
  at?: string | null;
  lat?: number | null;
  lng?: number | null;
  place_id?: string | null;
  note?: string | null;
  location_id?: string | null;
};

export async function applyTripEvent(
  client: SupabaseClient,
  tripId: string,
  toStatus: TripStatus,
  source: TripEventSource,
  meta: TripEventMeta = {},
): Promise<{ error: string | null; ignored?: boolean; from?: TripStatus }> {
  const { data, error } = await client.rpc("transport_apply_event", {
    p_trip_id: tripId,
    p_to_status: toStatus,
    p_source: source,
    p_at: meta.at ?? null,
    p_lat: meta.lat ?? null,
    p_lng: meta.lng ?? null,
    p_place_id: meta.place_id ?? null,
    p_note: meta.note ?? null,
  });
  if (error) return { error: error.message };
  const r = (data ?? {}) as { ignored?: boolean; from?: TripStatus };
  return { error: null, ignored: !!r.ignored, from: r.from };
}
