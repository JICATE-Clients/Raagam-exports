"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import {
  buyerInput,
  itemInput,
  uomInput,
  type BuyerInput,
  type ItemInput,
  type UomInput,
} from "@/lib/masters/types";

type Result = { ok: true } | { ok: false; error: string };

/* ---- Buyers ---- */

export async function createBuyer(data: BuyerInput): Promise<Result> {
  if (!(await can("masters", "create"))) return { ok: false, error: "Forbidden" };
  const parsed = buyerInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("buyers").insert(parsed.data);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/masters");
  return { ok: true };
}

export async function updateBuyer(id: string, data: BuyerInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return { ok: false, error: "Forbidden" };
  const parsed = buyerInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("buyers").update(parsed.data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/masters");
  return { ok: true };
}

/* ---- Items ---- */

export async function createItem(data: ItemInput): Promise<Result> {
  if (!(await can("masters", "create"))) return { ok: false, error: "Forbidden" };
  const parsed = itemInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("items").insert(parsed.data);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/masters");
  return { ok: true };
}

export async function updateItem(id: string, data: ItemInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return { ok: false, error: "Forbidden" };
  const parsed = itemInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("items").update(parsed.data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/masters");
  return { ok: true };
}

/* ---- UOMs ---- */

export async function createUom(data: UomInput): Promise<Result> {
  if (!(await can("masters", "create"))) return { ok: false, error: "Forbidden" };
  const parsed = uomInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("uoms").insert(parsed.data);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/masters");
  return { ok: true };
}

export async function updateUom(id: string, data: UomInput): Promise<Result> {
  if (!(await can("masters", "edit"))) return { ok: false, error: "Forbidden" };
  const parsed = uomInput.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation failed" };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("uoms").update(parsed.data).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/masters");
  return { ok: true };
}
