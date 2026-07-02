import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BudgetAmendment, BomAmendment, BomKind } from "./types";

// ---------- Budget amendments ----------

export interface BudgetAmendmentWithRefs extends BudgetAmendment {
  budget_code: string | null;
  budget_name: string | null;
}

export type ApprovedBudgetOption = {
  id: string;
  code: string | null;
  name: string;
  total_amount: number;
};

export async function listBudgetAmendments(): Promise<BudgetAmendmentWithRefs[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("budget_amendments")
    .select("*, budgets(code, name)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const b = row.budgets as Record<string, unknown> | null;
    return {
      ...(row as unknown as BudgetAmendment),
      budget_code: (b?.code as string | null) ?? null,
      budget_name: (b?.name as string | null) ?? null,
    };
  });
}

/** Budgets eligible to amend — only those already approved. */
export async function getApprovedBudgets(): Promise<ApprovedBudgetOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("budgets")
    .select("id, code, name, total_amount")
    .eq("status", "approved")
    .order("created_at", { ascending: false });
  return (data ?? []) as ApprovedBudgetOption[];
}

// ---------- BOM amendments ----------

export interface BomAmendmentWithRefs extends BomAmendment {
  order_number: string | null;
}

/** A pickable BOM (fabric or material) with its order number for the raise form. */
export type BomPickerOption = {
  bom_id: string;
  bom_kind: BomKind;
  sales_order_id: string | null;
  order_number: string | null;
};

export async function listBomAmendments(): Promise<BomAmendmentWithRefs[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bom_amendments")
    .select("*, sales_orders(order_number)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const so = row.sales_orders as Record<string, unknown> | null;
    return {
      ...(row as unknown as BomAmendment),
      order_number: (so?.order_number as string | null) ?? null,
    };
  });
}

export async function getBomPickerOptions(): Promise<BomPickerOption[]> {
  const supabase = await createClient();
  const [{ data: fabric }, { data: material }] = await Promise.all([
    supabase.from("fabric_boms").select("id, sales_order_id, sales_orders(order_number)"),
    supabase.from("material_boms").select("id, sales_order_id, sales_orders(order_number)"),
  ]);

  const map = (rows: Record<string, unknown>[] | null, kind: BomKind): BomPickerOption[] =>
    (rows ?? []).map((row) => {
      const so = row.sales_orders as Record<string, unknown> | null;
      return {
        bom_id: row.id as string,
        bom_kind: kind,
        sales_order_id: (row.sales_order_id as string | null) ?? null,
        order_number: (so?.order_number as string | null) ?? null,
      };
    });

  return [
    ...map((fabric ?? []) as Record<string, unknown>[], "fabric"),
    ...map((material ?? []) as Record<string, unknown>[], "material"),
  ];
}
