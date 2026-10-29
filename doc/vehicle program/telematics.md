# Transport telematics webhook — what a GPS vendor must send

GPS is **optional** (plan.md D6). Every trip can be moved by hand from the Fleet
Board (Start loading · Left origin · Reached · Complete). When a GPS provider is
chosen, it posts geofence events here and the trip moves by itself — through the
**same** state-machine door the buttons use (`applyTripEvent`), and every move
is written to the trip's events timeline with source `gps`.

## Endpoint

```
POST https://<your-deployment>/api/transport/telematics
Content-Type: application/json
x-transport-secret: <TRANSPORT_WEBHOOK_SECRET>
```

POST only. The route lives outside the login gate (`proxy.ts` stands down for
`/api/transport/`, as it does for `/api/cron/`); the secret header is the
authorisation.

## Set this in Vercel

| Variable | Value |
|---|---|
| `TRANSPORT_WEBHOOK_SECRET` | A long random string (e.g. `openssl rand -hex 32`). Give the same string to the GPS vendor as the `x-transport-secret` header. |

**Unset, the route refuses every request with 503** and says which variable is
missing. It does not fall open: this endpoint moves trips and frees vehicles,
and an environment variable nobody set is not consent.

## Body

```json
{
  "gps_device_id": "GT06-861234567890123",
  "event": "enter",
  "place_id": "6f1c…-uuid",
  "lat": 11.0168,
  "lng": 76.9558,
  "at": "2026-10-29T09:42:10+05:30"
}
```

| Field | Required | Meaning |
|---|---|---|
| `gps_device_id` | yes | The device id as entered on the vehicle in Logistics ▸ Transport ▸ Vehicles (GPS device). Case does not matter — it is matched in capitals. |
| `event` | yes | `"enter"` or `"exit"` — the vehicle crossed INTO or OUT OF a geofence. |
| `place_id` | no | The Transport Place id, when the vendor's geofences were created from our places. Preferred. |
| `lat`, `lng` | yes | Where the vehicle was. Used to find the place when `place_id` is absent: the nearest active Transport Place whose radius (`radius_m`) contains the point. |
| `at` | yes | When it happened, ISO 8601 **with a timezone** (`Z` or `+05:30`). |

## How an event moves a trip

The vehicle's **open** trip (not completed or cancelled) is found from the
device. The place is then classed as that trip's **origin** or **destination**
from the requests on it, and the pair goes through `nextTripStatus`:

| Event at | Trip moves |
|---|---|
| enter origin | → Loading |
| exit origin | → En Route |
| enter destination | → Unloading |
| exit destination | → Completed (vehicle released to Idle) |

Anything else — a repeat, an exit before an enter, a place not on the trip —
changes nothing.

Completing by GPS tells the people who booked the requests (alert
`transport.trip_completed`, once per trip however it completes). It sets the
status only. The trip's **costs** (end odometer,
fuel, allowance, toll, other) are still entered on the trip document, which is
what writes the order-wise cost allocation.

## Responses

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ "ok": true, "trip_id": "…", "from": "loading", "to": "en_route" }` | The trip moved. |
| 200 | `{ "ignored": "<reason>" }` | Accepted, nothing to do. Do **not** retry. Reasons: `unknown_device`, `vehicle_inactive`, `no_open_trip`, `no_place`, `place_not_on_trip`, `no_transition`. |
| 400 | `{ "error": "…" }` | The body is not valid JSON or fails validation. Fix the payload; retrying the same body will fail the same way. |
| 401 | `{ "error": "Unauthorized" }` | Missing or wrong `x-transport-secret`. |
| 503 | `{ "error": "TRANSPORT_WEBHOOK_SECRET is not set …" }` | The deployment is not configured. |
| 500 | `{ "error": "…" }` | Our side failed (database). Retry with backoff — the event will apply then. |

Ignored events answer 200 on purpose: a GPS vendor retries on anything non-2xx,
and an event that can never apply must not be retried forever.

## Try it

```bash
curl -X POST "https://<your-deployment>/api/transport/telematics" \
  -H "Content-Type: application/json" \
  -H "x-transport-secret: $TRANSPORT_WEBHOOK_SECRET" \
  -d '{
        "gps_device_id": "GT06-861234567890123",
        "event": "exit",
        "lat": 11.0168,
        "lng": 76.9558,
        "at": "2026-10-29T09:42:10+05:30"
      }'
```

Before a vendor is live, this curl is also how to check a place's coordinates
and radius: post an `enter` at the place's lat/lng against a vehicle with a
planned trip, and the Fleet Board should show it Loading.
