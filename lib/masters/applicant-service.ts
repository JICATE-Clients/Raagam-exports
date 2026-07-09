import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Applicant } from "./applicant-types";

export async function listApplicants(): Promise<Applicant[]> {
  const s = await createClient();
  const { data } = await s
    .from("applicants")
    .select("*, country:countries!applicants_country_id_fkey(id,code,name), contacts:applicant_contacts(*)")
    .order("name");
  return ((data ?? []) as Applicant[]).map((a) => ({
    ...a,
    contacts: [...(a.contacts ?? [])].sort((x, y) => x.sno - y.sno),
  }));
}
