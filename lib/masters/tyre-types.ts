import { z } from "zod";

// ============================================================================
// Tyres — master (tyres).
// km_per_retread is required (>0) only when allowed_retreads > 0.
// ============================================================================
export interface Tyre {
  id: string;
  code: string;
  name: string;
  brand: string | null;
  tyre_type: string | null;
  size: string | null;
  allowed_retreads: number;
  retreads_done: number;
  km_per_retread: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const tyreInput = z
  .object({
    /** Blank on create → the action auto-generates a unique code from the name
     *  (client 2026-07-23: don't ask users for a code). Edit passes the existing
     *  code through unchanged. */
    code: z.string().optional().default(""),
    name: z.string().min(1, "Name is required"),
    brand: z.string().optional().nullable(),
    tyre_type: z.string().optional().nullable(),
    size: z.string().optional().nullable(),
    allowed_retreads: z.coerce.number().int().min(0, "Must be 0 or greater").default(0),
    retreads_done: z.coerce.number().int().min(0, "Must be 0 or greater").default(0),
    km_per_retread: z.coerce.number().min(0).nullable().default(null),
    is_active: z.boolean().default(true),
  })
  .superRefine((d, ctx) => {
    if (d.allowed_retreads > 0 && (!d.km_per_retread || d.km_per_retread <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["km_per_retread"],
        message: "KM per retread must be greater than 0 when retreads are allowed",
      });
    }
  });
export type TyreInput = z.infer<typeof tyreInput>;
