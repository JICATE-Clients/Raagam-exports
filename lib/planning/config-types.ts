import { z } from "zod";

// ---------------------------------------------------------------------------
// Color/Print Details
// ---------------------------------------------------------------------------

export const ENTRY_TYPES = ["yarn_dyeing", "fabric_dyeing", "fabric_print", "garment_design", "accessories"] as const;

export interface ColorPrintDetail {
  id: string;
  code: string | null;
  entry_date: string;
  entry_type: (typeof ENTRY_TYPES)[number];
  process_name: string | null;
  location_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ColorPrintDetailLine {
  id: string;
  color_print_id: string;
  sno: number;
  color_type: string | null;
  description: string;
  process_loss_pct: number;
  blocked: boolean;
}

export const colorPrintDetailInput = z.object({
  entry_date: z.string(),
  entry_type: z.enum(ENTRY_TYPES),
  process_name: z.string().optional().nullable(),
  location_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z.array(z.object({
    color_type: z.string().optional().nullable(),
    description: z.string().min(1),
    process_loss_pct: z.coerce.number().default(0),
    blocked: z.boolean().default(false),
  })).default([]),
});
export type ColorPrintDetailInput = z.infer<typeof colorPrintDetailInput>;

// ---------------------------------------------------------------------------
// Material Rate
// ---------------------------------------------------------------------------

export interface MaterialRateEntry {
  id: string;
  code: string | null;
  entry_date: string;
  group_no: string | null;
  group_description: string | null;
  customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MaterialRateItem {
  id: string;
  rate_entry_id: string;
  sno: number;
  item_class_name: string | null;
  description: string | null;
  process_name: string | null;
  rate_uom_id: string | null;
  rate: number;
}

export const materialRateEntryInput = z.object({
  entry_date: z.string(),
  group_no: z.string().optional().nullable(),
  group_description: z.string().optional().nullable(),
  customer_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(z.object({
    item_class_name: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    process_name: z.string().optional().nullable(),
    rate_uom_id: z.string().optional().nullable(),
    rate: z.coerce.number().default(0),
  })).default([]),
});
export type MaterialRateEntryInput = z.infer<typeof materialRateEntryInput>;

// ---------------------------------------------------------------------------
// General Stocks
// ---------------------------------------------------------------------------

export interface GeneralStockGroup {
  id: string;
  code: string | null;
  group_date: string;
  group_description: string | null;
  long_description: string | null;
  created_at: string;
  updated_at: string;
}

export const generalStockGroupInput = z.object({
  group_date: z.string(),
  group_description: z.string().optional().nullable(),
  long_description: z.string().optional().nullable(),
  item_classes: z.array(z.object({
    item_class_code: z.string().min(1),
    is_selected: z.boolean().default(false),
  })).default([]),
});
export type GeneralStockGroupInput = z.infer<typeof generalStockGroupInput>;
