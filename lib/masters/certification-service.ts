import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Certification } from "./certification-types";

export async function listCertifications(): Promise<Certification[]> {
  const s = await createClient();
  const { data } = await s
    .from("certifications")
    .select("*, validities:certification_validities(id, valid_from, valid_to)")
    .order("certification_name", { nullsFirst: false });
  return (data ?? []) as Certification[];
}
