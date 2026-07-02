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
    .order("created_at", { ascending: false });
  return (data ?? []) as GarmentProcessAmendment[];
}
