"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { colorPrintDetailInput, materialRateEntryInput, generalStockGroupInput } from "./config-types";
import type { ColorPrintDetailInput, MaterialRateEntryInput, GeneralStockGroupInput } from "./config-types";

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } { return { ok: false, error: msg }; }
function rev(): void { revalidatePath("/planning"); revalidatePath("/planning/color-print-details"); revalidatePath("/planning/material-rates"); revalidatePath("/planning/general-stocks"); }

// ---------------------------------------------------------------------------
// Color/Print Details
// ---------------------------------------------------------------------------

export async function createColorPrintDetail(data: ColorPrintDetailInput): Promise<CreateResult> {
  if (!(await can("planning", "create"))) return fail("Forbidden");
  const p = colorPrintDetailInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { lines, ...header } = p.data;
  const { data: row, error } = await s.from("color_print_details").insert(header).select("id").single();
  if (error) return fail(error.message);
  if (lines.length > 0) {
    const { error: childErr } = await s.from("color_print_detail_lines").insert(
      lines.map((l, i) => ({ color_print_id: row.id, sno: i + 1, ...l })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true, id: row.id };
}

export async function addColorPrintLine(colorPrintId: string, data: { color_type?: string | null; description: string; process_loss_pct?: number; blocked?: boolean }): Promise<CreateResult> {
  if (!(await can("planning", "create"))) return fail("Forbidden");
  const s = await createClient();
  const { data: existing } = await s.from("color_print_detail_lines").select("sno").eq("color_print_id", colorPrintId).order("sno", { ascending: false }).limit(1);
  const sno = ((existing?.[0] as { sno: number } | undefined)?.sno ?? 0) + 1;
  const { data: row, error } = await s.from("color_print_detail_lines").insert({ color_print_id: colorPrintId, sno, ...data }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function deleteColorPrintDetail(id: string): Promise<Result> {
  if (!(await can("planning", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("color_print_details").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Material Rates
// ---------------------------------------------------------------------------

export async function createMaterialRateEntry(data: MaterialRateEntryInput): Promise<CreateResult> {
  if (!(await can("planning", "create"))) return fail("Forbidden");
  const p = materialRateEntryInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { items, ...header } = p.data;
  const { data: row, error } = await s.from("material_rate_entries").insert(header).select("id").single();
  if (error) return fail(error.message);
  if (items.length > 0) {
    const { error: childErr } = await s.from("material_rate_items").insert(
      items.map((item, i) => ({ rate_entry_id: row.id, sno: i + 1, ...item })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true, id: row.id };
}

export async function addMaterialRateItem(rateEntryId: string, data: { item_class_name?: string | null; description?: string | null; process_name?: string | null; rate_uom_id?: string | null; rate?: number }): Promise<CreateResult> {
  if (!(await can("planning", "create"))) return fail("Forbidden");
  const s = await createClient();
  const { data: existing } = await s.from("material_rate_items").select("sno").eq("rate_entry_id", rateEntryId).order("sno", { ascending: false }).limit(1);
  const sno = ((existing?.[0] as { sno: number } | undefined)?.sno ?? 0) + 1;
  const { data: row, error } = await s.from("material_rate_items").insert({ rate_entry_id: rateEntryId, sno, ...data }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function deleteMaterialRateEntry(id: string): Promise<Result> {
  if (!(await can("planning", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("material_rate_entries").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// General Stocks
// ---------------------------------------------------------------------------

export async function createGeneralStockGroup(data: GeneralStockGroupInput): Promise<CreateResult> {
  if (!(await can("planning", "create"))) return fail("Forbidden");
  const p = generalStockGroupInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { item_classes, ...header } = p.data;
  const { data: row, error } = await s.from("general_stock_groups").insert(header).select("id").single();
  if (error) return fail(error.message);
  if (item_classes.length > 0) {
    const { error: childErr } = await s.from("general_stock_item_classes").insert(
      item_classes.map((ic) => ({ stock_group_id: row.id, ...ic })),
    );
    if (childErr) return fail(childErr.message);
  }
  rev();
  return { ok: true, id: row.id };
}

export async function deleteGeneralStockGroup(id: string): Promise<Result> {
  if (!(await can("planning", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("general_stock_groups").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
