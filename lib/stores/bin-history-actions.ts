"use server";

import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/auth/server";

/**
 * A BIN'S HISTORY (Purchase ▸ Purchase Store ▸ Overview, bin panel — user 2026-11-04, phase 1).
 * Every stock movement booked to the bin, newest first, named by the document that made it.
 * Nothing new is recorded: `stock_ledger.bin_id` has been written by every stock document since
 * bins existed, so this only reads it. RLS on the ledger keeps it to the units this login holds.
 */

export type BinMove = {
  id: string;
  date: string;
  /** "Received", "Issued", "Moved in", "Moved out", "Adjusted +", "Adjusted −", "Returned". */
  word: string;
  /** +1 stock came into the bin, −1 went out. */
  sign: 1 | -1;
  item: string;
  item_class: string;
  qty: number;
  uom: string;
  lot: string | null;
  /** The document's number ("GRN-0014", "STR-0003"), or its kind when it has none. */
  ref: string;
};

const IN = new Set(["receipt", "return", "transfer_in", "adjust_in"]);
const WORD: Record<string, string> = {
  receipt: "Received",
  issue: "Issued",
  transfer_in: "Moved in",
  transfer_out: "Moved out",
  adjust_in: "Adjusted +",
  adjust_out: "Adjusted −",
  return: "Returned",
};
/** The document table behind each reference_type — only those that carry a `code`. */
const DOC_TABLE: Record<string, string> = {
  grn: "grns",
  stock_transfer: "stock_transfers",
  stock_adjustment: "stock_adjustments",
  opening_stock: "opening_stocks",
  vendor_return: "vendor_returns",
  delivery_challan: "delivery_challans",
  dc_receipt: "dc_receipts",
  dc_return: "dc_returns",
  department_return: "department_returns",
  material_requisition: "material_requisitions",
  csp_receipt: "csp_receipts",
};
const KIND_WORD: Record<string, string> = {
  grn: "GRN",
  stock_transfer: "Stock Transfer",
  stock_adjustment: "Stock Adjustment",
  opening_stock: "Opening Stock",
  vendor_return: "Rejection DC",
  delivery_challan: "Delivery Challan",
};

export async function loadBinHistory(binId: string): Promise<{ ok: true; moves: BinMove[] } | { ok: false; error: string }> {
  if (!(await can("stores", "view")) && !(await can("materials_purchase", "view"))) return { ok: false, error: "Forbidden" };
  if (!binId) return { ok: true, moves: [] };
  const s = await createClient();
  const { data, error } = await s
    .from("stock_ledger")
    .select("id, txn_date, created_at, movement_type, quantity, lot_no, reference_type, reference_id, item_id, uom_id")
    .eq("bin_id", binId)
    .order("txn_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as {
    id: string;
    txn_date: string;
    movement_type: string;
    quantity: number | string;
    lot_no: string | null;
    reference_type: string | null;
    reference_id: string | null;
    item_id: string;
    uom_id: string | null;
  }[];
  if (!rows.length) return { ok: true, moves: [] };

  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const byType = new Map<string, string[]>();
  for (const r of rows) if (r.reference_type && r.reference_id && DOC_TABLE[r.reference_type]) byType.set(r.reference_type, uniq([...(byType.get(r.reference_type) ?? []), r.reference_id]));

  const [items, uoms, ...docs] = await Promise.all([
    s.from("items").select("id, name, item_class_id").in("id", uniq(rows.map((r) => r.item_id))),
    s.from("uoms").select("id, code").in("id", uniq(rows.map((r) => r.uom_id))),
    ...[...byType.entries()].map(([type, ids]) => s.from(DOC_TABLE[type]).select("id, code").in("id", ids)),
  ]);
  const itemRows = (items.data ?? []) as { id: string; name: string; item_class_id: string | null }[];
  const itemOf = new Map(itemRows.map((i) => [i.id, i]));
  // Item classes are config_lookups rows joined by id, with no foreign key (the stock reports
  // join them the same way, 0793) — so a plain second read, not a PostgREST embed.
  const { data: classes } = await s.from("config_lookups").select("id, name").in("id", uniq(itemRows.map((i) => i.item_class_id)));
  const classOf = new Map(((classes ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const uomOf = new Map(((uoms.data ?? []) as { id: string; code: string }[]).map((u) => [u.id, u.code]));
  const codeOf = new Map<string, string>();
  for (const d of docs) for (const x of (d.data ?? []) as { id: string; code: string | null }[]) if (x.code) codeOf.set(x.id, x.code);

  return {
    ok: true,
    moves: rows.map((r) => {
      const it = itemOf.get(r.item_id);
      return {
        id: r.id,
        date: r.txn_date,
        word: WORD[r.movement_type] ?? r.movement_type,
        sign: IN.has(r.movement_type) ? 1 : -1,
        item: it?.name ?? "—",
        item_class: (it?.item_class_id && classOf.get(it.item_class_id)) || "",
        qty: Number(r.quantity) || 0,
        uom: (r.uom_id && uomOf.get(r.uom_id)) || "",
        lot: r.lot_no,
        ref: (r.reference_id && codeOf.get(r.reference_id)) || KIND_WORD[r.reference_type ?? ""] || (r.reference_type ?? "—"),
      };
    }),
  };
}
