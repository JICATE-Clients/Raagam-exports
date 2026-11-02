import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentLocationId } from "@/lib/auth/location";
import { today } from "@/lib/calendar";

/** `?asOf=YYYY-MM-DD`, else the factory's today. A malformed or future date falls back too. */
export function readAsOf(params: Record<string, string | string[] | undefined>): string {
  const raw = Array.isArray(params.asOf) ? params.asOf[0] : params.asOf;
  const now = today();
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || raw > now) return now;
  return raw;
}

/** The unit the report answers for — the RPCs take it from current_location() themselves. */
export async function currentUnitName(): Promise<string> {
  const id = await getCurrentLocationId();
  if (!id) return "No unit selected";
  const s = await createClient();
  const { data } = await s.from("locations").select("name").eq("id", id).maybeSingle();
  return (data as { name: string } | null)?.name ?? "Current unit";
}
