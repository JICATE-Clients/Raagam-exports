"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonClasses } from "@/components/ui/button";
import { Truncated } from "@/components/ui/truncated";
import { DOC_CHIP, DOC_FRAME, DOC_RULE } from "@/components/purchase/doc-surface";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { fmtDateTime } from "@/lib/format";
import { applyTripEvent } from "@/lib/logistics/transport/actions";
import { MANUAL_ACTION_LABEL, manualNextStatus } from "@/lib/logistics/transport/logic";
import { VEHICLE_TYPE_LABEL, type TripRow, type VehicleOption } from "@/lib/logistics/transport/types";
import { TransportStatusPill, UtilisationBar, fmtKg } from "../_shared/transport-ui";

/**
 * Logistics ▸ Transport ▸ Fleet Board — one card per trip still holding its
 * vehicle, then the vehicles free or in the workshop.
 *
 * THE BUTTON IS THE GPS'S STAND-IN (plan D6). No GPS provider is chosen yet, so
 * each card offers the ONE next step (`manualNextStatus`) and it goes through
 * `applyTripEvent` — the same door the webhook uses, so a manual press and a
 * geofence crossing leave the same event row. The last step is different:
 * completing a trip means entering its costs, so "Complete" opens the trip
 * document's Complete form instead of finishing it blind.
 */
export function BoardScreen({
  trips,
  vehicles,
  canEdit,
}: {
  trips: TripRow[];
  vehicles: VehicleOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  // LIVE ENOUGH: a GPS crossing lands in the database, not in this tab, so the
  // board re-reads itself every minute. `router.refresh` keeps client state
  // (a press in flight) and only swaps the server payload.
  useEffect(() => {
    const t = window.setInterval(() => router.refresh(), 60_000);
    return () => window.clearInterval(t);
  }, [router]);

  const onTrip = new Set(trips.map((t) => t.vehicle_id));
  const free = vehicles.filter((v) => !v.inactive && !onTrip.has(v.id));

  function advance(t: TripRow) {
    const to = manualNextStatus(t.trip_status, t.return_trip);
    if (!to) return;
    setBusy(t.id);
    start(async () => {
      const res = await applyTripEvent(t.id, to);
      setBusy(null);
      if (res.ok) {
        success(`${t.vehicle_number}: ${MANUAL_ACTION_LABEL[to] ?? to}`);
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-heading">On a trip · {trips.length}</h2>
        {trips.length === 0 ? (
          <p className="text-sm text-muted-foreground">No vehicle is on a trip. Dispatch one from the pending pool.</p>
        ) : (
          /* AN EVEN GRID, NOT A WRAP: 20rem tracks share the row's spare width, so the
             cards line up in columns and every row ends flush with the pane. */
          <div className="grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(20rem,1fr))]">
            {trips.map((t) => {
              const next = manualNextStatus(t.trip_status, t.return_trip);
              const finishing = next === "completed";
              return (
                <article key={t.id} className={cn("flex flex-col", DOC_FRAME)}>
                  <header className="flex items-start justify-between gap-2 px-4 pt-3">
                    <div>
                      <Link
                        href={`/logistics/transport/trips/${t.id}`}
                        className="text-sm font-semibold text-primary hover:underline"
                      >
                        {t.vehicle_number}
                      </Link>
                      <Truncated
                        className="block text-xs text-muted-foreground"
                        text={`${t.trip_no} · ${t.driver_name}${t.driver_phone ? ` · ${t.driver_phone}` : ""}`}
                      />
                    </div>
                    <TransportStatusPill status={t.trip_status} />
                  </header>
                  {/* One line, revealed on hover: a long route wrapping made one card
                      taller than its neighbours and pushed its button out of line. */}
                  <Truncated
                    className="block px-4 pt-2 text-sm"
                    text={`${t.origin_names.join(", ") || "—"} → ${t.destination_names.join(", ") || "—"}${
                      t.return_trip ? ` → ${t.return_place_name ?? "—"}` : ""
                    }`}
                  />
                  <div className="space-y-1 px-4 pt-2 pb-3">
                    <div className="text-xs text-muted-foreground">
                      {fmtKg(t.total_loaded_weight_kg)} of {fmtKg(t.max_payload_kg)}
                    </div>
                    <UtilisationBar pct={t.utilisation_pct} />
                  </div>
                  <div className={cn("mt-auto flex h-12 items-center justify-between gap-2 rounded-b-xl bg-[#fafbfc] px-4", DOC_RULE)}>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      Last update {fmtDateTime(t.last_event_at ?? t.planned_at)}
                    </span>
                    {canEdit && next &&
                      (finishing ? (
                        <Link
                          href={`/logistics/transport/trips/${t.id}#complete`}
                          className={buttonClasses({ variant: "outline", size: "sm" })}
                        >
                          {/* A round trip's last step is getting home; its costs come with it. */}
                          {t.trip_status === "returning" ? "Back home" : MANUAL_ACTION_LABEL.completed}
                        </Link>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() => advance(t)}
                        >
                          {busy === t.id ? "Saving…" : MANUAL_ACTION_LABEL[next]}
                        </Button>
                      ))}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-heading">Free or in the workshop · {free.length}</h2>
        {free.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every vehicle is on a trip.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {free.map((v) => (
              <li key={v.id} className={cn("flex items-center gap-2 px-3 py-2", DOC_FRAME)}>
                <span className="font-mono text-sm font-semibold tabular-nums">{v.vehicle_number}</span>
                <span className={DOC_CHIP}>
                  {VEHICLE_TYPE_LABEL[v.vehicle_type]} · {fmtKg(v.max_payload_kg)}
                </span>
                <TransportStatusPill status={v.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
