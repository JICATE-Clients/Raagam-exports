"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DOC_CHIP, DOC_FRAME, RailSectionLabel } from "@/components/purchase/doc-surface";
import { Truncated } from "@/components/ui/truncated";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FleetMapTrip, TransportPlace } from "@/lib/logistics/transport/types";
import { TransportStatusPill } from "../_shared/transport-ui";

// Leaflet reads `window` on import, so the canvas never renders on the server.
const FleetMapCanvas = dynamic(() => import("./fleet-map-canvas").then((m) => m.FleetMapCanvas), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading the map…</div>,
});

/**
 * Logistics ▸ Transport ▸ Fleet Map (user 2026-11-04). The places and their
 * fences, and every trip still holding its vehicle — on the purchase document
 * surface: one frame, a title row of chips, the map beside a rail.
 *
 * THE RAIL LISTS EVERY TRIP, PINNED OR NOT. A vehicle En Route with no GPS fix
 * has no honest position, so it is not drawn on the map — and a map that simply
 * left it out would read as "that truck is not on the road". The rail says where
 * each one is, or that its position is unknown.
 *
 * Re-reads every minute like the Fleet Board (`router.refresh`): a GPS fix lands
 * in the database, not in this tab.
 */
export function FleetMapScreen({ places, trips }: { places: TransportPlace[]; trips: FleetMapTrip[] }) {
  const router = useRouter();
  const [focus, setFocus] = useState<[number, number] | null>(null);
  useEffect(() => {
    const t = window.setInterval(() => router.refresh(), 60_000);
    return () => window.clearInterval(t);
  }, [router]);

  const active = places.filter((p) => !p.inactive);
  const fenced = active.filter((p) => p.lat != null && p.lng != null);
  const unfenced = active.filter((p) => p.lat == null || p.lng == null);
  const pinned = trips.filter((t) => t.position).length;

  return (
    <div className={cn("flex flex-col", DOC_FRAME)}>
      {/* TITLE ROW: what is drawn, and the legend for it. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2.5">
        <h2 className="text-base font-bold">Fleet Map</h2>
        <span className={DOC_CHIP}>
          {fenced.length} of {active.length} places fenced
        </span>
        <span className={DOC_CHIP}>
          {trips.length} trip{trips.length === 1 ? "" : "s"} out · {pinned} on the map
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <Legend colour="#037bb8" label="Our unit" />
          <Legend colour="#d97706" label="Vendor" />
          <Legend colour="#64748b" label="Other" />
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-3 rounded-full border-2 border-[#037bb8] bg-[#037bb8]" /> GPS fix
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-3 rounded-full border-2 border-[#037bb8] bg-white" /> At a place (by status)
          </span>
        </span>
      </div>

      <div className="grid min-h-0 border-t border-[#dde4eb] md:grid-cols-[minmax(0,1fr)_18rem]">
        {/* `isolate`: Leaflet's panes sit at z-index 400–1000, which would float the
            map over the top bar and every sheet. A stacking context keeps them inside. */}
        <div className="isolate h-[60dvh] min-h-[22rem] md:h-[calc(100dvh-15rem)]">
          <FleetMapCanvas places={places} trips={trips} focus={focus} />
        </div>

        <aside className="max-h-[calc(100dvh-15rem)] overflow-y-auto border-t border-[#dde4eb] bg-[#fafbfc] md:border-t-0 md:border-l">
          <RailSectionLabel>On the road · {trips.length}</RailSectionLabel>
          {trips.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">No vehicle is on a trip.</p>
          ) : (
            <ul>
              {trips.map((t) => (
                <li key={t.id} className="border-b border-[#e8edf2]">
                  <button
                    type="button"
                    disabled={!t.position}
                    onClick={() => t.position && setFocus([t.position.lat, t.position.lng])}
                    className="block w-full space-y-0.5 px-3 py-2 text-left enabled:hover:bg-white disabled:cursor-default"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold tabular-nums">{t.vehicle_number}</span>
                      <TransportStatusPill status={t.trip_status} />
                    </span>
                    <Truncated
                      className="block text-xs text-muted-foreground"
                      text={`${t.origin_names.join(", ") || "—"} → ${t.destination_names.join(", ") || "—"}${
                        t.return_trip ? ` → ${t.return_place_name ?? "—"}` : ""
                      }`}
                    />
                    <span className="block text-[11px] text-muted-foreground">
                      {t.position
                        ? t.position.source === "gps"
                          ? `GPS fix ${fmtDateTime(t.position.at)}`
                          : `At ${t.position.place_name}`
                        : "Position unknown — no GPS fix yet"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <RailSectionLabel>No fence yet · {unfenced.length}</RailSectionLabel>
          {unfenced.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Every place has a fence.</p>
          ) : (
            <>
              <p className="px-3 pt-2 text-[11px] text-muted-foreground">
                Click the map at the gate to read its latitude and longitude, then enter them on the place.
              </p>
              <ul className="py-1">
                {unfenced.map((p) => (
                  <li key={p.id} className="px-3 py-1 text-xs">
                    <Truncated className="block" text={p.name} />
                  </li>
                ))}
              </ul>
              <div className="px-3 pb-3">
                <Link href="/logistics/transport/places" className="text-xs font-medium text-primary hover:underline">
                  Open Transport Places
                </Link>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="size-3 rounded-full border" style={{ borderColor: colour, background: `${colour}26` }} />
      {label}
    </span>
  );
}
