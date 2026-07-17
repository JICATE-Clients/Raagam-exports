import { z } from "zod";

// ============================================================================
// Designation — HR master (0260). Legacy EDP2 "Designation" form: a flat master
// (Designation name · For [Staff/Worker/Staff-Worker] · Inactive) + is_draft.
// Distinct from the `designation` config_lookups kind used by contact pickers.
// ============================================================================

export const DESIGNATION_FOR = [
  { value: "staff", label: "Staff" },
  { value: "worker", label: "Worker" },
  { value: "staff_worker", label: "Staff/Worker" },
] as const;
export type DesignationFor = (typeof DESIGNATION_FOR)[number]["value"];

export function designationForLabel(v: string | null | undefined): string {
  return DESIGNATION_FOR.find((f) => f.value === v)?.label ?? "—";
}

export interface Designation {
  id: string;
  name: string;
  for_type: DesignationFor;
  inactive: boolean;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
}

export const designationInput = z.object({
  name: z.string().min(1, "Designation is required"),
  for_type: z.enum(["staff", "worker", "staff_worker"]).default("staff"),
  inactive: z.boolean().default(false),
  is_draft: z.boolean().default(false),
});
export type DesignationInput = z.infer<typeof designationInput>;
