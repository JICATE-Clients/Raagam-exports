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
 * WHO HOLDS STOCK IN THIS STORE (user 2026-11-05, "Strict Store & Order Filtering"): the
 * orders — and whether General Stock — with a positive balance in the From store, so the
 * From Stock Of box lists only owners a line could actually draw from. Read from 0802's
 * `stock_owner_balances` (security_invoker, so the unit's RLS on the ledger applies).
 */
export async function loadStoreStockOwners(
  storeId: string,
): Promise<{ ok: true; orderIds: string[]; general: boolean } | Err> {
  if (!(await can("stores", "view"))) return bad("Forbidden");
  if (!storeId) return { ok: true, orderIds: [], general: false };
  const s = await createClient();
  const { data, error } = await s
    .from("stock_owner_balances")
    .select("garment_order_id, iwo_id")
    .eq("store_id", storeId)
    .gt("quantity", 0);
  // A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST — an empty list here would read "no order holds stock".
  if (error) return bad(`Stock owners: ${error.message}`);
  const ids = new Set<string>();
  let general = false;
  for (const r of (data ?? []) as { garment_order_id: string | null; iwo_id: string | null }[]) {
    const id = r.garment_order_id ?? r.iwo_id;
    if (id) ids.add(id);
    else general = true;
  }
  return { ok: true, orderIds: [...ids], general };
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

/**
 * ASSIGN A BIN (0809, user 2026-11-04 — Purchase ▸ Inventory Dashboard). Puts whole lots into a
 * bin of THEIR OWN store: one `bin_to_bin` Stock Transfer per owner (General Stock, an RE, an IWO),
 * every lot at its full balance, posted at once by the unchanged `stock_transfer_post`. So a bin
 * move has a number on the Stock Transfer register, a print and an audit row, and the lot keeps
 * its GRN, rate and age (both legs carry the receipt as their origin).
 *
 * Every rule is the database's: the header guard refuses a second store, the line guard a missing
 * or unchanged bin, the post re-checks the balance. A post that fails leaves its draft CANCELLED,
 * never a half-done draft on the register.
 */
export async function assignBin(layerIds: string[], toBinId: string): Promise<{ ok: true; codes: string[] } | Err> {
  if (!(await can("stores", "create")) || !(await can("stores", "edit"))) return bad("Moving stock needs Stores create and edit");
  const ids = [...new Set(layerIds.filter(Boolean))];
  if (!ids.length) return bad("Pick the stock to move");
  if (!toBinId) return bad("Pick the bin the stock goes to");

  const s = await createClient();
  const [{ data: bin, error: bErr }, { data: src, error: sErr }] = await Promise.all([
    s.from("bins").select("id, store_id, bin_code").eq("id", toBinId).maybeSingle(),
    s.from("stock_ledger").select("id, store_id, garment_order_id, iwo_id").in("id", ids),
  ]);
  if (bErr) return bad(bErr.message);
  if (!bin) return bad("That bin no longer exists");
  if (sErr) return bad(sErr.message);
  const rows = (src ?? []) as { id: string; store_id: string; garment_order_id: string | null; iwo_id: string | null }[];
  if (rows.length !== ids.length) return bad("Some of the stock picked is no longer there — refresh and try again");
  if (rows.some((r) => r.store_id !== bin.store_id)) return bad(`${bin.bin_code} is in another store — a bin move stays in one store`);

  // One transfer per owner: a transfer has ONE From owner (0803).
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.garment_order_id ?? ""}|${r.iwo_id ?? ""}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  const codes: string[] = [];
  for (const group of groups.values()) {
    const owner = group[0];
    const { data: layers, error: lErr } = await s.rpc("stock_transfer_layers", {
      p_store_id: bin.store_id,
      p_garment_order_id: owner.garment_order_id,
      p_iwo_id: owner.iwo_id,
      p_as_of: null,
    });
    if (lErr) return bad(lErr.message);
    const qtyOf = new Map(((layers ?? []) as { layer_id: string; qty_on_hand: number | string }[]).map((l) => [l.layer_id, Number(l.qty_on_hand) || 0]));

    const { data: head, error: hErr } = await s
      .from("stock_transfers")
      .insert({
        transfer_type: "bin_to_bin",
        from_store_id: bin.store_id,
        to_store_id: bin.store_id,
        from_garment_order_id: owner.garment_order_id,
        from_iwo_id: owner.iwo_id,
        remarks: `PUT AWAY INTO ${bin.bin_code}`,
      })
      .select("id, code")
      .single();
    if (hErr || !head) return bad(hErr?.message ?? "Could not start the bin move");

    const lines = group
      .map((r, i) => ({
        transfer_id: head.id,
        source_ledger_id: r.id,
        item_id: "00000000-0000-0000-0000-000000000000", // replaced from the layer by the line guard
        quantity: qtyOf.get(r.id) ?? 0,
        to_bin_id: bin.id,
        sort_order: i,
      }))
      .filter((l) => l.quantity > 0);
    const fail = async (m: string) => {
      await s.from("stock_transfers").update({ status: "cancelled" }).eq("id", head.id);
      return bad(m);
    };
    if (!lines.length) return fail("Nothing is left of that stock to move");
    const { error: liErr } = await s.from("stock_transfer_lines").insert(lines);
    if (liErr) return fail(liErr.message);
    const { error: pErr } = await s.rpc("stock_transfer_post", { p_id: head.id });
    if (pErr) return fail(pErr.message);
    await writeAudit({ action: "stock_transfer.posted", entityType: "stock_transfer", entityId: head.id, metadata: { kind: "bin_to_bin", to_bin: bin.bin_code } });
    codes.push((head.code as string | null) ?? "");
  }

  revalidate();
  revalidatePath("/purchase/inventory");
  revalidatePath("/masters/materials/bins");
  return { ok: true, codes };
}
