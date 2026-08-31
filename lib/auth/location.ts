import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getAppUser } from "./server";
import type { AppLocation } from "./types";

/**
 * THE SESSION'S CURRENT UNIT.
 *
 * Raagam runs one database for several GST entities — Head Office today, Unit 1
 * and Unit 2 to follow (`public.locations`, seeded with HO + U2 since 0002).
 * Only **Master Data module** entities are common across them; everything else
 * — orders, purchase, stores, finance, HR, production — is maintained
 * separately per unit (client 2026-08-31).
 *
 * This file answers one question, once per request: **which unit is the
 * operator working in right now?**
 *
 *
 * ## THE ANSWER LIVES IN THE DATABASE, NOT IN A COOKIE
 *
 * It used to be a cookie, and that was wrong for a reason worth keeping: RLS
 * policies decide what a query returns, and **Postgres cannot read an HTTP
 * cookie**. So the unit had to be re-applied as a filter in application code —
 * 170 read paths, 39 on `sales_orders` alone across 28 files — and every one
 * that was missed would quietly show both units' rows. That is precisely the
 * `created_by` sweep AGENTS.md records (143 list functions, 74 files), whose
 * failure mode is not an error but a wrong answer that looks ordinary.
 *
 * 0487 promoted the unit to `profiles.current_location_id`. Every policy in the
 * database now narrows to it, so a list is filtered whether or not its service
 * remembered to ask — and a service *cannot* forget.
 *
 * **This module and `current_location()` must agree exactly.** Both run the
 * same three-step landing chain — stored unit, home unit, house default — over
 * the same rows `my_locations()` returns (0489). If they diverged, the Location
 * box would name one unit while the policies served another, and the operator
 * would read "Head Office" above an empty screen with nothing to explain it.
 * That is why the chain is duplicated deliberately rather than being applied on
 * only one side (see 0487a).
 *
 *
 * ## STILL NEVER A PERMISSION
 *
 * `setCurrentLocation` validates against `my_locations()` before writing, and
 * `is_current_location()` re-checks `has_location_access()` on every row anyway.
 * So a stale or tampered value cannot widen access: the worst it can do is name
 * a unit the operator may no longer use, and be refused.
 */

/** A unit the operator may act in. Declared in `./types` (shared server+client). */
export type { AppLocation };

/**
 * The units this operator may act in, active only, in code order.
 *
 * Straight through to `my_locations()` (0483), which delegates to
 * `has_location_access()` — deliberately NOT `is_current_location()`. The
 * switcher must offer every unit the operator can reach; narrowing it to the
 * current one would leave them unable to switch away from it, ever. 0487's
 * CHECK E asserts this.
 */
export const listMyLocations = cache(async (): Promise<AppLocation[]> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_locations");
  const rows = (data ?? []) as {
    id: string;
    code: string;
    name: string;
    is_default: boolean;
  }[];
  return rows.map((l) => ({
    id: l.id,
    code: l.code,
    name: l.name,
    isDefault: l.is_default,
  }));
});

/**
 * Decide the session's unit from what the profile holds.
 *
 * Pure and exported so the decision is testable without a request, and so the
 * policy below can be changed in one place rather than hunted through callers.
 *
 * ---------------------------------------------------------------------------
 * ## THE LANDING CHAIN — AND IT MUST MATCH current_location() EXACTLY
 *
 *   1. `currentLocationId`  — what they last switched to
 *   2. `defaultLocationId`  — their home unit, an administrator's statement
 *   3. `isDefault`          — the house default (Head Office)
 *
 * every step looked up **in `allowed`**, which is `my_locations()`: active
 * locations this operator may reach. A stored unit since deactivated or
 * revoked therefore falls through rather than being honoured.
 *
 * `current_location()` (0489) runs this same chain over the same rows. THE TWO
 * MUST NEVER DIVERGE. When only one side knew about a fallback, the Location
 * box named a unit the policies did not serve, and the operator read "Head
 * Office" above an empty screen with nothing on it to explain why (0487a). If
 * you change this function, change that one in the same commit.
 *
 * ## STEP 3 REVERSES THE ORIGINAL FAIL-CLOSED LANDING, ON INSTRUCTION
 *
 * This used to return null when steps 1 and 2 produced nothing, so the switcher
 * opened on "Select unit…" and the operator chose. The reasoning was that
 * picking for them answers "which company's books?" — and it still holds
 * against `allowed[0]`, which decides a GST entity by array order.
 *
 * The user was shown that objection and chose the default anyway
 * (2026-08-31: "Default load the head office, if may need user will update"),
 * so it is implemented. What makes it defensible rather than a guess is that
 * step 3 reads an explicit FLAG: `locations.is_default`, unique by index, a
 * stated fact about the business rather than an accident of ordering. Landing
 * is still reported as `source: "fallback"` so the chrome can say the unit was
 * not chosen by the operator.
 *
 * Restoring the fail-closed behaviour needs a new decision, not a tidy-up.
 * ---------------------------------------------------------------------------
 */
export function resolveCurrentLocation(
  allowed: AppLocation[],
  currentLocationId: string | null,
  defaultLocationId: string | null,
): {
  location: AppLocation | null;
  source: "stored" | "default" | "fallback" | "none";
} {
  if (allowed.length === 0) return { location: null, source: "none" };

  const stored = currentLocationId
    ? (allowed.find((l) => l.id === currentLocationId) ?? null)
    : null;
  if (stored) return { location: stored, source: "stored" };

  const home = defaultLocationId
    ? (allowed.find((l) => l.id === defaultLocationId) ?? null)
    : null;
  if (home) return { location: home, source: "default" };

  // The house default — Head Office. Only reached when the profile names no
  // unit at all, and only when this operator may actually use it: a Unit-2-only
  // operator does not land on HO, they land on nothing and pick, because
  // showing them a unit they cannot read from is the empty-screen bug again.
  const house = allowed.find((l) => l.isDefault) ?? null;
  if (house) return { location: house, source: "fallback" };

  return { location: null, source: "none" };
}

/**
 * The session's current unit, or null when none can be established.
 *
 * `cache()`d per request, so a layout, its page and any action it calls all see
 * the same unit — a request that resolved two different units halfway through
 * would stamp a document with one and number it from the other.
 */
export const getCurrentLocation = cache(
  async (): Promise<{
    location: AppLocation | null;
    source: "stored" | "default" | "fallback" | "none";
    allowed: AppLocation[];
  }> => {
    const [allowed, user] = await Promise.all([listMyLocations(), getAppUser()]);

    const resolved = resolveCurrentLocation(
      allowed,
      user?.currentLocationId ?? null,
      user?.defaultLocationId ?? null,
    );

    return { ...resolved, allowed };
  },
);

/**
 * The current unit's id, or null — the form most callers want.
 *
 * Deliberately NOT throwing on null. A read-only screen is valid with no unit
 * resolved; it is a WRITE with no unit that must be refused, and refusing it at
 * the point of writing gives a far better message than a layout-level throw
 * that blanks the whole app.
 */
export async function getCurrentLocationId(): Promise<string | null> {
  const { location } = await getCurrentLocation();
  return location?.id ?? null;
}

/**
 * The unit to STAMP A NEW DOCUMENT with, or a reason it cannot be determined.
 *
 * Since 0488 the database also carries `default public.current_location()` on
 * every scoped `location_id`, so an INSERT that omits the column still lands in
 * the right unit — which is what makes the ~30 forms that never set it correct
 * without being edited. This helper is still worth calling from an action that
 * builds its payload explicitly: it fails with a sentence the operator can act
 * on, rather than letting the row reach a NOT NULL violation whose message
 * names a column.
 *
 * Returns a result rather than throwing so a caller can surface the reason —
 * "no unit selected" is fixable in one click, and an uncaught throw would show
 * a generic error boundary instead.
 */
export async function resolveWriteLocation(): Promise<
  { ok: true; locationId: string } | { ok: false; error: string }
> {
  const { location, allowed } = await getCurrentLocation();

  if (location) return { ok: true, locationId: location.id };

  return {
    ok: false,
    error:
      allowed.length === 0
        ? "You are not assigned to any unit, so this cannot be saved. Ask an administrator to grant you access to a unit."
        : "No unit is selected. Choose one from the Location box at the top of the screen, then save again.",
  };
}
