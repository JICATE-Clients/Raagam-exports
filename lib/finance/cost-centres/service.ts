import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CostCentreGroup, CostCentre } from "./types";

export type CostCentreRow = CostCentre & {
  cost_centre_groups: { id: string; name: string } | null;
};

export async function getCostCentreGroups(): Promise<CostCentreGroup[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("cost_centre_groups")
    .select("*")
    .order("name");
  return (data ?? []) as CostCentreGroup[];
}

export async function getActiveGroups(): Promise<
  Pick<CostCentreGroup, "id" | "name">[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("cost_centre_groups")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as Pick<CostCentreGroup, "id" | "name">[];
}

export async function getCostCentres(): Promise<CostCentreRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("cost_centres")
    .select("*, cost_centre_groups(id, name)")
    .order("name");
  return (data ?? []) as unknown as CostCentreRow[];
}
