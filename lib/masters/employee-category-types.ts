import { z } from "zod";

// ============================================================================
// Employee Category — HR master (0262). Legacy EDP2 "Employee category" form: a
// flat master (Short Name · Name · For [Staff/Worker/Staff-Worker] · Inactive) +
// is_draft. The twin of Designation (0260) with an extra Short Name column.
// Distinct from the `employee_category` config_lookups kind used by the Employee
// master's Category picker.
// ============================================================================

export const EMPLOYEE_CATEGORY_FOR = [
  { value: "staff", label: "Staff" },
  { value: "worker", label: "Worker" },
  { value: "staff_worker", label: "Staff/Worker" },
] as const;
export type EmployeeCategoryFor = (typeof EMPLOYEE_CATEGORY_FOR)[number]["value"];

export function employeeCategoryForLabel(v: string | null | undefined): string {
  return EMPLOYEE_CATEGORY_FOR.find((f) => f.value === v)?.label ?? "—";
}

export interface EmployeeCategory {
  id: string;
  short_name: string | null;
  name: string;
  for_type: EmployeeCategoryFor;
  inactive: boolean;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
}

export const employeeCategoryInput = z.object({
  short_name: z.string().optional().nullable(),
  name: z.string().min(1, "Name is required"),
  for_type: z.enum(["staff", "worker", "staff_worker"]).default("staff"),
  inactive: z.boolean().default(false),
  is_draft: z.boolean().default(false),
});
export type EmployeeCategoryInput = z.infer<typeof employeeCategoryInput>;
