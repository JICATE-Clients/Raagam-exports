import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Category } from "./category-types";

export async function listCategories(): Promise<Category[]> {
  const s = await createClient();
  const { data } = await s
    .from("categories")
    .select("*, creator:profiles!created_by(full_name)")
    .order("name", { nullsFirst: false });
  return (data ?? []).map((r) => {
    const { creator, ...rest } = r as typeof r & { creator: { full_name: string | null } | null };
    return { ...rest, created_by_name: creator?.full_name ?? null } as Category;
  });
}
