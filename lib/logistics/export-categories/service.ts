import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ExportCategory, OrderCategoryAssignment } from "./types";

export type AssignmentRow = OrderCategoryAssignment & {
  sales_orders: {
    id: string;
    order_number: string | null;
    buyers: { name: string } | null;
  } | null;
  export_categories: { id: string; name: string } | null;
};

export type OrderOption = {
  id: string;
  order_number: string | null;
  buyers: { name: string } | null;
};

export async function getExportCategories(): Promise<ExportCategory[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("export_categories")
    .select("*")
    .order("name");
  return (data ?? []) as ExportCategory[];
}

export async function getActiveCategories(): Promise<
  Pick<ExportCategory, "id" | "name">[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("export_categories")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as Pick<ExportCategory, "id" | "name">[];
}

export async function getOrderCategoryAssignments(): Promise<AssignmentRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("order_category_assignments")
    .select(
      "*, sales_orders(id, order_number, buyers(name)), export_categories(id, name)",
    )
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as AssignmentRow[];
}

export async function getOrderOptions(): Promise<OrderOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales_orders")
    .select("id, order_number, buyers(name)")
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as OrderOption[];
}
