import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ProductionSection } from "./production-section-types";

export async function listProductionSections(): Promise<ProductionSection[]> {
  const s = await createClient();
  const { data } = await s
    .from("production_sections")
    .select("*")
    .order("code", { nullsFirst: false });
  return (data ?? []) as ProductionSection[];
}
