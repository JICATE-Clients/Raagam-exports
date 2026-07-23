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
  /** Blank on create → the action auto-generates a unique code from the name
   *  (client 2026-07-23: don't ask users for a code). Edit passes the existing
   *  code through unchanged. */
  code: z.string().optional().default(""),
  name: z.string().min(1, "Name is required"),
  item_type: z.enum(PRINT_ITEM_TYPES).nullable().default(null),
  is_active: z.boolean().default(true),
});
export type PrintItemInput = z.infer<typeof printItemInput>;
