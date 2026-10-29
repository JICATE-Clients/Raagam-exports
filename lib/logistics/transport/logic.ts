import type { GeofenceEvent, TripStatus } from "./types";

/*
 * The transport module's arithmetic and its state machine — pure, no I/O, and
 * no runtime import (only `import type`), so `scripts/check-transport-logic.mts`
 * runs it under plain `node --experimental-strip-types` with no alias resolver.
 * The screens, the server actions and the GPS webhook all call these; none of
 * them re-derives a percentage or a transition on its own.
 */

/** Round to `dp` decimals without the 1.005 → 1.00 float trap. */
function roundTo(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/**
 * How full a vehicle is (spec §3A): Σ request weights ÷ max payload × 100, to 2 dp.
 * A vehicle with no payload carries nothing: anything on it is Infinity (past 100%,
 * so Dispatch stays disabled), nothing on it is 0.
 */
export function utilisationPct(weights: readonly number[], maxPayloadKg: number): number {
  const total = weights.reduce((s, w) => s + (Number.isFinite(w) && w > 0 ? w : 0), 0);
  if (!(maxPayloadKg > 0)) return total > 0 ? Number.POSITIVE_INFINITY : 0;
  return roundTo((total / maxPayloadKg) * 100, 2);
}

/**
 * Split `units` (an integer: paise, or hundredths of a percent) over `weights`
 * pro rata, each part rounded, and the rounding REMAINDER added to the line with
 * the largest weight (the first such line on a tie) — so the parts always sum to
 * `units` exactly (plan D5). All weights zero → equal shares.
 */
function splitUnits(units: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const total = clean.reduce((s, w) => s + w, 0);
  const basis = total > 0 ? clean : clean.map(() => 1);
  const basisTotal = total > 0 ? total : basis.length;
  const parts = basis.map((w) => Math.round((units * w) / basisTotal));
  const remainder = units - parts.reduce((s, p) => s + p, 0);
  let largest = 0;
  for (let i = 1; i < basis.length; i++) if (basis[i] > basis[largest]) largest = i;
  parts[largest] += remainder;
  return parts;
}

/**
 * Pro-rata order cost (spec §3C): each line's share of the trip's cost by its
 * share of the loaded weight. Money to the paisa, percent to 0.01, and both sum
 * EXACTLY — Σ allocated_cost = totalCost and Σ weight_pct = 100 — because the
 * rounding remainder goes to the largest line instead of vanishing.
 */
export function allocateCost<K>(
  totalCost: number,
  lines: readonly { key: K; weight_kg: number }[],
): { key: K; weight_pct: number; allocated_cost: number }[] {
  if (lines.length === 0) return [];
  const weights = lines.map((l) => l.weight_kg);
  const paise = splitUnits(Math.round(roundTo(totalCost, 2) * 100), weights);
  const pctHundredths = splitUnits(10_000, weights);
  return lines.map((l, i) => ({
    key: l.key,
    weight_pct: pctHundredths[i] / 100,
    allocated_cost: paise[i] / 100,
  }));
}

/**
 * The geofence state machine (spec §3B). `null` means the event does not apply
 * to a trip in this state and is IGNORED — a GPS unit re-reporting "inside the
 * factory" on a trip already en route must not drag it back to Loading.
 *
 *   planned   + enter origin       → loading
 *   planned   + exit origin        → en_route   (the tracker came on inside the fence)
 *   loading   + exit origin        → en_route
 *   en_route  + enter destination  → unloading
 *   unloading + exit destination   → completed
 */
export function nextTripStatus(current: TripStatus, event: GeofenceEvent): TripStatus | null {
  if (event.at === "origin") {
    if (event.kind === "enter") return current === "planned" ? "loading" : null;
    return current === "planned" || current === "loading" ? "en_route" : null;
  }
  if (event.kind === "enter") return current === "en_route" ? "unloading" : null;
  return current === "unloading" ? "completed" : null;
}

/**
 * Every move `applyTripEvent` accepts, GPS or manual. Forward only; a trip may
 * be cancelled until it has left its origin, never after (the goods are on the
 * road). Nothing leaves `completed` or `cancelled`.
 */
const ALLOWED: Record<TripStatus, readonly TripStatus[]> = {
  planned: ["loading", "en_route", "cancelled"],
  loading: ["en_route", "cancelled"],
  en_route: ["unloading"],
  unloading: ["completed"],
  completed: [],
  cancelled: [],
};

export function canTransition(from: TripStatus, to: TripStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** The one step the board's manual button offers next (Start loading · Left origin · Reached · Complete). */
export function manualNextStatus(current: TripStatus): TripStatus | null {
  switch (current) {
    case "planned":
      return "loading";
    case "loading":
      return "en_route";
    case "en_route":
      return "unloading";
    case "unloading":
      return "completed";
    default:
      return null;
  }
}

/** The manual button's wording for the move to `to`. */
export const MANUAL_ACTION_LABEL: Partial<Record<TripStatus, string>> = {
  loading: "Start loading",
  en_route: "Left origin",
  unloading: "Reached",
  completed: "Complete",
  cancelled: "Cancel trip",
};

/** Distance from the two odometer readings; NULL while either is missing or it runs backwards. */
export function tripDistanceKm(startKm: number | null, endKm: number | null): number | null {
  if (startKm == null || endKm == null || endKm < startKm) return null;
  return roundTo(endKm - startKm, 1);
}

/** fuel + allowance + toll + other, to the paisa (mirrors the generated column). */
export function tripTotalCost(c: { fuel_cost: number; driver_allowance: number; toll_cost: number; other_cost: number }): number {
  return roundTo(c.fuel_cost + c.driver_allowance + c.toll_cost + c.other_cost, 2);
}

/** Great-circle distance in metres — the webhook's "is this lat/lng inside a place's radius". */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
