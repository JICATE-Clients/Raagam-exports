import type { NeedCell, StripCell } from "@/components/viz/kit";
import { count, outOf, relDays, whenOf, type SayLine } from "./words";

/**
 * TRANSPORT ▸ OVERVIEW — the rules, pure (plan https://claude.ai/artifact/5e8SGWe8DPHC7Ua2fQyaiW,
 * wave 2, built 2026-11-06).
 *
 * A request is WAITING while it is pending or pooled (no vehicle yet), MOVING while assigned to
 * a trip, DONE when completed. A trip is OUT while in one of the active statuses
 * (`ACTIVE_TRIP_STATUSES`). Live position is NOT measurable — there is no GPS vendor — so the
 * page shows each trip's stage, never a guessed location.
 */

export type ReqRow = { id: string; no: string; status: string; dispatchAt: string | null; from: string; to: string; material: string; weightKg: number | null; createdBy: string | null };
export type TripRow = { id: string; no: string; status: string; vehicle: string; driver: string; plannedAt: string; completedAt: string | null };
export type VehicleRow = { id: string; no: string; status: string; inactive: boolean };

export const TRIP_STAGES = [
  { key: "planned", label: "Planned" },
  { key: "loading", label: "Loading" },
  { key: "en_route", label: "On the road" },
  { key: "unloading", label: "Unloading" },
  { key: "returning", label: "Returning" },
] as const;

export function transportOverview(reqs: readonly ReqRow[], trips: readonly TripRow[], vehicles: readonly VehicleRow[], todayIso: string) {
  const waiting = reqs.filter((r) => r.status === "pending" || r.status === "pooled").sort((a, b) => (a.dispatchAt ?? "9").localeCompare(b.dispatchAt ?? "9"));
  const late = waiting.filter((r) => whenOf(r.dispatchAt, todayIso) === "late");
  const moving = reqs.filter((r) => r.status === "assigned");
  const out = trips.filter((t) => TRIP_STAGES.some((s) => s.key === t.status));
  const closing = out.filter((t) => t.status === "unloading" || t.status === "returning");
  const usable = vehicles.filter((v) => !v.inactive);
  const down = usable.filter((v) => v.status === "maintenance");
  const free = usable.filter((v) => v.status === "idle");
  const label = (r: ReqRow) => `${r.no} (${r.from} → ${r.to})`;

  const say: SayLine[] = [];
  if (!reqs.length && !trips.length) say.push({ text: "No trip has been requested yet.", mood: "quiet" });
  if (waiting.length)
    say.push({
      text: `${count(waiting.length, "request")} ${waiting.length === 1 ? "is" : "are"} waiting for a vehicle${
        waiting[0].dispatchAt ? `; the first, ${label(waiting[0])}, is due ${relDays(waiting[0].dispatchAt, todayIso)}` : ""
      }.`,
      mood: late.length ? "problem" : "look",
      href: "/logistics/transport/dispatch",
      linkText: "Dispatch",
    });
  if (out.length)
    say.push({
      text: `${count(out.length, "trip")} ${out.length === 1 ? "is" : "are"} out now${closing.length ? `; ${closing.length} ${closing.length === 1 ? "is" : "are"} unloading or coming back` : ""}.`,
      mood: "normal",
      href: "/logistics/transport/board",
      linkText: "Fleet Board",
    });
  if (usable.length)
    say.push({
      text: `${outOf(free.length, usable.length)} vehicles are free${down.length ? `; ${down.length} in maintenance` : ""}.`,
      mood: free.length ? "good" : "look",
    });
  if (trips.length || reqs.length)
    say.push({ text: "Where each vehicle is right now can't be shown yet: no GPS device is connected, so trips show their stage.", mood: "quiet" });
  if (reqs.length && !waiting.length && !out.length) say.push({ text: "Every request has a vehicle and no trip is out.", mood: "good" });

  const strip: StripCell[] = [
    { label: "Waiting for a vehicle", value: count(waiting.length, "request"), hint: late.length ? `${late.length} past dispatch date` : waiting.length ? "on time" : "none", mood: late.length ? "problem" : waiting.length ? "look" : "good", href: "/logistics/transport/requests" },
    { label: "On a trip", value: count(moving.length, "request"), hint: `${count(out.length, "trip")} out`, mood: "normal", href: "/logistics/transport/board" },
    { label: "Trips out", value: count(out.length, "trip"), hint: closing.length ? `${closing.length} closing` : "none closing", mood: out.length ? "normal" : "quiet" },
    { label: "Free vehicles", value: outOf(free.length, usable.length), hint: down.length ? `${down.length} in maintenance` : "none in maintenance", mood: free.length ? "good" : "look", href: "/logistics/transport/vehicles" },
  ];

  const needs: NeedCell[] = [
    {
      title: "Assign a vehicle",
      mood: late.length ? "problem" : waiting.length ? "look" : "good",
      count: waiting.length ? count(waiting.length, "request") : "None",
      text: waiting.length ? waiting.map(label).join(" · ") : "Every request has a vehicle",
      href: waiting.length ? "/logistics/transport/dispatch" : undefined,
      linkText: "Dispatch",
    },
    {
      title: "Close trips",
      mood: closing.length ? "look" : "good",
      count: closing.length ? count(closing.length, "trip") : "None",
      text: closing.length ? closing.map((t) => `${t.no} · ${t.vehicle}`).join(" · ") : "No trip is waiting to be closed",
      href: closing.length ? "/logistics/transport/board" : undefined,
      linkText: "Fleet Board",
    },
    {
      title: "Vehicles down",
      mood: down.length ? "look" : "good",
      count: down.length ? count(down.length, "vehicle") : "None",
      text: down.length ? down.map((v) => v.no).join(" · ") : "Every vehicle is available",
      href: down.length ? "/logistics/transport/vehicles" : undefined,
      linkText: "Vehicles",
    },
  ];

  return { say, strip, needs, waiting, out };
}
