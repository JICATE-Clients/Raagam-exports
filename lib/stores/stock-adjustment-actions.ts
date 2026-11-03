"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import { stockAdjustmentInput, type AdjLayer, type StockAdjustmentInput } from "./stock-adjustment-types";

type Err = { ok: false; error: string };
type R = { ok: true } | Err;

const LIST = "/purchase/adjustments";

function bad(m: string): Err {
  return { ok: false, error: m };
}
function revalidate(id?: string) {
  revalidatePath(LIST);
  if (id) revalidatePath(`${LIST}/${id}`);
  revalidatePath("/purchase/store");
}

/**
 * The lots a line can adjust: every layer still on hand in the store that belongs to the group
 * (both null = General Stock) and has the header's stock type. Rate is null without the money grant.
 */
export async function loadAdjustmentLayers(
  storeId: string,
  garmentOrderId: string | null,
  iwoId: string | null,
  stockType: string,
  asOf: string | null,
): Promise<{ ok: true; layers: AdjLayer[] } | Err> {
  if (!(await can("stores", "view"))) return bad("Forbidden");
  if (!storeId) return { ok: true, layers: [] };
  const s = await createClient();
  const { data, error } = await s.rpc("stock_adjustment_layers", {
    p_store_id: storeId,
    p_garment_order_id: garmentOrderId,
    p_iwo_id: iwoId,
    p_stock_type: stockType,
    p_as_of: asOf || null,
  });
  if (error) return bad(error.message);
  return {
    ok: true,
    layers: ((data ?? []) as AdjLayer[]).map((l) => ({
      ...l,
      qty_on_hand: Number(l.qty_on_hand) || 0,
      rate: l.rate == null ? null : Number(l.rate),
    })),
  };
}

/**
 * Create or update a DRAFT adjustment — header and lines in one call. Lines are replaced; the DB
 * refuses both once posted and re-checks each line's lot against the store and group.
 */
export async function saveStockAdjustment(
  id: string | null,
  payload: StockAdjustmentInput,
): Promise<{ ok: true; id: string } | Err> {
  if (!(await can("stores", id ? "edit" : "create"))) return bad("Forbidden");
  const p = stockAdjustmentInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const { lines, ...header } = p.data;

  const s = await createClient();
  let docId = id;
  if (docId) {
    const { error } = await s.from("stock_adjustments").update(header).eq("id", docId);
    if (error) return bad(error.message);
    const { error: dErr } = await s.from("stock_adjustment_lines").delete().eq("adjustment_id", docId);
    if (dErr) return bad(dErr.message);
  } else {
    const { data, error } = await s.from("stock_adjustments").insert(header).select("id").single();
    if (error || !data) return bad(error?.message ?? "Failed to create");
    docId = data.id as string;
  }

  const { error: lErr } = await s.from("stock_adjustment_lines").insert(
    lines.map((l, i) => ({
      adjustment_id: docId,
      source_ledger_id: l.source_ledger_id,
      // Overwritten from the layer by the DB trigger; NOT NULL needs a value.
      item_id: "00000000-0000-0000-0000-000000000000",
      direction: l.direction,
      reason: l.reason,
      quantity: l.quantity,
      bags: l.bags ?? null,
      sort_order: i,
    })),
  );
  if (lErr) return bad(lErr.message);

  revalidate(docId);
  return { ok: true, id: docId };
}

/** Draft → posted: one adjust_in / adjust_out per line at the lot's rate, in one DB transaction. */
export async function postStockAdjustment(id: string): Promise<R> {
  if (!(await can("stores", "edit"))) return bad("Forbidden");
  const s = await createClient();
  const { error } = await s.rpc("stock_adjustment_post", { p_id: id });
  if (error) return bad(error.message);
  await writeAudit({ action: "stock_adjustment.posted", entityType: "stock_adjustment", entityId: id });
  revalidate(id);
  return { ok: true };
}

export async function cancelStockAdjustment(id: string): Promise<R> {
  if (!(await can("stores", "edit"))) return bad("Forbidden");
  const s = await createClient();
  const { error } = await s.from("stock_adjustments").update({ status: "cancelled" }).eq("id", id);
  if (error) return bad(error.message);
  revalidate(id);
  return { ok: true };
}

export async function deleteStockAdjustment(id: string): Promise<R> {
  if (!(await can("stores", "delete"))) return bad("Forbidden");
  const s = await createClient();
  const { data, error } = await s.from("stock_adjustments").delete().eq("id", id).select("id");
  if (error) return bad(error.message);
  if (!data?.length) return bad("Nothing was deleted — you may not have access to this adjustment");
  revalidate();
  return { ok: true };
}
