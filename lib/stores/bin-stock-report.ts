import "server-only";
import { createClient } from "@/lib/supabase/server";
import { today } from "@/lib/calendar";

/**
 * BIN STOCK & AGING (user 2026-10-31, multi-bin rule §4): stock per Store ▸ Bin ▸ Item ▸ Lot,
 * with how long the lot has sat there. Read off `stock_lot_balances` (0790), which sums the
 * ledger — so the report cannot disagree with the stock. RLS on the ledger scopes it to the
 * reader's unit and stores.
 */

export type AgeBand = "0-30" | "31-60" | "61-90" | "90+";
export type BinStockRow = {
  key: string;
  unit: string;
  store: string;
  bin: string | null;
  item: string;
  uom: string | null;
  lot: string | null;
  qty: number;
  value: number;
  first_in: string | null;
  age_days: number | null;
  band: AgeBand | null;
};

const DAY = 86_400_000;
const bandOf = (d: number | null): AgeBand | null => (d == null ? null : d <= 30 ? "0-30" : d <= 60 ? "31-60" : d <= 90 ? "61-90" : "90+");
const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];

export async function binStock(): Promise<BinStockRow[]> {
  const s = await createClient();
  const { data, error } = await s
    .from("stock_lot_balances")
    .select("location_id, store_id, bin_id, item_id, lot_no, quantity, value, first_in_date")
    .gt("quantity", 0);
  if (error) throw new Error(`Bin stock: ${error.message}`);
  const rows = (data ?? []) as {
    location_id: string | null;
    store_id: string;
    bin_id: string | null;
    item_id: string;
    lot_no: string | null;
    quantity: number;
    value: number;
    first_in_date: string | null;
  }[];
  if (rows.length === 0) return [];
  const [stores, bins, items, units] = await Promise.all([
    s.from("stores").select("id, name").in("id", uniq(rows.map((r) => r.store_id))),
    s.from("bins").select("id, bin_code").in("id", uniq(rows.map((r) => r.bin_id))),
    s.from("items").select("id, name, uoms!uom_id(code)").in("id", uniq(rows.map((r) => r.item_id))),
    s.from("locations").select("id, name").in("id", uniq(rows.map((r) => r.location_id))),
  ]);
  const store = new Map(((stores.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
  const bin = new Map(((bins.data ?? []) as { id: string; bin_code: string }[]).map((x) => [x.id, x.bin_code]));
  const item = new Map(
    ((items.data ?? []) as unknown as { id: string; name: string; uoms: { code: string } | null }[]).map((x) => [x.id, x]),
  );
  const unit = new Map(((units.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
  const now = Date.parse(today());
  return rows
    .map((r) => {
      const age = r.first_in_date ? Math.floor((now - Date.parse(r.first_in_date)) / DAY) : null;
      return {
        key: `${r.store_id}|${r.bin_id ?? ""}|${r.item_id}|${r.lot_no ?? ""}`,
        unit: r.location_id ? (unit.get(r.location_id) ?? "—") : "—",
        store: store.get(r.store_id) ?? "—",
        bin: r.bin_id ? (bin.get(r.bin_id) ?? "—") : null,
        item: item.get(r.item_id)?.name ?? "—",
        uom: item.get(r.item_id)?.uoms?.code ?? null,
        lot: r.lot_no,
        qty: Number(r.quantity) || 0,
        value: Number(r.value) || 0,
        first_in: r.first_in_date,
        age_days: age,
        band: bandOf(age),
      };
    })
    // Oldest first — the lots to use (or chase) before anything newer.
    .sort((a, b) => (b.age_days ?? -1) - (a.age_days ?? -1) || a.store.localeCompare(b.store));
}
