import { z } from "zod";

/** Common departments that own T&A activities — offered as a datalist. */
export const TA_DEPARTMENTS = [
  "Merchandising",
  "Knitting",
  "Dyeing",
  "Fabric Store",
  "Cutting",
  "Sewing",
  "Finishing",
  "Packing",
  "QA",
];

export interface TaActivity {
  id: string;
  short_name: string;
  name: string;
  department: string | null;
  sequence: number;
  default_offset_days: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const taActivityInput = z.object({
  short_name: z.string().min(1, "Short name required"),
  name: z.string().min(1, "Name required"),
  department: z.string().optional().nullable(),
  sequence: z.coerce.number().int().nonnegative().default(0),
  default_offset_days: z.coerce.number().int().default(0),
  is_active: z.coerce.boolean().default(true),
});
export type TaActivityInput = z.infer<typeof taActivityInput>;
