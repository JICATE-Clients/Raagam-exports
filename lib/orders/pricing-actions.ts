"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { orderPriceInput, priceConfirmationInput, pcPurchaseItemInput, pcProcessInput } from "./pricing-types";
import type { OrderPriceInput, PriceConfirmationInput, PcPurchaseItemInput, PcProcessInput } from "./pricing-types";

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; id: string } | { ok: false; error: string };

function fail(msg: string): { ok: false; error: string } { return { ok: false, error: msg }; }
function rev(): void { revalidatePath("/orders"); revalidatePath("/orders/price-confirmation"); }

// Order Prices
export async function addOrderPrice(data: OrderPriceInput): Promise<CreateResult> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = orderPriceInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: row, error } = await s.from("order_prices").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function deleteOrderPrice(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("order_prices").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// Price Confirmation
export async function createPriceConfirmation(data: PriceConfirmationInput): Promise<CreateResult> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = priceConfirmationInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const { data: row, error } = await s.from("price_confirmations").insert(p.data).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function confirmPriceConf(id: string): Promise<Result> {
  if (!(await can("orders", "edit"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("price_confirmations").update({ status: "confirmed" }).eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

export async function amendPriceConf(id: string): Promise<CreateResult> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const s = await createClient();
  // Get current PC
  const { data: current } = await s.from("price_confirmations").select("sales_order_id, amendment_sno").eq("id", id).single();
  if (!current) return fail("Price confirmation not found");
  const newSno = (current.amendment_sno ?? 0) + 1;
  // Mark old as amended
  await s.from("price_confirmations").update({ status: "amended", last_amendment_sno: newSno }).eq("id", id);
  // Create new amendment
  const { data: row, error } = await s.from("price_confirmations").insert({
    sales_order_id: current.sales_order_id,
    amendment_sno: newSno,
  }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

export async function deletePriceConf(id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const s = await createClient();
  const { error } = await s.from("price_confirmations").delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}

// Purchase Items
export async function addPcPurchaseItem(data: PcPurchaseItemInput): Promise<CreateResult> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = pcPurchaseItemInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const inr_rate = (p.data.rate ?? 0) * (p.data.exchange_rate ?? 1);
  const { data: row, error } = await s.from("pc_purchase_items").insert({
    ...p.data,
    inr_rate: Math.round(inr_rate * 10000) / 10000,
    net_rate: p.data.rate,
    net_inr_rate: Math.round(inr_rate * 10000) / 10000,
  }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

// Processes
export async function addPcProcess(data: PcProcessInput): Promise<CreateResult> {
  if (!(await can("orders", "create"))) return fail("Forbidden");
  const p = pcProcessInput.safeParse(data);
  if (!p.success) return fail(p.error.issues[0]?.message ?? "Validation failed");
  const s = await createClient();
  const inr_rate = (p.data.rate ?? 0) * (p.data.exchange_rate ?? 1);
  const { data: row, error } = await s.from("pc_processes").insert({
    ...p.data,
    inr_rate: Math.round(inr_rate * 10000) / 10000,
  }).select("id").single();
  if (error) return fail(error.message);
  rev();
  return { ok: true, id: row.id };
}

// Generic delete for PC child tables
export async function deletePcRow(table: string, id: string): Promise<Result> {
  if (!(await can("orders", "delete"))) return fail("Forbidden");
  const allowed = ["pc_purchase_items", "pc_processes", "pc_process_items", "pc_cmt_operations", "pc_cmt_operation_details", "order_prices", "order_price_combo_rates", "order_price_size_rates"];
  if (!allowed.includes(table)) return fail("Invalid table");
  const s = await createClient();
  const { error } = await s.from(table).delete().eq("id", id);
  if (error) return fail(error.message);
  rev();
  return { ok: true };
}
