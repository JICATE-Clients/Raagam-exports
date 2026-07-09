import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Designation } from "./designation-types";

export async function listDesignations(): Promise<Designation[]> {
  const s = await createClient();
  const { data } = await s.from("designations").select("*").order("name");
  return (data ?? []) as Designation[];
}
