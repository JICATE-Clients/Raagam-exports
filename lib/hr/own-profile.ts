import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { getAppUser } from "@/lib/auth/server";

/**
 * "MY PROFILE" — a regular staff member's own record (user 2026-10-01). Who
 * counts is decided once, by role, in `lib/auth/self-service.ts` and carried as
 * `AppUser.myStaffId`; this file only reads it.
 *
 * The row is read with the SERVICE ROLE, by that id only: `staff_read` needs
 * the current unit, and such a login usually holds none (that is why their
 * Staff table read "No staff yet").
 */

/** The signed-in user's own staff id when they are a regular staff member. */
export async function myStaffId(): Promise<string | null> {
  return (await getAppUser())?.myStaffId ?? null;
}

/** True for a regular staff member — the operator write actions refuse them;
 *  they save only through `updateMyProfile` (personal details, own row). */
export async function isOwnProfileOnly(): Promise<boolean> {
  return !!(await myStaffId());
}

/** The signed-in regular staff member's own staff row, or null. */
export async function getOwnStaffRow(): Promise<(Record<string, unknown> & { id: string }) | null> {
  const id = await myStaffId();
  if (!id) return null;
  const { data, error } = await createAdminClient()
    .from("staff")
    .select("*, locations(name), designations(name)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read your staff record: ${error.message}`);
  if (!data) return null;
  // Flattened as `listStaff` does, so the row has the shape a StaffRow has.
  const r = data as Record<string, unknown> & { id: string };
  const loc = r.locations as { name: string } | null;
  const desig = r.designations as { name: string } | null;
  return { ...r, location_name: loc?.name ?? null, designation_name: desig?.name ?? null };
}
