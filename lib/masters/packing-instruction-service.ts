import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { PackingInstruction } from "./packing-instruction-types";

export async function listPackingInstructions(): Promise<PackingInstruction[]> {
  const s = await createClient();
  const { data } = await s
    .from("packing_instructions")
    .select("*")
    .order("packing_type", { nullsFirst: false });
  return (data ?? []) as PackingInstruction[];
}
