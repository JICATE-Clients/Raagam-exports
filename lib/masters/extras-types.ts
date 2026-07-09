import { z } from "zod";

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
};

export interface ConfigLookup {
  id: string;
  kind: LookupKind;
  code: string | null;
  name: string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Attributes — master-detail (0220). Legacy EDP2 "Attribute" master: a header
// with a fixed material-category Type + an optional child grid of values.
// ============================================================================
export const ATTRIBUTE_TYPES = [
  "Yarn",
  "Fabric",
  "Sewing Accessories",
  "Packing Accessories",
  "General",
  "Garments",
  "Consumables",
  "Capital Items",
] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

export interface AttributeValue {
  id: string;
  attribute_id: string;
  sno: number;
  value: string;
}
export interface Attribute {
  id: string;
  code: string;
  type: AttributeType | null;
  description: string | null;
  blocked: boolean;
  has_attributes: boolean;
  created_at: string;
  updated_at: string;
  values: AttributeValue[];
}

export const attributeValueInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  value: z.string().min(1),
});
export const attributeInput = z.object({
  code: z.string().min(1, "Code is required"),
  type: z.enum(ATTRIBUTE_TYPES).nullable().default(null),
  description: z.string().optional().nullable(),
  blocked: z.boolean().default(false),
  has_attributes: z.boolean().default(false),
  values: z.array(attributeValueInput).default([]),
});
export type AttributeInput = z.infer<typeof attributeInput>;
export const lookupInput = z.object({
  kind: z.enum(LOOKUP_KINDS),
  code: z.string().optional().nullable(),
  name: z.string().min(1),
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
  code: z.string().min(1).max(8),
  name: z.string().min(1),
  symbol: z.string().optional().nullable(),
});
export type CurrencyInput = z.infer<typeof currencyInput>;
