import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CourierDeliveryAddress } from "./courier-delivery-types";

export async function listCourierDeliveryAddresses(): Promise<CourierDeliveryAddress[]> {
  const s = await createClient();
  const { data } = await s
    .from("courier_delivery_addresses")
    .select(
      "*, country:countries!courier_delivery_addresses_country_id_fkey(id,code,name), contacts:courier_delivery_contacts(*)",
    )
    .order("name");
  return ((data ?? []) as CourierDeliveryAddress[]).map((r) => ({
    ...r,
    contacts: [...(r.contacts ?? [])].sort((x, y) => x.sno - y.sno),
  }));
}
