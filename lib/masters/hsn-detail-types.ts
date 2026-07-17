import { z } from "zod";
import { nullableFormat, HSN_RE } from "@/lib/validation/formats";

// ============================================================================
// HSN detail — GST master (0263). Legacy EDP2 "HSN detail" form: Item Class
// (→ config_lookups 'item_class') · For (Materials/Process) · Description ·
// HSN Code · Inactive + is_draft. Distinct from the `hsn_code` config_lookups
// kind (0231) used by the Material/Process/Commodity HSN pickers.
// ============================================================================

export const HSN_DETAIL_FOR = [
  { value: "materials", label: "Materials" },
  { value: "process", label: "Process" },
] as const;
export type HsnDetailFor = (typeof HSN_DETAIL_FOR)[number]["value"];

export function hsnDetailForLabel(v: string | null | undefined): string {
  return HSN_DETAIL_FOR.find((f) => f.value === v)?.label ?? "—";
}

export interface HsnDetail {
  id: string;
  item_class_id: string;
  for_type: HsnDetailFor;
  description: string | null;
  hsn_code: string | null;
  inactive: boolean;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
}

const nullableText = z.string().optional().nullable();

export const hsnDetailInput = z.object({
  item_class_id: z.string().uuid("Item Class is required"),
  for_type: z.enum(["materials", "process"]).default("materials"),
  description: nullableText,
  hsn_code: nullableFormat(HSN_RE, "HSN/SAC must be 4, 6 or 8 digits"),
  inactive: z.boolean().default(false),
  is_draft: z.boolean().default(false),
});
export type HsnDetailInput = z.infer<typeof hsnDetailInput>;
