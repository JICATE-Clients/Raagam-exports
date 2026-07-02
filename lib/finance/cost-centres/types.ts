import { z } from "zod";

export interface CostCentreGroup {
  id: string;
  code: string | null;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CostCentre {
  id: string;
  code: string | null;
  name: string;
  group_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const groupInput = z.object({
  code: z.string().optional().nullable(),
  name: z.string().min(1, "Name required"),
  is_active: z.coerce.boolean().default(true),
});
export type GroupInput = z.infer<typeof groupInput>;

export const centreInput = z.object({
  code: z.string().optional().nullable(),
  name: z.string().min(1, "Name required"),
  group_id: z.string().uuid().optional().nullable(),
  is_active: z.coerce.boolean().default(true),
});
export type CentreInput = z.infer<typeof centreInput>;
