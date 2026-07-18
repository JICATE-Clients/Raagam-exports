import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CompanyProfile } from "./company-types";

export async function getCompanyProfile(): Promise<CompanyProfile | null> {
  const s = await createClient();
  const { data } = await s
    .from("company_profile")
    .select("*")
    .limit(1)
    .maybeSingle();
  return data as CompanyProfile | null;
}
