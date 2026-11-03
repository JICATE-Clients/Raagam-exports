/**
 * Stock Statement types and labels — client-safe (the service beside it is "server-only").
 */

export type StockStatus = "accepted" | "rejected" | "replacement" | "processing" | "transit";
export type GroupKind = "re" | "swo" | "iwo" | "general";
export type AgeBand = "0-30" | "31-60" | "61-90" | "90+";

export type StockStatementRow = {
  key: string;
  unit: string;
  store: string;
  store_type: string;
  bin: string;
  item: string;
  item_class: string;
  uom: string;
  lot: string;
  /** The GRN code, or the source word ("Opening", "Transfer"…) for a layer with no GRN. */
  reference: string;
  in_date: string;
  age_days: number;
  band: AgeBand;
  po: string;
  vendor: string;
  group_kind: GroupKind;
  order_no: string;
  customer: string;
  status: StockStatus;
  qty: number;
};

export type StockValueRow = StockStatementRow & {
  /** Null when no PO, yarn rate or budget rate is known — qty still counts. */
  rate: number | null;
  value: number;
};

export const STATUS_LABEL: Record<StockStatus, string> = {
  accepted: "Accepted",
  rejected: "Rejected",
  replacement: "Replacement",
  processing: "At Processor",
  transit: "In Transit",
};
export const STATUS_ORDER: StockStatus[] = ["accepted", "rejected", "replacement", "processing", "transit"];

export const GROUP_LABEL: Record<GroupKind, string> = {
  re: "Order / RE",
  swo: "Sample / SWO",
  iwo: "Internal / IWO",
  general: "General",
};
export const GROUP_ORDER: GroupKind[] = ["re", "swo", "iwo", "general"];

export const AGE_BANDS: AgeBand[] = ["0-30", "31-60", "61-90", "90+"];
export const bandOf = (d: number): AgeBand => (d <= 30 ? "0-30" : d <= 60 ? "31-60" : d <= 90 ? "61-90" : "90+");
