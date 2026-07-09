import { z } from "zod";

// ============================================================================
// Department — HR master (0259). Legacy EDP2 "Department" form: a rich master,
// distinct from the `department` config_lookups kind used by the Employee /
// Consignee / Courier pickers. Header (Short Name · Name · Doc Prefix ·
// Warehouse · Blocked · Item-Class checklist) + a Location grid (Location +
// All Divisions).
// ============================================================================

// Same 6-value list the legacy Stock Unit form shows (STOCK_UNIT_ITEM_CLASSES).
export const DEPARTMENT_ITEM_CLASSES = [
  "Yarn",
  "Fabric",
  "Sewing",
  "Packing",
  "Garments",
  "General",
] as const;
export type DepartmentItemClass = (typeof DEPARTMENT_ITEM_CLASSES)[number];

export interface DepartmentLocation {
  id: string;
  sno: number;
  location_id: string | null;
  all_divisions: boolean;
}

export interface Department {
  id: string;
  short_name: string;
  name: string | null;
  doc_prefix: string | null;
  warehouse: boolean;
  blocked: boolean;
  item_classes: string[];
  locations: DepartmentLocation[];
  created_at: string;
  updated_at: string;
}

export const departmentLocationInput = z.object({
  sno: z.coerce.number().int().default(0),
  location_id: z.string().uuid().nullable().default(null),
  all_divisions: z.boolean().default(false),
});

export const departmentInput = z.object({
  short_name: z.string().min(1, "Short Name is required"),
  name: z.string().optional().nullable(),
  doc_prefix: z.string().optional().nullable(),
  warehouse: z.boolean().default(false),
  blocked: z.boolean().default(false),
  item_classes: z.array(z.enum(DEPARTMENT_ITEM_CLASSES)).default([]),
  locations: z.array(departmentLocationInput).default([]),
});
export type DepartmentInput = z.infer<typeof departmentInput>;
