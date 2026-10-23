"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";

/**
 * Admin actions on a biometric reader. Nothing here touches a punch: a punch is
 * the record of what the device saw and is never edited (0733).
 *
 * ADMINS ONLY, matching the Live screen's own gate. RLS on
 * `biometric_devices` would refuse an unauthorised write anyway — this is the
 * second lock, so a mis-wired call fails with a message instead of silently
 * updating zero rows, which is how an RLS refusal reads if nobody checks.
 */

type Result = { ok: true } | { ok: false; error: string };

async function requireAdmin(): Promise<Result> {
  return (await can("system_admin", "view"))
    ? { ok: true }
    : { ok: false, error: "Only an administrator can change a device." };
}

function done() {
  revalidatePath("/hr/attendance");
}

/**
 * Approve a reader to record punches, or block it.
 *
 * A blocked device is REFUSED, not silently ignored (see the route): it keeps
 * its punches and offers them again once approved, so blocking by mistake
 * costs nothing.
 */
export async function setDeviceApproval(
  serial: string,
  enabled: boolean,
): Promise<Result> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { error } = await supabase
    .from("biometric_devices")
    .update({ enabled })
    .eq("serial_no", serial);

  if (error) return { ok: false, error: error.message };
  done();
  return { ok: true };
}

/** Name a reader, say which unit it stands in and which way its punches count. */
export async function updateDeviceSetup(
  serial: string,
  patch: {
    name?: string | null;
    location_id?: string | null;
    direction?: "in" | "out" | "both";
  },
): Promise<Result> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  const supabase = await createClient();
  const { error } = await supabase
    .from("biometric_devices")
    .update(patch)
    .eq("serial_no", serial);

  if (error) return { ok: false, error: error.message };
  done();
  return { ok: true };
}

/**
 * ASK A DEVICE FOR ITS STORED HISTORY AGAIN, from `fromDate` onwards.
 *
 * Goes through `refetch_device_history()` (0735) rather than updating the
 * columns here, because widening `accept_from` without resetting the ATTLOG
 * watermark changes NOTHING: the device has already been told we hold
 * everything up to that watermark and will never offer those punches again.
 * The two writes must happen together, so they live together.
 *
 * Duplicates are not a concern — the unique key on
 * (device_sn, user_id, punch_time) drops whatever is already stored, so this
 * is safe to run twice and safe to run with an overlapping date.
 *
 * It takes effect at the device's NEXT HANDSHAKE: the stamp is read when the
 * reader asks for its settings, which is on boot or reconnect, not on the
 * 30-second heartbeat. Restart the device to make it happen now.
 */
export async function refetchDeviceHistory(
  serial: string,
  fromDate: string,
): Promise<Result> {
  const gate = await requireAdmin();
  if (!gate.ok) return gate;

  // A date input gives "YYYY-MM-DD"; read it as the start of that day in IST,
  // which is the zone the device stamps its punches in.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(fromDate)
    ? `${fromDate}T00:00:00+05:30`
    : fromDate;

  if (Number.isNaN(Date.parse(iso)))
    return { ok: false, error: "That date could not be read." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("refetch_device_history", {
    p_serial: serial,
    p_from: iso,
  });

  if (error) return { ok: false, error: error.message };
  done();
  return { ok: true };
}
