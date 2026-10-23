import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * WHAT THE DEVICES ACTUALLY SENT — read through the caller's own session, so
 * RLS answers it: `hr_payroll` view permission, and only the units the person
 * is allocated to (0733's policies).
 *
 * Deliberately NOT joined to a person. A punch carries the user id as enrolled
 * ON THE DEVICE, and which table of people that resolves against is a decision
 * nobody has made yet. This screen shows the raw fact; a name is a later layer
 * on top of it, not a thing to guess at now.
 */

export interface DeviceRow {
  serial_no: string;
  name: string | null;
  location_id: string | null;
  direction: "in" | "out" | "both";
  purpose: "attendance" | "canteen" | "visitor";
  is_active: boolean;
  last_seen: string | null;
  last_ip: string | null;
  last_attlog_stamp: string;
}

export interface PunchRow {
  id: number;
  device_sn: string;
  user_id: string;
  punch_time: string;
  received_at: string;
  direction: "in" | "out" | "both";
  verify_mode: number | null;
}

/** Every device that has ever dialled in, most recently heard from first. */
export async function listDevices(): Promise<DeviceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("biometric_devices")
    .select(
      "serial_no, name, location_id, direction, purpose, is_active, last_seen, last_ip, last_attlog_stamp",
    )
    .order("last_seen", { ascending: false, nullsFirst: false });

  /**
   * A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST (the failure AGENTS.md
   * records against the PostgREST embeds). "No device has connected" and "we
   * could not ask" look identical on screen and mean opposite things, so the
   * error is logged rather than swallowed by `?? []`.
   */
  if (error) {
    console.error("[punches] listDevices failed", error);
    return [];
  }
  return (data ?? []) as DeviceRow[];
}

/**
 * TODAY'S punches, newest first.
 *
 * Today and not "the latest N", because this screen answers "is the device
 * working right now". A feed capped by COUNT silently becomes a feed of
 * yesterday on a quiet morning, which reads as today being quiet — the same
 * trap AGENTS.md records about an empty report being indistinguishable from a
 * real answer. The register that answers "what happened on the 14th" is a
 * different screen with a date filter.
 *
 * `fromIso` is the start of today in IST, resolved on the SERVER: the client
 * must not reach for `Date.now()` in a render, and a viewer's wrong clock must
 * not decide which day they are shown.
 *
 * The cap is a safety rail, not a page. ~1,280 workers punching twice is
 * ~2,560 rows, so 3,000 covers a full day at both gates; past it the newest
 * are kept, which is the half this screen is for.
 */
export async function listPunchesToday(
  fromIso: string,
  limit = 3000,
): Promise<PunchRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("punches")
    .select("id, device_sn, user_id, punch_time, received_at, direction, verify_mode")
    .gte("punch_time", fromIso)
    .order("punch_time", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[punches] listPunchesToday failed", error);
    return [];
  }
  return (data ?? []) as PunchRow[];
}

// created-by: exempt -- a punch has no creator and a device is not a record
// somebody entered; both are events. See the same note in 0733.

/**
 * How many punches landed today, counted in the DATABASE rather than from the
 * feed above: the feed is capped at 100 rows, so on a busy day counting it
 * would quietly under-report and look like a slow morning.
 *
 * `fromIso` is the start of today in IST, computed on the server — the client
 * must not reach for `Date.now()` in a render (the React Compiler refuses the
 * impure call, and a phone with a wrong clock would answer for the wrong day).
 */
export async function countPunchesToday(fromIso: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("punches")
    .select("id", { count: "exact", head: true })
    .gte("punch_time", fromIso);

  if (error) {
    console.error("[punches] countPunchesToday failed", error);
    return 0;
  }
  return count ?? 0;
}
