"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { stockUnitInput, type StockUnitInput } from "./stock-unit-types";

type Result = { ok: true } | { ok: false; error: string };

function rev(): void {
  revalidatePath("/masters/materials");
  revalidatePath("/masters/materials/stock-units");
}
function fail(msg: string): Result {
  return { ok: false, error: msg };
}

/** "For all item classes" wins — the specific list is cleared when it's on. */
function toRow(d: StockUnitInput) {
  return {
    code: d.code.trim(),
    name: d.name.trim(),
    description: d.description?.trim() || null,
    decimal_places: d.decimal_places,
    for_all_item_classes: d.for_all_item_classes,
    item_classes: d.for_all_item_classes ? [] : d.item_classes,
    is_active: d.is_active,
  };
}

export async function createStockUnit(data: StockUnitInput): Promise<Result> {
  if (!(await can("masters", "create"))) return fail("Forbidden");
  const p = stockUnitInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("uoms").insert(toRow(p.data));
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function updateStockUnit(id: string, data: StockUnitInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return fail("Forbidden");
  const p = stockUnitInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { error } = await s.from("uoms").update(toRow(p.data)).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function deleteStockUnit(id: string): Promise<Result> {
  if (!(await can("masters", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("uoms").delete().eq("id", id);
  if (error) return fail(error.message); // FK-referenced units surface a clear error
  rev();
  return { ok: true };
}
