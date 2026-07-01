"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can, getAppUser } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  stockMovementInput,
  stockTransferInput,
  storeInput,
  storeAccessInput,
  type StockMovementInput,
  type StockTransferInput,
  type StoreInput,
  type StoreAccessInput,
} from "./types";

type OkResult = { ok: true };
type ErrResult = { ok: false; error: string };
type ActionResult = OkResult | ErrResult;

function revalidateStore(storeId: string): void {
  revalidatePath(`/stores/${storeId}`);
  revalidatePath("/stores");
}

/** Friendly message for DB-level stock trigger errors. */
function friendlyStockError(msg: string): string {
  if (msg.includes("Insufficient stock")) return "Insufficient stock for this operation";
  return msg;
}

/** Pre-check balance to surface a nicer message; DB trigger is the authoritative guard. */
async function checkBalance(
  storeId: string,
  itemId: string,
  required: number,
): Promise<ErrResult | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("stock_balances")
    .select("quantity")
    .eq("store_id", storeId)
    .eq("item_id", itemId)
    .maybeSingle();

  const current = (data as { quantity: number } | null)?.quantity ?? 0;
  if (current < required) {
    return {
      ok: false,
      error: `Insufficient stock — available: ${current.toLocaleString("en-IN")}, requested: ${required.toLocaleString("en-IN")}`,
    };
  }
  return null;
}

// ---------- movements ----------

export async function recordMovement(
  payload: StockMovementInput,
): Promise<ActionResult> {
  if (!(await can("stores", "create"))) throw new Error("Forbidden");

  const parsed = stockMovementInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { store_id, item_id, movement_type, quantity } = parsed.data;

  // Pre-check balance for outbound movements
  if (movement_type === "issue" || movement_type === "adjust_out") {
    const checkErr = await checkBalance(store_id, item_id, quantity);
    if (checkErr) return checkErr;
  }

  const user = await getAppUser();
  const supabase = await createClient();

  const { error } = await supabase.from("stock_ledger").insert({
    store_id,
    item_id,
    movement_type,
    quantity,
    reference_type: parsed.data.reference_type ?? null,
    reference_id: parsed.data.reference_id ?? null,
    note: parsed.data.note ?? null,
    created_by: user?.id ?? null,
  });

  if (error) {
    return { ok: false, error: friendlyStockError(error.message) };
  }

  await writeAudit({
    action: `stores.${movement_type}`,
    entityType: "store",
    entityId: store_id,
    metadata: { store_id, item_id, quantity, movement_type },
  });

  revalidateStore(store_id);
  return { ok: true };
}

export async function transferStock(
  payload: StockTransferInput,
): Promise<ActionResult> {
  if (!(await can("stores", "create"))) throw new Error("Forbidden");

  const parsed = stockTransferInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { from_store_id, to_store_id, item_id, quantity, note } = parsed.data;

  if (from_store_id === to_store_id) {
    return { ok: false, error: "Source and destination stores must be different" };
  }

  // Pre-check balance on source store
  const checkErr = await checkBalance(from_store_id, item_id, quantity);
  if (checkErr) return checkErr;

  const user = await getAppUser();
  const supabase = await createClient();

  // 1. Debit source — trigger hard-blocks if still insufficient
  const { error: outErr } = await supabase.from("stock_ledger").insert({
    store_id: from_store_id,
    item_id,
    movement_type: "transfer_out",
    quantity,
    counterparty_store_id: to_store_id,
    note: note ?? null,
    created_by: user?.id ?? null,
  });

  if (outErr) {
    return { ok: false, error: friendlyStockError(outErr.message) };
  }

  // 2. Credit destination
  const { error: inErr } = await supabase.from("stock_ledger").insert({
    store_id: to_store_id,
    item_id,
    movement_type: "transfer_in",
    quantity,
    counterparty_store_id: from_store_id,
    note: note ?? null,
    created_by: user?.id ?? null,
  });

  if (inErr) {
    // transfer_out already committed — log the inconsistency and surface it
    console.error("[stores] transfer_in failed after transfer_out:", inErr.message);
    return { ok: false, error: "Transfer partially recorded — please verify balances on both stores" };
  }

  await writeAudit({
    action: "stores.transfer",
    entityType: "store",
    entityId: from_store_id,
    metadata: { from_store_id, to_store_id, item_id, quantity },
  });

  revalidateStore(from_store_id);
  revalidateStore(to_store_id);
  return { ok: true };
}

// ---------- store master ----------

export async function createStore(
  payload: StoreInput,
): Promise<(OkResult & { storeId: string }) | ErrResult> {
  if (!(await can("stores", "create"))) throw new Error("Forbidden");

  const parsed = storeInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stores")
    .insert(parsed.data)
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to create store" };
  }

  revalidatePath("/stores");
  return { ok: true, storeId: (data as { id: string }).id };
}

export async function updateStore(
  id: string,
  payload: StoreInput,
): Promise<ActionResult> {
  if (!(await can("stores", "edit"))) throw new Error("Forbidden");

  const parsed = storeInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("stores")
    .update(parsed.data)
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  revalidateStore(id);
  return { ok: true };
}

// ---------- access management ----------

export async function grantStoreAccess(
  payload: StoreAccessInput,
): Promise<ActionResult> {
  if (!(await can("stores", "approve"))) throw new Error("Forbidden");

  const parsed = storeAccessInput.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("store_access")
    .upsert(parsed.data, { onConflict: "user_id,store_id", ignoreDuplicates: true });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/stores/${parsed.data.store_id}`);
  return { ok: true };
}

export async function revokeStoreAccess(accessId: string): Promise<ActionResult> {
  if (!(await can("stores", "approve"))) throw new Error("Forbidden");

  const supabase = await createClient();

  // Fetch store_id before deleting so we can revalidate it
  const { data: row } = await supabase
    .from("store_access")
    .select("store_id")
    .eq("id", accessId)
    .maybeSingle();

  const { error } = await supabase
    .from("store_access")
    .delete()
    .eq("id", accessId);

  if (error) return { ok: false, error: error.message };

  const storeId = (row as { store_id: string } | null)?.store_id;
  if (storeId) revalidateStore(storeId);
  return { ok: true };
}
