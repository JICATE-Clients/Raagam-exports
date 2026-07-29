import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  Budget,
  BudgetPurchase,
  BudgetProcess,
  BudgetProcessItem,
  BudgetCmt,
  BudgetCmtOperation,
  BudgetOtherEntry,
  BudgetHead,
  BudgetStyle,
} from "./budget-types";

// ============================================================================
// List budgets
// ============================================================================

export type BudgetRow = Budget & {
  customer_name: string | null;
  order_code: string | null;
};

export async function listBudgets(): Promise<BudgetRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("budgets")
    .select("*, customers(name), sales_orders(code)")
    .order("created_at", { ascending: false });

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const customer = row.customers as { name: string } | null;
    const order = row.sales_orders as { code: string } | null;
    const { customers: _c, sales_orders: _o, ...rest } = row;
    void _c;
    void _o;
    return {
      ...(rest as unknown as Budget),
      customer_name: customer?.name ?? null,
      order_code: order?.code ?? null,
    };
  });
}

// ============================================================================
// Get single budget with all children
// ============================================================================

export type BudgetDetail = BudgetRow & {
  purchases_yarn: BudgetPurchase[];
  purchases_fabric: BudgetPurchase[];
  purchases_accessories: BudgetPurchase[];
  processes_yarn: (BudgetProcess & { items: BudgetProcessItem[] })[];
  processes_fabric: (BudgetProcess & { items: BudgetProcessItem[] })[];
  processes_accessories: (BudgetProcess & { items: BudgetProcessItem[] })[];
  processes_garment: (BudgetProcess & { items: BudgetProcessItem[] })[];
  cmts: (BudgetCmt & { operations: BudgetCmtOperation[] })[];
  other_expenses: BudgetOtherEntry[];
  other_incomes: BudgetOtherEntry[];
  heads: BudgetHead[];
  styles: BudgetStyle[];
};

export async function getBudget(id: string): Promise<BudgetDetail | null> {
  const supabase = await createClient();

  const { data: budget } = await supabase
    .from("budgets")
    .select("*, customers(name), sales_orders(code)")
    .eq("id", id)
    .maybeSingle();
  if (!budget) return null;

  const budgetRow = budget as Record<string, unknown>;
  const customer = budgetRow.customers as { name: string } | null;
  const order = budgetRow.sales_orders as { code: string } | null;
  const { customers: _c, sales_orders: _o, ...budgetRest } = budgetRow;
  void _c;
  void _o;

  const [
    { data: purchases },
    { data: processes },
    { data: cmts },
    { data: otherEntries },
    { data: heads },
    { data: styles },
  ] = await Promise.all([
    supabase
      .from("budget_purchases")
      .select("*")
      .eq("budget_id", id)
      .order("sort_order"),
    supabase
      .from("budget_processes")
      .select("*, budget_process_items(*)")
      .eq("budget_id", id)
      .order("sort_order"),
    supabase
      .from("budget_cmts")
      .select("*, budget_cmt_operations(*)")
      .eq("budget_id", id)
      .order("sort_order"),
    supabase
      .from("budget_other_entries")
      .select("*")
      .eq("budget_id", id)
      .order("sort_order"),
    supabase
      .from("budget_heads")
      .select("*")
      .eq("budget_id", id)
      .order("sort_order"),
    supabase
      .from("budget_styles")
      .select("*")
      .eq("budget_id", id)
      .order("sort_order"),
  ]);

  const allPurchases = (purchases ?? []) as BudgetPurchase[];
  const allOtherEntries = (otherEntries ?? []) as BudgetOtherEntry[];

  // Map processes with their child items
  const allProcesses = ((processes ?? []) as Record<string, unknown>[]).map((p) => {
    const items = (p.budget_process_items ?? []) as BudgetProcessItem[];
    const { budget_process_items: _pi, ...procRest } = p;
    void _pi;
    return {
      ...(procRest as unknown as BudgetProcess),
      items: items.sort((a, b) => a.sort_order - b.sort_order),
    };
  });

  // Map CMTs with their child operations
  const allCmts = ((cmts ?? []) as Record<string, unknown>[]).map((c) => {
    const operations = (c.budget_cmt_operations ?? []) as BudgetCmtOperation[];
    const { budget_cmt_operations: _co, ...cmtRest } = c;
    void _co;
    return {
      ...(cmtRest as unknown as BudgetCmt),
      operations: operations.sort((a, b) => a.sort_order - b.sort_order),
    };
  });

  return {
    ...(budgetRest as unknown as Budget),
    customer_name: customer?.name ?? null,
    order_code: order?.code ?? null,
    purchases_yarn: allPurchases.filter((p) => p.purchase_type === "yarn"),
    purchases_fabric: allPurchases.filter((p) => p.purchase_type === "fabric"),
    purchases_accessories: allPurchases.filter((p) => p.purchase_type === "accessories"),
    processes_yarn: allProcesses.filter((p) => p.process_type === "yarn"),
    processes_fabric: allProcesses.filter((p) => p.process_type === "fabric"),
    processes_accessories: allProcesses.filter((p) => p.process_type === "accessories"),
    processes_garment: allProcesses.filter((p) => p.process_type === "garment"),
    cmts: allCmts,
    other_expenses: allOtherEntries.filter((e) => e.entry_type === "expense"),
    other_incomes: allOtherEntries.filter((e) => e.entry_type === "income"),
    heads: (heads ?? []) as BudgetHead[],
    styles: (styles ?? []) as BudgetStyle[],
  };
}
