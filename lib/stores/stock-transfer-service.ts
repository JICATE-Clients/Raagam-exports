import "server-only";
import { createClient } from "@/lib/supabase/server";
import { withCreators } from "@/lib/created-by";
import { getCurrentLocation } from "@/lib/auth/location";
import type {
  StockTransfer,
  StockTransferLine,
  TransferBinOption,
  TransferOrderOption,
  TransferStoreOption,
} from "./stock-transfer-types";

export interface StockTransferRow extends StockTransfer {
  from_store_name: string | null;
  to_store_name: string | null;
  from_owner: string;
  to_owner: string;
  line_count: number;
  total_qty: number;
}

/**
 * Every order a transfer can name — the RPC Opening Stock (0801) already declares, labelled
 * as Stock Statement prints it. Called directly rather than through that screen's service so
 * the two screens do not move together.
 */
export async function getTransferOrderOptions(): Promise<TransferOrderOption[]> {
  const s = await createClient();
  const { data, error } = await s.rpc("opening_stock_group_options");
  if (error) throw new Error(`Orders: ${error.message}`);
  return ((data ?? []) as { kind: TransferOrderOption["kind"]; id: string; label: string; customer_name: string | null; inactive: boolean }[]).map(
    (o) => ({
      kind: o.kind,
      id: o.id,
      name: o.customer_name ? `${o.label} — ${o.customer_name}` : o.label,
      inactive: !!o.inactive,
    }),
  );
}

/** "General Stock", or the order's label. */
export function ownerLabel(re: string | null, iwo: string | null, orders: Map<string, TransferOrderOption>): string {
  const id = re ?? iwo;
  if (!id) return "General Stock";
  return orders.get(id)?.name ?? "—";
}

/**
 * The working unit's stores a transfer may use, and their bins. Processing and In Transit are
 * left out — stock there belongs to a DC in flight, and the DB refuses them too (0803).
 */
export async function getTransferStoresAndBins(): Promise<{ stores: TransferStoreOption[]; bins: TransferBinOption[]; unitName: string | null }> {
  const { location } = await getCurrentLocation();
  if (!location) return { stores: [], bins: [], unitName: null };
  const s = await createClient();
  const [stores, bins] = await Promise.all([
    s
      .from("stores")
      .select("id, name, store_type")
      .eq("location_id", location.id)
      .eq("is_active", true)
      .not("store_type", "in", "(processing,transit)")
      .order("code"),
    s.from("bins").select("id, bin_code, description, inactive, store_id").eq("location_id", location.id).order("bin_code"),
  ]);
  if (stores.error) throw new Error(`Stores: ${stores.error.message}`);
  if (bins.error) throw new Error(`Bins: ${bins.error.message}`);
  return {
    unitName: location.name ?? null,
    stores: (stores.data ?? []) as TransferStoreOption[],
    bins: ((bins.data ?? []) as { id: string; bin_code: string; description: string | null; inactive: boolean | null; store_id: string | null }[]).map(
      (b) => ({ id: b.id, code: b.bin_code, description: b.description, inactive: !!b.inactive, store_id: b.store_id }),
    ),
  };
}

type ListRaw = StockTransfer & {
  from_store: { name: string | null } | null;
  to_store: { name: string | null } | null;
  stock_transfer_lines: { quantity: number }[] | null;
};

export async function listStockTransfers(): Promise<StockTransferRow[]> {
  const s = await createClient();
  const [res, orders] = await Promise.all([
    s
      .from("stock_transfers")
      // Two FKs to stores: name the column (AGENTS.md "A SECOND FK BREAKS EVERY EXISTING EMBED").
      .select("*, from_store:stores!from_store_id(name), to_store:stores!to_store_id(name), stock_transfer_lines(quantity)")
      // LISTED IN ENTRY ORDER — 1, 2, 3 (user 2026-09-22).
      .order("created_at", { ascending: true }),
    getTransferOrderOptions(),
  ]);
  // A FAILED QUERY IS AN ERROR, NOT AN EMPTY LIST.
  if (res.error) throw new Error(`Stock transfers: ${res.error.message}`);
  const byId = new Map(orders.map((o) => [o.id, o]));
  return withCreators(
    ((res.data ?? []) as unknown as ListRaw[]).map(({ from_store, to_store, stock_transfer_lines, ...r }) => ({
      ...r,
      from_store_name: from_store?.name ?? null,
      to_store_name: to_store?.name ?? null,
      from_owner: ownerLabel(r.from_garment_order_id, r.from_iwo_id, byId),
      to_owner: ownerLabel(r.to_garment_order_id, r.to_iwo_id, byId),
      line_count: stock_transfer_lines?.length ?? 0,
      total_qty: (stock_transfer_lines ?? []).reduce((t, l) => t + (Number(l.quantity) || 0), 0),
    })),
  );
}

/**
 * May this operator see RATE and VALUE? The same screen grant Stock Statement with Value uses
 * (0793) — a role can be given stock quantities without the money.
 */
export async function canSeeStockValue(): Promise<boolean> {
  const s = await createClient();
  const { data, error } = await s.rpc("can_view_report_screen", { p_key: "/reports/stock-statement-value" });
  if (error) return false;
  return data === true;
}

type LineRaw = Omit<StockTransferLine, "item_name" | "lot_no" | "uom_code" | "from_bin_code" | "to_bin_code"> & {
  items: { name: string } | null;
  to_bin: { bin_code: string } | null;
  src: { lot_no: string | null; bins: { bin_code: string } | null; uoms: { code: string | null } | null } | null;
};

export async function getStockTransfer(id: string): Promise<{ doc: StockTransfer; lines: StockTransferLine[] } | null> {
  const s = await createClient();
  const [docRes, linesRes, money] = await Promise.all([
    s.from("stock_transfers").select("*").eq("id", id).maybeSingle(),
    s
      .from("stock_transfer_lines")
      .select("*, items(name), to_bin:bins!to_bin_id(bin_code), src:stock_ledger!source_ledger_id(lot_no, bins(bin_code), uoms(code))")
      .eq("transfer_id", id)
      .order("sort_order"),
    canSeeStockValue(),
  ]);
  if (docRes.error) throw new Error(`Stock transfer: ${docRes.error.message}`);
  if (linesRes.error) throw new Error(`Stock transfer lines: ${linesRes.error.message}`);
  if (!docRes.data) return null;
  return {
    doc: docRes.data as StockTransfer,
    lines: ((linesRes.data ?? []) as unknown as LineRaw[]).map(({ items, to_bin, src, ...l }) => ({
      ...l,
      quantity: Number(l.quantity) || 0,
      item_name: items?.name ?? null,
      lot_no: src?.lot_no ?? null,
      uom_code: src?.uoms?.code ?? null,
      from_bin_code: src?.bins?.bin_code ?? null,
      to_bin_code: to_bin?.bin_code ?? null,
      // Stamped at post (0804); a draft's rate comes from the layer picker, which is gated too.
      rate: money && l.rate != null ? Number(l.rate) : null,
    })),
  };
}
