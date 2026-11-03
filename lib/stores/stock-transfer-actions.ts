"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";
import { writeAudit } from "@/lib/audit";
import {
  stockTransferInput,
  type StockTransferInput,
  type TransferLayer,
  type TransferReqLine,
} from "./stock-transfer-types";

type Err = { ok: false; error: string };
type R = { ok: true } | Err;

const LIST = "/purchase/transfers";

function bad(m: string): Err {
  return { ok: false, error: m };
}
function revalidate(id?: string) {
  revalidatePath(LIST);
  if (id) revalidatePath(`${LIST}/${id}`);
  revalidatePath("/purchase/store");
  revalidatePath("/purchase/requirement-po");
}

/**
 * The stock a line can draw from: every layer still on hand in the From store that belongs to
 * the From owner (both null = General Stock). Rate is null unless the operator may see money.
 */
export async function loadTransferLayers(
  storeId: string,
  garmentOrderId: string | null,
  iwoId: string | null,
  asOf: string | null,
): Promise<{ ok: true; layers: TransferLayer[] } | Err> {
  if (!(await can("stores", "view"))) return bad("Forbidden");
  if (!storeId) return { ok: true, layers: [] };
  const s = await createClient();
  const { data, error } = await s.rpc("stock_transfer_layers", {
    p_store_id: storeId,
    p_garment_order_id: garmentOrderId,
    p_iwo_id: iwoId,
    p_as_of: asOf || null,
  });
  if (error) return bad(error.message);
  return {
    ok: true,
    layers: ((data ?? []) as TransferLayer[]).map((l) => ({
      ...l,
      qty_on_hand: Number(l.qty_on_hand) || 0,
      rate: l.rate == null ? null : Number(l.rate),
    })),
  };
}

/**
 * The target order's requirement lines (what Raise PO lists), so a line can say which need the
 * stock answers. Empty for a role without Materials Purchase view — the line is then saved with
 * no requirement, and the transfer still moves the stock.
 */
export async function loadTransferReqLines(orderId: string | null): Promise<{ ok: true; lines: TransferReqLine[] } | Err> {
  if (!(await can("stores", "view"))) return bad("Forbidden");
  if (!orderId) return { ok: true, lines: [] };
  const s = await createClient();
  const { data, error } = await s.rpc("po_requirement_lines", { p_source_ids: [orderId] });
  if (error) return { ok: true, lines: [] };
  type Raw = { req_key: string; item_id: string; slice_label: string | null; colour: string | null; uom_code: string | null; balance_qty: number };
  return {
    ok: true,
    lines: ((data ?? []) as Raw[]).map((r) => ({
      req_key: r.req_key,
      item_id: r.item_id,
      label: [r.slice_label, r.colour].filter((x) => x && x.trim()).join(" · ") || "Requirement",
      uom_code: r.uom_code,
      balance_qty: Number(r.balance_qty) || 0,
    })),
  };
}

/**
 * Create or update a DRAFT transfer — header and lines in one call. Lines are replaced (delete +
 * insert); the DB refuses both once the transfer is posted, re-checks each line's stock against
 * the From store and owner, and rejects a type whose owners do not fit it (stock_transfer_guard).
 */
export async function saveStockTransfer(
  id: string | null,
  payload: StockTransferInput,
): Promise<{ ok: true; id: string } | Err> {
  if (!(await can("stores", id ? "edit" : "create"))) return bad("Forbidden");
  const p = stockTransferInput.safeParse(payload);
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid input");
  const { lines, ...header } = p.data;

  const s = await createClient();
  let docId = id;
  if (docId) {
    const { error } = await s.from("stock_transfers").update(header).eq("id", docId);
    if (error) return bad(error.message);
    const { error: dErr } = await s.from("stock_transfer_lines").delete().eq("transfer_id", docId);
    if (dErr) return bad(dErr.message);
  } else {
    const { data, error } = await s.from("stock_transfers").insert(header).select("id").single();
    if (error || !data) return bad(error?.message ?? "Failed to create");
    docId = data.id as string;
  }

  const { error: lErr } = await s.from("stock_transfer_lines").insert(
    lines.map((l, i) => ({
      transfer_id: docId,
      source_ledger_id: l.source_ledger_id,
      // Overwritten from the layer by the DB trigger; NOT NULL needs a value.
      item_id: "00000000-0000-0000-0000-000000000000",
      quantity: l.quantity,
      to_bin_id: l.to_bin_id || null,
      req_key: l.req_key || null,
      bags: l.bags ?? null,
      cones: l.cones ?? null,
      sort_order: i,
    })),
  );
  if (lErr) return bad(lErr.message);

  revalidate(docId);
  return { ok: true, id: docId };
}

/** Draft → posted: a transfer_out and a transfer_in per line, in one DB transaction. */
export async function postStockTransfer(id: string): Promise<R> {
  if (!(await can("stores", "edit"))) return bad("Forbidden");
  const s = await createClient();
  const { error } = await s.rpc("stock_transfer_post", { p_id: id });
  if (error) return bad(error.message);
  await writeAudit({ action: "stock_transfer.posted", entityType: "stock_transfer", entityId: id });
  revalidate(id);
  return { ok: true };
}

export async function cancelStockTransfer(id: string): Promise<R> {
  if (!(await can("stores", "edit"))) return bad("Forbidden");
  const s = await createClient();
  const { error } = await s.from("stock_transfers").update({ status: "cancelled" }).eq("id", id);
  if (error) return bad(error.message);
  revalidate(id);
  return { ok: true };
}

export async function deleteStockTransfer(id: string): Promise<R> {
  if (!(await can("stores", "delete"))) return bad("Forbidden");
  const s = await createClient();
  const { data, error } = await s.from("stock_transfers").delete().eq("id", id).select("id");
  if (error) return bad(error.message);
  if (!data?.length) return bad("Nothing was deleted — you may not have access to this transfer");
  revalidate();
  return { ok: true };
}
