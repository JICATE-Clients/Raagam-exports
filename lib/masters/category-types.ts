import { z } from "zod";

// ============================================================================
// Categories — rich material-classification master (0223). Legacy EDP2
// "Category" form: a required Item Class (→ config_lookups kind item_class) with
// descriptive fields, a Made origin, and optional Levy / Commodity references.
// ============================================================================
export const MADE_TYPES = ["Natural", "Manmade", "Mixed"] as const;
export type MadeType = (typeof MADE_TYPES)[number];

export interface Category {
  id: string;
  item_class_id: string;
  short_name: string | null;
  name: string | null;
  short_spec: string | null;
  made: MadeType | null;
  levy_id: string | null;
  commodity_id: string | null;
  blocked: boolean;
  created_at: string;
  updated_at: string;
}

export const categoryInput = z.object({
  item_class_id: z.string().uuid("Item Class is required"),
  short_name: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  short_spec: z.string().optional().nullable(),
  made: z.enum(MADE_TYPES).nullable().default(null),
  levy_id: z.string().uuid().nullable().default(null),
  commodity_id: z.string().uuid().nullable().default(null),
  blocked: z.boolean().default(false),
});
export type CategoryInput = z.infer<typeof categoryInput>;
