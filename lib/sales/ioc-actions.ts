"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";

type Result = { ok: true } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } {
  return { ok: false, error: msg };
}
function rev(opportunityId: string): void {
  revalidatePath("/sales");
  revalidatePath(`/sales/${opportunityId}`);
}

// ---------------------------------------------------------------------------
// Save IOC Style Cost line
// ---------------------------------------------------------------------------

export async function saveIocStyleCost(
  costSheetId: string,
  opportunityId: string,
  data: {
    sno: number;
    style_ref_no?: string | null;
    style_no?: string | null;
    article_no?: string | null;
    uom_id?: string | null;
    order_qty?: number | null;
    wt_per_garment?: number | null;
  },
): Promise<Result> {
  if (!(await can("sales", "edit"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("ioc_style_costs").insert({
    cost_sheet_id: costSheetId,
    ...data,
  });
  if (error) return fail(error.message);
  rev(opportunityId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Save IOC Consumption Detail (Fabric/Trims/CMT/GarmentProcess/Rejection)
// ---------------------------------------------------------------------------

export async function saveIocConsDetail(
  styleCostId: string,
  opportunityId: string,
  data: {
    consumption_for: string;
    sno: number;
    category_name?: string | null;
    item_description?: string | null;
    process_name?: string | null;
    coordinate?: string | null;
    uom_id?: string | null;
    gsm?: number | null;
    rate_type?: string | null;
    cons_qty?: number;
    cons_wt?: number;
    rate?: number;
    cost?: number;
    calculated_cost?: number;
    additional_cost?: number;
    is_direct_rate?: boolean;
    is_assort_colorwise?: boolean;
    details?: string | null;
  },
): Promise<Result> {
  if (!(await can("sales", "edit"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("ioc_cons_details").insert({
    style_cost_id: styleCostId,
    ...data,
  });
  if (error) return fail(error.message);
  rev(opportunityId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Save IOC Fabric Rate
// ---------------------------------------------------------------------------

export async function saveIocFabricRate(
  costSheetId: string,
  opportunityId: string,
  data: {
    sno: number;
    fabric_description?: string | null;
    structure_name?: string | null;
    composition_name?: string | null;
    struct_type?: string | null;
    fabric_type?: string | null;
    gsm?: number | null;
    is_direct_rate?: boolean;
    fabric_rate_without_loss?: number;
    process_loss_pct?: number;
    fabric_rate?: number;
  },
): Promise<Result> {
  if (!(await can("sales", "edit"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("ioc_fabric_rates").insert({
    cost_sheet_id: costSheetId,
    ...data,
  });
  if (error) return fail(error.message);
  rev(opportunityId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Save IOC Other Expense
// ---------------------------------------------------------------------------

export async function saveIocOtherExpense(
  costSheetId: string,
  opportunityId: string,
  data: {
    sno: number;
    cost_short_name?: string | null;
    cost_description?: string | null;
    item_description?: string | null;
    type_for?: string | null;
    rate_type?: string | null;
    cons_qty?: number;
    uom_id?: string | null;
    rate?: number;
    cost?: number;
  },
): Promise<Result> {
  if (!(await can("sales", "edit"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("ioc_other_expenses").insert({
    cost_sheet_id: costSheetId,
    ...data,
  });
  if (error) return fail(error.message);
  rev(opportunityId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Update IOC cost sheet header totals
// ---------------------------------------------------------------------------

export async function updateIocTotals(
  costSheetId: string,
  opportunityId: string,
  totals: {
    fabric_cost?: number;
    trims_cost?: number;
    cmt_cost?: number;
    garment_process_cost?: number;
    other_expenses_cost?: number;
    gross_cost?: number;
    fob_inr?: number;
    rate?: number;
    rate_inr?: number;
    fob_rate?: number;
    fob_rate_inr?: number;
    profit_loss?: number;
    profit_loss_pct?: number;
  },
): Promise<Result> {
  if (!(await can("sales", "edit"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s
    .from("cost_sheets")
    .update({ ...totals, costing_type: "ioc" })
    .eq("id", costSheetId);
  if (error) return fail(error.message);
  rev(opportunityId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Delete IOC child row (generic — works for any IOC table)
// ---------------------------------------------------------------------------

export async function deleteIocRow(
  table: string,
  id: string,
  opportunityId: string,
): Promise<Result> {
  if (!(await can("sales", "delete"))) return fail("Forbidden");
  const allowed = [
    "ioc_style_costs", "ioc_cons_details", "ioc_cmt_operations", "ioc_cmt_sizes",
    "ioc_cons_colors", "ioc_fabric_rates", "ioc_fabric_process_rates",
    "ioc_fabric_process_details", "ioc_fabric_rate_colors",
    "ioc_other_expenses", "ioc_expense_styles", "ioc_budgets",
  ];
  if (!allowed.includes(table)) return fail("Invalid table");
  const s = await createClient();
  const { error } = await s.from(table).delete().eq("id", id);
  if (error) return fail(error.message);
  rev(opportunityId);
  return { ok: true };
}
