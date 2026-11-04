import "server-only";
import { createClient } from "@/lib/supabase/server";
import { bandOf, type GroupKind, type StockStatementRow, type StockStatus, type StockValueRow } from "@/lib/reports/stock-statement-types";

export type { StockStatementRow, StockValueRow } from "@/lib/reports/stock-statement-types";

/**
 * STOCK STATEMENT · STOCK STATEMENT WITH VALUE (client brief 2026-11-02; plan
 * doc/reports/stock-statement-plan.md).
 *
 * One row per FIFO receipt layer still holding stock (0793 `report_stock_statement*`), so
 * every remaining quantity carries the GRN it came in on, its age and that GRN's PO rate.
 * The layers PARTITION the ledger's store · item balance — they cannot disagree with it.
 *
 * TWO FUNCTIONS ON PURPOSE. The quantity report calls the RPC that has no rate column at
 * all, so a price never reaches the browser — a hidden column would still ship it in the
 * RSC payload. The value report calls the one that also needs the Value report SCREEN in
 * the permission tree, checked inside the database.
 */

const SOURCE_LABEL: Record<string, string> = {
  opening: "Opening",
  transfer: "Transfer",
  process_receipt: "Process Receipt",
  adjust: "Adjustment",
  return: "Return",
  other: "Other",
};

type RawRow = {
  layer_id: string;
  unit_name: string | null;
  store_name: string | null;
  store_type: string | null;
  bin_code: string | null;
  item_name: string | null;
  item_class: string | null;
  uom_code: string | null;
  lot_no: string | null;
  source_type: string;
  grn_code: string | null;
  in_date: string;
  age_days: number | string;
  po_code: string | null;
  vendor_name: string | null;
  group_kind: GroupKind;
  order_no: string | null;
  customer_name: string | null;
  stock_status: StockStatus;
  qty_on_hand: number | string;
  rate?: number | string | null;
  value?: number | string | null;
};

/* PostgREST returns numeric as a string — coerce here, never in the screen. */
function shape(r: RawRow): StockStatementRow {
  const age = Number(r.age_days) || 0;
  return {
    key: r.layer_id,
    unit: r.unit_name ?? "—",
    store: r.store_name ?? "—",
    store_type: r.store_type ?? "",
    bin: r.bin_code ?? "—",
    item: r.item_name ?? "—",
    item_class: r.item_class ?? "—",
    uom: r.uom_code ?? "",
    lot: r.lot_no ?? "—",
    reference: r.grn_code ?? SOURCE_LABEL[r.source_type] ?? "—",
    in_date: r.in_date,
    age_days: age,
    band: bandOf(age),
    po: r.po_code ?? "—",
    vendor: r.vendor_name ?? "—",
    group_kind: r.group_kind,
    order_no: r.order_no ?? "—",
    customer: r.customer_name ?? "—",
    status: r.stock_status,
    qty: Number(r.qty_on_hand) || 0,
  };
}

/* Oldest stock first — the order a store manager clears it in. */
const byAge = (a: StockStatementRow, b: StockStatementRow) => b.age_days - a.age_days || a.item.localeCompare(b.item);

export async function stockStatement(asOf: string): Promise<StockStatementRow[]> {
  const s = await createClient();
  const { data, error } = await s.rpc("report_stock_statement", { p_as_of: asOf });
  if (error) throw new Error(`Stock statement: ${error.message}`);
  return ((data ?? []) as RawRow[]).map(shape).sort(byAge);
}

export async function stockStatementValue(asOf: string): Promise<StockValueRow[]> {
  const s = await createClient();
  const { data, error } = await s.rpc("report_stock_statement_value", { p_as_of: asOf });
  if (error) throw new Error(`Stock statement with value: ${error.message}`);
  return ((data ?? []) as RawRow[])
    .map((r) => {
      const rate = r.rate == null ? null : Number(r.rate);
      return { ...shape(r), rate, value: Number(r.value) || 0 };
    })
    .sort(byAge);
}

/** GRN lines held at Pending QC (0791) — delivered, not yet stock. */
export async function pendingQcCount(): Promise<number> {
  const s = await createClient();
  const { data, error } = await s.rpc("report_stock_pending_qc");
  if (error) throw new Error(`Pending QC: ${error.message}`);
  return Number(data) || 0;
}

/**
 * PURCHASE ▸ INVENTORY DASHBOARD's read (user 2026-11-04). The SAME two RPCs as the two
 * reports, tried in the order of what the caller may see: with value if they hold the
 * Stock Statement with Value screen, else quantities, else nothing. Both RPCs refuse with
 * 42501 rather than returning a partial answer, so the refusal is read off the error and
 * turned into a sentence; any other error still throws. No database rule is widened here.
 */
export type InventoryRead =
  | { access: "value"; rows: StockValueRow[] }
  | { access: "qty"; rows: StockStatementRow[] }
  | { access: "none"; rows: [] };

export async function inventoryDashboard(asOf: string): Promise<InventoryRead> {
  const s = await createClient();
  const v = await s.rpc("report_stock_statement_value", { p_as_of: asOf });
  if (!v.error) {
    const rows = ((v.data ?? []) as RawRow[])
      .map((r) => ({ ...shape(r), rate: r.rate == null ? null : Number(r.rate), value: Number(r.value) || 0 }))
      .sort(byAge);
    return { access: "value", rows };
  }
  if (v.error.code !== "42501") throw new Error(`Inventory: ${v.error.message}`);
  const q = await s.rpc("report_stock_statement", { p_as_of: asOf });
  if (!q.error) return { access: "qty", rows: ((q.data ?? []) as RawRow[]).map(shape).sort(byAge) };
  if (q.error.code !== "42501") throw new Error(`Inventory: ${q.error.message}`);
  return { access: "none", rows: [] };
}
