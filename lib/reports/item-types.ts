/**
 * Row shapes returned by the item reporting RPCs (migration 0352), plus the
 * filter set every item report shares.
 *
 * No "use server" / "use client" and no functions with captured state — these
 * types and the values in `registry.ts` are deliberately plain data so they can
 * cross the RSC boundary freely. Only `ReportConfig` (which holds closures) is
 * confined to the client.
 */

/** Material attributes as answered on the item, e.g. { GSM: "180", Width: "60" }. */
export type ItemAttributes = Record<string, string> | null;

/** One row of `report_item_summary` — grain is item × store × month. */
export interface ItemSummaryRow {
  month: string;
  item_id: string;
  store_id: string | null;
  item_code: string | null;
  item_name: string | null;
  item_class_id: string | null;
  item_class_name: string | null;
  category_id: string | null;
  category_name: string | null;
  sub_category_id: string | null;
  sub_category_name: string | null;
  location_id: string | null;
  stock_uom_code: string | null;
  attributes: ItemAttributes;

  qty_ordered: number;
  qty_opening: number;
  qty_received: number;
  qty_grn_accepted: number;
  qty_grn_rejected: number;
  qty_issued: number;
  qty_returned: number;
  qty_transfer_in: number;
  qty_transfer_out: number;
  qty_adjust_in: number;
  qty_adjust_out: number;
  qty_planned: number;
  qty_sent_out: number;
  qty_came_back: number;
  qty_in: number;
  qty_out: number;
  qty_net: number;

  value_ordered: number;
  value_purchased: number;
  value_consumed: number;
  value_in: number;
  value_out: number;
  value_net: number;

  movements: number;
}

/** One row of `report_item_ledger` — the drill-down, one row per movement. */
export interface ItemLedgerRow {
  fact_id: string;
  fact_source: string;
  fact_kind: string;
  direction: string;
  posts_to_ledger: boolean;
  txn_date: string;
  item_id: string;
  item_code: string | null;
  item_name: string | null;
  item_class_name: string | null;
  category_name: string | null;
  sub_category_name: string | null;
  store_id: string | null;
  store_name: string | null;
  location_id: string | null;
  uom_code: string | null;
  quantity: number;
  rate: number | null;
  value: number | null;
  party_type: string | null;
  party_name: string | null;
  doc_type: string | null;
  doc_id: string | null;
  doc_code: string | null;
  note: string | null;
}

/** One row of `report_item_stock_as_of` — a balance, not a movement. */
export interface ItemStockRow {
  item_id: string;
  store_id: string | null;
  item_code: string | null;
  item_name: string | null;
  item_class_id: string | null;
  item_class_name: string | null;
  category_id: string | null;
  category_name: string | null;
  sub_category_id: string | null;
  sub_category_name: string | null;
  location_id: string | null;
  stock_uom_code: string | null;
  quantity: number;
  value: number;
}

/** Filters shared by every item report; all optional, all null = unfiltered. */
export interface ItemReportFilters {
  from: string;
  to: string;
  location?: string | null;
  store?: string | null;
  itemClass?: string | null;
  category?: string | null;
  subCategory?: string | null;
  item?: string | null;
  vendor?: string | null;
}

/**
 * A summary row with opening/closing balances grafted on by the service.
 * They come from `report_item_stock_as_of`, not from the summary RPC — a running
 * balance can't be produced by the same aggregate that produces period measures.
 */
export interface ItemMovementRow extends ItemSummaryRow {
  qty_opening_balance: number;
  qty_closing_balance: number;
  value_closing_balance: number;
}
