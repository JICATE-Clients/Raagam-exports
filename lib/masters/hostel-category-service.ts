import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { HostelCategory } from "./hostel-category-types";

export async function listHostelCategories(): Promise<HostelCategory[]> {
  const s = await createClient();
  const { data } = await s.from("hostel_categories").select("*").order("name");
  return (data ?? []) as HostelCategory[];
}
