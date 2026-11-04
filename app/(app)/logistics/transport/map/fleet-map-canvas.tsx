"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import L from "leaflet";
import { Circle, CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { fmtDateTime } from "@/lib/format";
import { TRANSPORT_STATUS_LABEL, type FleetMapTrip, type PlaceKind, type TransportPlace } from "@/lib/logistics/transport/types";
import { fmtKg } from "../_shared/transport-ui";

/**
 * THE MAP ITSELF — Leaflet on OpenStreetMap tiles (user 2026-11-04: no billing
 * account, no API key). Loaded only in the browser (`fleet-map-screen.tsx`
 * imports it with `ssr: false`): Leaflet touches `window` on import.
 *
 * NO DEFAULT MARKER IMAGES. Leaflet's stock pin is a PNG resolved from a CSS
 * path that bundlers break, so every mark here is drawn — a circle for a fence,
 * a dot for its centre, an inline-SVG `divIcon` for a vehicle.
 */

/** Fence colours by kind — ours in the brand blue, vendors amber, the rest grey. */
const KIND_COLOUR: Record<PlaceKind, string> = { unit: "#037bb8", vendor: "#d97706", other: "#64748b" };

/** Tiruppur — where the map opens before any place has coordinates. */
const HOME_VIEW: [number, number] = [11.1085, 77.3411];

function truckIcon(source: "gps" | "place"): L.DivIcon {
  // A solid badge for a GPS fix, an outlined one for "standing at a place" —
  // the two must not look alike, one is a measurement and the other an inference.
  const fill = source === "gps" ? "#037bb8" : "#ffffff";
  const stroke = source === "gps" ? "#ffffff" : "#037bb8";
  return L.divIcon({
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<div style="width:30px;height:30px;border-radius:9999px;background:${fill};border:2px solid #037bb8;display:grid;place-items:center;box-shadow:0 1px 4px rgba(0,0,0,.25)">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>
    </div>`,
  });
}

/** Fit everything once, on first paint — after that the operator owns the view. */
function FitOnce({ points }: { points: [number, number][] }) {
  const map = useMap();
  // A ref, not state: "already fitted" is not something to render, and the
  // minute refresh hands in a new `points` array that must not re-fit the view.
  const done = useRef(false);
  useEffect(() => {
    if (done.current || points.length === 0) return;
    if (points.length === 1) map.setView(points[0], 14);
    else map.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
    done.current = true;
  }, [map, points]);
  return null;
}

/** Fly to the trip picked in the rail. */
function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 14), { duration: 0.6 });
  }, [map, target]);
  return null;
}

/**
 * CLICK FOR A COORDINATE — the Places master asks for Latitude / Longitude, and
 * the way to know them is to point at the gate. A click shows the point with a
 * Copy button; nothing is saved from here.
 */
function PickPoint() {
  const [pt, setPt] = useState<{ lat: number; lng: number } | null>(null);
  const [copied, setCopied] = useState(false);
  useMapEvents({
    click(e) {
      setPt({ lat: e.latlng.lat, lng: e.latlng.lng });
      setCopied(false);
    },
  });
  if (!pt) return null;
  const text = `${pt.lat.toFixed(6)}, ${pt.lng.toFixed(6)}`;
  return (
    <Popup position={[pt.lat, pt.lng]} eventHandlers={{ remove: () => setPt(null) }}>
      <div className="space-y-1.5 text-xs">
        <div className="text-muted-foreground">Latitude, Longitude</div>
        <div className="font-mono font-semibold tabular-nums">{text}</div>
        <button
          type="button"
          className="rounded-md border border-[#dde4eb] px-2 py-0.5 text-xs hover:bg-[#f5f7f9]"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </Popup>
  );
}

export function FleetMapCanvas({
  places,
  trips,
  focus,
}: {
  places: TransportPlace[];
  trips: FleetMapTrip[];
  focus: [number, number] | null;
}) {
  const fenced = useMemo(() => places.filter((p) => !p.inactive && p.lat != null && p.lng != null), [places]);
  const pinned = useMemo(() => trips.filter((t) => t.position), [trips]);
  const points = useMemo<[number, number][]>(
    () => [
      ...fenced.map((p) => [p.lat!, p.lng!] as [number, number]),
      ...pinned.map((t) => [t.position!.lat, t.position!.lng] as [number, number]),
    ],
    [fenced, pinned],
  );
  const icons = useMemo(() => ({ gps: truckIcon("gps"), place: truckIcon("place") }), []);

  return (
    <MapContainer center={HOME_VIEW} zoom={11} scrollWheelZoom className="h-full w-full" attributionControl>
      {/* OSM's tile policy asks for this attribution — it must stay visible. */}
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
      />
      <FitOnce points={points} />
      <FlyTo target={focus} />
      <PickPoint />

      {fenced.map((p) => {
        const c = KIND_COLOUR[p.kind];
        return (
          <Circle
            key={p.id}
            center={[p.lat!, p.lng!]}
            radius={p.radius_m}
            pathOptions={{ color: c, weight: 1.5, fillColor: c, fillOpacity: 0.12 }}
          >
            <Tooltip direction="top" offset={[0, -4]}>
              <span className="font-semibold">{p.name}</span> · fence {p.radius_m.toLocaleString("en-IN")} m
            </Tooltip>
          </Circle>
        );
      })}
      {fenced.map((p) => (
        <CircleMarker
          key={`${p.id}-dot`}
          center={[p.lat!, p.lng!]}
          radius={4}
          pathOptions={{ color: "#ffffff", weight: 1.5, fillColor: KIND_COLOUR[p.kind], fillOpacity: 1 }}
        >
          <Tooltip permanent direction="right" offset={[6, 0]} className="!border-0 !bg-transparent !p-0 !shadow-none">
            <span className="text-[11px] font-semibold text-[#334155] [text-shadow:0_0_3px_#fff,0_0_3px_#fff]">{p.name}</span>
          </Tooltip>
        </CircleMarker>
      ))}

      {pinned.map((t) => (
        <Marker key={t.id} position={[t.position!.lat, t.position!.lng]} icon={icons[t.position!.source]}>
          <Popup>
            <div className="space-y-0.5 text-xs">
              <div className="text-sm font-semibold">{t.vehicle_number}</div>
              <div>
                {t.trip_no} · {TRANSPORT_STATUS_LABEL[t.trip_status]}
              </div>
              <div className="text-muted-foreground">
                {t.origin_names.join(", ")} → {t.destination_names.join(", ")}
                {t.return_trip ? ` → ${t.return_place_name ?? "—"}` : ""}
              </div>
              <div className="text-muted-foreground">{fmtKg(t.total_loaded_weight_kg)} on board</div>
              <div className="text-muted-foreground">
                {t.position!.source === "gps"
                  ? `GPS fix ${fmtDateTime(t.position!.at)}`
                  : `At ${t.position!.place_name} (by status — no GPS fix)`}
              </div>
              <Link href={`/logistics/transport/trips/${t.id}`} className="font-medium text-[#037bb8] hover:underline">
                Open trip
              </Link>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
