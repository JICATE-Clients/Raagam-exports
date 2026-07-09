import { z } from "zod";

// ============================================================================
// Commodities — header-only master (0230). Legacy EDP2 "Commodity" form:
// Short Name · Name · Item Class (req → config_lookups item_class) · Blocked.
// Promoted from the flat config_lookups kind 'commodity' because it carries an
// item_class FK the flat table can't hold.
// ============================================================================
export interface Commodity {
  id: string;
  item_class_id: string;
  short_name: string | null;
  name: string | null;
  blocked: boolean;
  created_at: string;
  updated_at: string;
}

export const commodityInput = z.object({
  item_class_id: z.string().uuid("Item Class is required"),
  short_name: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  blocked: z.boolean().default(false),
});
export type CommodityInput = z.infer<typeof commodityInput>;
