import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Category } from "./category-types";

export async function listCategories(): Promise<Category[]> {
  const s = await createClient();
  const { data } = await s
    .from("categories")
    .select("*")
    .order("name", { nullsFirst: false });
  return (data ?? []) as Category[];
}
