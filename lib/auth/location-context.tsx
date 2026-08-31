"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AppLocation } from "./types";

/**
 * The session's current unit, seeded once in the app shell from the
 * server-resolved answer (`getCurrentLocation()` in `./location.ts`), which
 * reads the same `profiles.current_location_id` every RLS policy narrows to.
 *
 * Deliberately mirrors `PermissionProvider` next door — same shape, same
 * seeded-from-the-layout lifecycle — because the two answer the same KIND of
 * question ("who is this operator and what may they touch?") and a screen
 * reaching for one will look for the other in the same place.
 *
 * READ-ONLY ON PURPOSE. There is no setter on this context. A unit is changed
 * by the `setCurrentLocation` Server Action, which validates the id and writes
 * `profiles.current_location_id`; the new value arrives back through a
 * re-render of the layout.
 * A client-side setter would let the two disagree — the chrome showing Unit 2
 * while every server read still answered HO — which is a subtler version of the
 * bug this whole phase exists to fix.
 */
interface LocationState {
  /** The unit in force, or null when none could be established. */
  current: AppLocation | null;
  /** Every unit this operator may switch to. */
  allowed: AppLocation[];
  /**
   * Where `current` came from. `"default"` is their home unit and `"fallback"`
   * is the house default (Head Office) — in both cases the operator did not
   * choose this unit, and the chrome says so, because silently placing someone
   * in a GST entity they did not pick is the one outcome worth announcing.
   */
  source: "stored" | "default" | "fallback" | "none";
}

const LocationContext = createContext<LocationState | null>(null);

export function LocationProvider({
  value,
  children,
}: {
  value: LocationState;
  children: ReactNode;
}) {
  return (
    <LocationContext.Provider value={value}>
      {children}
    </LocationContext.Provider>
  );
}

/**
 * The session's unit state.
 *
 * Throws outside the provider, exactly as `useAppUser` does: a screen that
 * silently read `null` would stamp a document with no unit, and while
 * `location_id` is still nullable (Phase 3) nothing downstream would object.
 */
export function useLocationState(): LocationState {
  const state = useContext(LocationContext);
  if (!state) {
    throw new Error("useLocationState must be used within a LocationProvider");
  }
  return state;
}

/**
 * The current unit's id, or null.
 *
 * The form a screen wants when stamping a new record. Callers must handle null
 * — a read-only screen is fine without a unit; a WRITE without one must be
 * refused at the point of writing, where the message can say why.
 */
export function useCurrentLocationId(): string | null {
  return useLocationState().current?.id ?? null;
}
