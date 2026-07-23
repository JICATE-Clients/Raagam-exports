// Client-safe types + defaults for packing-list format columns. Kept separate
// from packing-format-columns-service.ts (which is `server-only`) so client
// components (packing-format-columns-dialog) can import the type + DEFAULT_COLUMNS
// without pulling the server-only Supabase code into the client bundle.

export type PackingFormatColumn = {
  id: string;
  packing_list_format_id: string;
  column_key: string;
  display_name: string;
  display_order: number;
  is_visible: boolean;
};

/** Default columns when a format has no saved configuration. */
export const DEFAULT_COLUMNS: Omit<PackingFormatColumn, "id" | "packing_list_format_id">[] = [
  { column_key: "carton_no", display_name: "Carton No", display_order: 1, is_visible: true },
  { column_key: "color", display_name: "Colour", display_order: 2, is_visible: true },
  { column_key: "size", display_name: "Size", display_order: 3, is_visible: true },
  { column_key: "quantity", display_name: "Qty", display_order: 4, is_visible: true },
  { column_key: "net_weight", display_name: "Net Wt", display_order: 5, is_visible: true },
  { column_key: "gross_weight", display_name: "Gross Wt", display_order: 6, is_visible: true },
  { column_key: "style", display_name: "Style", display_order: 7, is_visible: false },
  { column_key: "po_no", display_name: "PO No", display_order: 8, is_visible: false },
  { column_key: "ratio", display_name: "Ratio", display_order: 9, is_visible: false },
  { column_key: "dimensions", display_name: "Dimensions", display_order: 10, is_visible: false },
];
