import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CostHead, CostItem } from "./types";

export type CostItemRow = CostItem & {
  cost_heads: { id: string; name: string } | null;
};

export async function getCostHeads(): Promise<CostHead[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("cost_heads").select("*").order("name");
  return (data ?? []) as CostHead[];
}

export async function getActiveHeads(): Promise<Pick<CostHead, "id" | "name">[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("cost_heads")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as Pick<CostHead, "id" | "name">[];
}

export async function getCostItems(): Promise<CostItemRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("cost_items")
    .select("*, cost_heads(id, name)")
    .order("name");
  return (data ?? []) as unknown as CostItemRow[];
}
