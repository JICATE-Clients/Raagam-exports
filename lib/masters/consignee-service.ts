import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Consignee } from "./consignee-types";

export async function listConsignees(): Promise<Consignee[]> {
  const s = await createClient();
  const { data } = await s
    .from("consignees")
    .select(
      "*, country:countries!consignees_country_id_fkey(id,code,name), " +
        "contacts:consignee_contacts(*), markings:consignee_markings(*), " +
        "notify_refs:consignee_notifies(*, notify:notifies(id,code,name,country_id))",
    )
    .order("name");
  // `as unknown as` — Supabase's TS parser can't infer the 3-level notify embed.
  return ((data ?? []) as unknown as Consignee[]).map((c) => ({
    ...c,
    contacts: [...(c.contacts ?? [])].sort((x, y) => x.sno - y.sno),
    markings: [...(c.markings ?? [])].sort((x, y) => x.sno - y.sno),
    notify_refs: [...(c.notify_refs ?? [])].sort((x, y) => x.sno - y.sno),
  }));
}
