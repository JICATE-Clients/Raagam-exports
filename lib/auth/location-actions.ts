"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { listMyLocations } from "./location";

/**
 * Switch the session's current unit.
 *
 * Writes `profiles.current_location_id`, which is what every RLS policy in the
 * database narrows to (0487). There is no cookie: the unit has to be visible to
 * Postgres, because a policy is where the filtering actually happens, and a
 * cookie is exactly the thing a policy cannot read.
 *
 * THE VALIDATION HERE IS THE SECURITY BOUNDARY, not the dropdown that calls it.
 * The Topbar only ever offers units from `my_locations()`, but a Server Action
 * is a public HTTP endpoint — anything can post any uuid to it. So the id is
 * re-checked against the server's own list before it is written. This is the
 * same reasoning AGENTS.md gives for duplicate checks: the on-screen check "is
 * a courtesy; this one is the guard".
 *
 * Even if it were bypassed, `is_current_location()` re-checks
 * `has_location_access()` on every row, so a bad value cannot widen access —
 * it can only name a unit that is then refused.
 *
 * Returns a result rather than throwing: a failed switch should leave the
 * operator where they were with a message, not blank the screen with an error
 * boundary.
 */
export async function setCurrentLocation(
  locationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const allowed = await listMyLocations();

  if (!allowed.some((l) => l.id === locationId)) {
    // Covers a forged id, a stale tab whose dropdown predates a role change,
    // and a unit deactivated since the page rendered. All three are "you
    // cannot work there", and none is worth distinguishing to the operator.
    return { ok: false, error: "You do not have access to that unit." };
  }

  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) return { ok: false, error: "Not signed in." };

  const { error } = await supabase
    .from("profiles")
    .update({ current_location_id: locationId })
    .eq("id", user.user.id);

  if (error) return { ok: false, error: error.message };

  // The unit is read in the ROOT LAYOUT (app/(app)/layout.tsx) and by every
  // policy underneath it, so every rendered segment depends on it.
  // `revalidatePath("/", "layout")` is what makes a switch reach a list already
  // on screen; the caller's `router.refresh()` alone could still serve a cached
  // segment beneath it.
  revalidatePath("/", "layout");

  return { ok: true };
}
