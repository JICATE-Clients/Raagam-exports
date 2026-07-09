import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Customer } from "./customer-types";

export async function listCustomers(): Promise<Customer[]> {
  const s = await createClient();
  const { data } = await s
    .from("customers")
    .select(
      "*, country:countries!customers_country_id_fkey(id,code,name), " +
        "contacts:customer_contacts(*), " +
        "applicants:customer_applicants(*, applicant:applicants(id,code,name))",
    )
    .order("name");
  return ((data ?? []) as unknown as Customer[]).map((c) => ({
    ...c,
    contacts: [...(c.contacts ?? [])].sort((x, y) => x.sno - y.sno),
    applicants: [...(c.applicants ?? [])].sort((x, y) => x.sno - y.sno),
  }));
}
