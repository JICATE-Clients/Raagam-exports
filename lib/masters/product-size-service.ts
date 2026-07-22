import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ProductSize } from "./product-size-types";

export async function listProductSizes(): Promise<ProductSize[]> {
  const s = await createClient();
  const { data } = await s
    .from("product_sizes")
    .select("*")
    .order("prod_size_id", { nullsFirst: false });
  return (data ?? []) as ProductSize[];
}
