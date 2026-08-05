import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Notify } from "./notify-types";
import { withCreators } from "@/lib/created-by";

export async function listNotifies(): Promise<Notify[]> {
  const s = await createClient();
  const { data } = await s
    .from("notifies")
    .select(
      "*, country:countries!notifies_country_id_fkey(id,code,name), " +
        "source_customer:customers!notifies_source_customer_id_fkey(id,name), " +
        "source_consignee:consignees!notifies_source_consignee_id_fkey(id,name), " +
        "contacts:notify_contacts(*)",
    )
    .order("name");
  return withCreators(((data ?? []) as unknown as Notify[]).map((n) => ({
    ...n,
    contacts: [...(n.contacts ?? [])].sort((x, y) => x.sno - y.sno),
  })));
}
