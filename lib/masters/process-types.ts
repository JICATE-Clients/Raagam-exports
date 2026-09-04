import { z } from "zod";
import { capsName } from "@/lib/validation/formats";

// ============================================================================
// Processes — master-detail (0227). Legacy EDP2 "Process" form: a header (name,
// billing basis, "For" applicability flags, planning flags) + an optional
// "Sub Categories" line grid.
//
// Commodity was withdrawn from this master (client 2026-08-01) along with the
// Commodities child itself. `processes.commodity_id` still EXISTS in the
// database and keeps its stored value; leaving it out of this schema is what
// stops every save from writing null over it.
// ============================================================================
export const BILLING_ON = ["Outward Qty", "Inward Qty/Wt", "Outward Qty/Wt"] as const;
export type BillingOn = (typeof BILLING_ON)[number];

export interface ProcessSubCategory {
  id: string;
  process_id: string;
  sno: number;
  sub_category: string;
  short_description: string | null;
  hsn_code: string | null;
}
export interface Process {
  id: string;
  name: string;
  short_description: string | null;
  billing_on: BillingOn | null;
  hsn_code: string | null;
  for_yarn: boolean;
  for_fabric: boolean;
  for_trims: boolean;
  for_garments: boolean;
  for_components: boolean;
  no_planning: boolean;
  designwise_delivery: boolean;
  is_conversion: boolean;
  /** Is this a PRINT process (AOP, rotary, bit printing, …)? (0528) — read by
   *  the Fabric BOM ▸ Fabric Process picker to refuse "Print" until the order
   *  has declared a Roll form print / AOP. Seeded once from names already
   *  containing PRINT; an operator-maintained flag from here on. */
  is_print: boolean;
  has_sub_categories: boolean;
  sl_no: number;
  inactive: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  sub_categories: ProcessSubCategory[];
}

export const processSubCategoryInput = z.object({
  sno: z.coerce.number().int().nonnegative().default(0),
  sub_category: z.string().min(1),
  short_description: z.string().optional().nullable(),
  hsn_code: z.string().optional().nullable(),
});
export const processInput = z.object({
  name: capsName("Process name is required"),
  short_description: z.string().optional().nullable(),
  billing_on: z.enum(BILLING_ON).nullable().default(null),
  hsn_code: z.string().optional().nullable(),
  for_yarn: z.boolean().default(false),
  for_fabric: z.boolean().default(false),
  for_trims: z.boolean().default(false),
  for_garments: z.boolean().default(false),
  for_components: z.boolean().default(false),
  no_planning: z.boolean().default(false),
  designwise_delivery: z.boolean().default(false),
  is_conversion: z.boolean().default(false),
  is_print: z.boolean().default(false),
  has_sub_categories: z.boolean().default(false),
  sl_no: z.coerce.number().int().default(9),
  inactive: z.boolean().default(false),
  sub_categories: z.array(processSubCategoryInput).default([]),
});
export type ProcessInput = z.infer<typeof processInput>;
