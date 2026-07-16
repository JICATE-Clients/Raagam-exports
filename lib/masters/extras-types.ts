import { z } from "zod";
import { CURRENCY_RE } from "@/lib/validation/formats";

// ============================================================================
// Config lookups — generic kind-discriminated material/spec masters (0218)
// ============================================================================
// Ordered to mirror the legacy EDP2 "Material" sub-module child list.
// Stock unit (uoms) and Material (items) are omitted here — they keep their own
// rich tables/tabs and are surfaced as links in the child selector (0219).
export const LOOKUP_KINDS = [
  "attribute",
  "levy",
  "material_category",
  "material_attribute",
  "yarn_count",
  "yarn_purity",
  "composition",
  "process",
  "component",
  "gauge",
  "knitting_dia",
  "out_doc_term",
  "commodity",
  "item_class",
  "hsn_code",
  "city",
  "state",
  "department",
  "designation",
  "internal_department",
  "ship_type",
  "payment_term",
  "employee_category",
  "team",
  "account_schedule",
  "vendor_group",
  "agent_type",
  "agent",
  "packing_list_format",
  "commercial_invoice_format",
  "shift_category",
  "doc_track",
  "doc_menu",
  "doc_value_type",
  "doc_value_from",
  // Garment Orders ▸ Style master pickers (0124)
  "style_category",
  "coordinate",
  "style_component",
  "structure",
  "trims_category",
  "size",
  // Garment Orders ▸ Order Amendment ▸ Color/Print tab (0128) — no print master exists
  "roll_form_print",
  // Garment Orders ▸ Packing List Advice ▸ Warehouse Name (0130)
  "warehouse",
  // Orders ▸ TA ▸ TA Activity ▸ Type picker (0266)
  "ta_activity_type",
  // Materials ▸ Fabric/Yarn textile logic (0279)
  "fabric_structure",
  "fabric_type",
  "yarn_type",
  // Materials ▸ Levy ▸ Duty Structure ▸ Annexure Category (0282)
  "duty_category",
] as const;
export type LookupKind = (typeof LOOKUP_KINDS)[number];
export const LOOKUP_KIND_LABELS: Record<LookupKind, string> = {
  attribute: "Attributes",
  levy: "Levies",
  material_category: "Categories",
  material_attribute: "Material Attributes",
  yarn_count: "Counts",
  yarn_purity: "Yarn Purities",
  composition: "Compositions",
  process: "Processes",
  component: "Components",
  gauge: "Gauges",
  knitting_dia: "Knitting Dias",
  out_doc_term: "Out Document Terms",
  commodity: "Commodities",
  item_class: "Item Classes",
  hsn_code: "HSN Codes",
  city: "Cities",
  state: "States",
  department: "Departments",
  designation: "Designations",
  internal_department: "Internal Departments",
  ship_type: "Ship Types (Incoterms)",
  payment_term: "Payment Terms",
  employee_category: "Employee Categories",
  team: "Teams",
  account_schedule: "Account Schedules",
  vendor_group: "Vendor Groups",
  agent_type: "Agent Types",
  agent: "Agents",
  packing_list_format: "Packing List Formats",
  commercial_invoice_format: "Commercial Invoice Formats",
  shift_category: "Shift Categories",
  doc_track: "Document Tracks",
  doc_menu: "Document Menus",
  doc_value_type: "Document Value Types",
  doc_value_from: "Document Value Sources",
  style_category: "Style Categories",
  coordinate: "Coordinates",
  style_component: "Style Components",
  structure: "Structures",
  trims_category: "Trims Categories",
  size: "Sizes",
  roll_form_print: "Roll Form Prints",
  warehouse: "Warehouses",
  ta_activity_type: "TA Activity Types",
  fabric_structure: "Fabric Structures",
  fabric_type: "Fabric Types",
  yarn_type: "Yarn Types",
  duty_category: "Duty Categories",
};

export interface ConfigLookup {
  id: string;
  kind: LookupKind;
  code: string | null;
  name: string;
  /** Functional grouping distinct from Code — only meaningful for
   *  kind='item_class' (e.g. FABRIC's type is "FAB"; Button groups under
   *  "GEN" despite being its own class). Null/absent for every other kind
   *  (0287) — optional so the many inline-add optimistic-update call sites
   *  across the masters screens don't all need updating for one edge kind. */
  type_code?: string | null;
  notes: string | null;
  is_active: boolean;
  /** Legacy attribution (e.g. "SELVARAJ", "admin") — free text, not a
   *  profiles FK, since config_lookups must carry legacy usernames that
   *  don't correspond to real Supabase Auth accounts (0290). Populated
   *  server-side on create; not user-editable via the form. Optional so
   *  the many inline-add optimistic-update call sites across the masters
   *  screens don't all need updating (mirrors `type_code` above, 0287). */
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Attributes (0220, merged into Item Class by 0293). The legacy "Attribute"
// master turned out to be the same data as Item Class (config_lookups kind
// `item_class`) — confirmed against the client's legacy "Attributes - U2"
// report. An "Attribute" row IS an Item Class row; the child grid of named
// values (e.g. GSM, Width) is what Material Attribute Lines actually pick
// from, scoped per Item Class.
// ============================================================================
export interface AttributeValue {
  id: string;
  item_class_id: string;
  sno: number;
  value: string;
}
export interface Attribute extends ConfigLookup {
  values: AttributeValue[];
}

export const attributeValueInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  value: z.string().min(1),
});
export const attributeInput = z.object({
  code: z.string().optional().nullable(),
  name: z.string().min(1, "Name is required"),
  type_code: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
  values: z.array(attributeValueInput).default([]),
});
export type AttributeInput = z.infer<typeof attributeInput>;
export const lookupInput = z.object({
  kind: z.enum(LOOKUP_KINDS),
  code: z.string().optional().nullable(),
  name: z.string().min(1),
  type_code: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
});
export type LookupInput = z.infer<typeof lookupInput>;

// ============================================================================
// Transporters (Associates)
// ============================================================================
export interface Transporter {
  id: string;
  code: string | null;
  name: string;
  contact_person: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export const transporterInput = z.object({
  code: z.string().optional().nullable(),
  name: z.string().min(1),
  contact_person: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
});
export type TransporterInput = z.infer<typeof transporterInput>;

// ============================================================================
// GST rates
// ============================================================================
export interface GstRate {
  id: string;
  name: string;
  rate_pct: number;
  hsn_code: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export const gstRateInput = z.object({
  name: z.string().min(1),
  rate_pct: z.coerce.number().min(0).max(100).default(0),
  hsn_code: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
});
export type GstRateInput = z.infer<typeof gstRateInput>;

// ============================================================================
// Currency management (existing `currencies` table; PK = code)
// ============================================================================
export const currencyInput = z.object({
  code: z.string().min(1).max(8).regex(CURRENCY_RE, "Enter a 3-letter ISO currency code (e.g. INR)"),
  name: z.string().min(1),
  symbol: z.string().optional().nullable(),
});
export type CurrencyInput = z.infer<typeof currencyInput>;
