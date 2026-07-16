import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Levy } from "./levy-types";

export async function listLevies(): Promise<Levy[]> {
  const s = await createClient();
  const { data } = await s
    .from("levies")
    .select("*, creator:profiles!created_by(full_name)")
    .order("entry_no");
  return (data ?? []).map((r) => {
    const { creator, ...rest } = r as typeof r & { creator: { full_name: string | null } | null };
    return { ...rest, created_by_name: creator?.full_name ?? null } as Levy;
  });
}
