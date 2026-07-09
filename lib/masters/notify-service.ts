import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Notify } from "./notify-types";

export async function listNotifies(): Promise<Notify[]> {
  const s = await createClient();
  const { data } = await s
    .from("notifies")
    .select("*, country:countries!notifies_country_id_fkey(id,code,name), contacts:notify_contacts(*)")
    .order("name");
  return ((data ?? []) as Notify[]).map((n) => ({
    ...n,
    contacts: [...(n.contacts ?? [])].sort((x, y) => x.sno - y.sno),
  }));
}
