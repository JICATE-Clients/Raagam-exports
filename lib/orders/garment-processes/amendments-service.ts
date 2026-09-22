import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { GarmentProcessAmendment } from "./amendments-types";

export async function getProcessAmendments(
  orderId: string,
): Promise<GarmentProcessAmendment[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("garment_process_amendments")
    .select("*")
    .eq("sales_order_id", orderId)
    // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22: "in every module the listing … I need like 1,2,3 order wise"). Newest-first was the default before; queues, pickers, logs and "latest" lookups keep their own order.
    .order("created_at", { ascending: true });
  return (data ?? []) as GarmentProcessAmendment[];
}
