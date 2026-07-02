import { z } from "zod";

// ============================================================================
// Config lookups — generic kind-discriminated material/spec masters (0218)
// ============================================================================
export const LOOKUP_KINDS = [
  "material_category",
  "composition",
  "yarn_count",
  "yarn_purity",
  "process",
  "component",
  "gauge",
  "knitting_dia",
  "commodity",
] as const;
export type LookupKind = (typeof LOOKUP_KINDS)[number];
export const LOOKUP_KIND_LABELS: Record<LookupKind, string> = {
  material_category: "Material Categories",
  composition: "Compositions",
  yarn_count: "Yarn Counts",
  yarn_purity: "Yarn Purities",
  process: "Processes",
  component: "Components",
  gauge: "Gauges",
  knitting_dia: "Knitting Dias",
  commodity: "Commodities",
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
