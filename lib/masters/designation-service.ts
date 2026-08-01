import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import type { Designation } from "./designation-types";

export async function listDesignations(): Promise<Designation[]> {
  const s = await createClient();
  const { data } = await s.from("designations").select("*").order("name");
  return withCreators((data ?? []) as Designation[]);
}
