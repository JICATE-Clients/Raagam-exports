import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { KnittingProgram } from "./types";

export type KnittingProgramRow = KnittingProgram & {
  sales_orders: { id: string; order_number: string | null } | null;
};

export type OrderOption = { id: string; order_number: string | null };

export async function getKnittingPrograms(): Promise<KnittingProgramRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("knitting_programs")
    .select("*, sales_orders(id, order_number)")
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as KnittingProgramRow[];
}

export async function getOrderOptions(): Promise<OrderOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales_orders")
    .select("id, order_number")
    .order("created_at", { ascending: false });
  return (data ?? []) as OrderOption[];
}
