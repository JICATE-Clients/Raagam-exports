import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { HsnDetail } from "./hsn-detail-types";

export async function listHsnDetails(): Promise<HsnDetail[]> {
  const s = await createClient();
  const { data } = await s.from("hsn_details").select("*").order("hsn_code");
  return (data ?? []) as HsnDetail[];
}
