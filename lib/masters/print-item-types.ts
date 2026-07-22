import { z } from "zod";

// ============================================================================
// Print Items — master (print_items).
// item_type: A=All, Y=Yarn, F=Fabric.
// ============================================================================
export const PRINT_ITEM_TYPES = ["A", "Y", "F"] as const;
export type PrintItemType = (typeof PRINT_ITEM_TYPES)[number];

export const PRINT_ITEM_TYPE_LABELS: Record<PrintItemType, string> = {
  A: "All",
  Y: "Yarn",
  F: "Fabric",
};

export interface PrintItem {
  id: string;
  code: string;
  name: string;
  item_type: PrintItemType | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const printItemInput = z.object({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  item_type: z.enum(PRINT_ITEM_TYPES).nullable().default(null),
  is_active: z.boolean().default(true),
});
export type PrintItemInput = z.infer<typeof printItemInput>;
