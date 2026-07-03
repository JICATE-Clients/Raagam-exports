import type { ZodTypeAny } from "zod";
import type { Module } from "@/lib/auth/types";
import { buyerInput, itemInput, uomInput } from "@/lib/masters/types";
import { vendorInput, VENDOR_TYPES } from "@/lib/purchase/types";
import {
  workerInput,
  staffInput,
  contractorInput,
  WORKER_TYPES,
} from "@/lib/hr/types";

/**
 * Data Import/Export engine — one descriptor per importable/exportable entity.
 *
 * A descriptor is the single source of truth for: the Excel/CSV column layout
 * (import template + export headers), how each cell is coerced+validated (via
 * `kind` + the reused Zod `schema`), which table/module/permission it maps to,
 * and whether re-import upserts on a user-supplied `code` or inserts fresh.
 */

export type FieldKind =
  | "string"
  | "number"
  | "boolean"
  | "uuid"
  | "date"
  | "enum";

export interface IoField {
  /** DB column name (also the object key after coercion). */
  key: string;
  /** Spreadsheet column header. */
  header: string;
  kind: FieldKind;
  /** Shown in the template so users know which columns must be filled. */
  required?: boolean;
  /** Allowed values for `kind: "enum"`. */
  enumValues?: readonly string[];
}

export interface IoEntity {
  /** URL-safe id used by the toolbar + server actions (e.g. "buyers"). */
  key: string;
  /** Human label ("Customers"). */
  label: string;
  /** Supabase table. */
  table: string;
  /** Module permission root — note `materials_purchase`/`hr_payroll`, not purchase/hr. */
  module: Module;
  /** Paths to `revalidatePath` after a bulk write. */
  revalidate: string[];
  /** Reused create-form Zod schema — the authoritative row validator. */
  schema: ZodTypeAny;
  /** Column map driving template, parse and export. */
  fields: IoField[];
  /**
   * Unique column to upsert on (only where the user supplies `code`).
   * Omit ⇒ insert-only (entities whose `code` is DB-generated, e.g. vendors).
   */
  upsertConflict?: string;
}

const IS_ACTIVE: IoField = { key: "is_active", header: "Active", kind: "boolean" };

export const IO_ENTITIES: IoEntity[] = [
  {
    key: "buyers",
    label: "Customers",
    table: "buyers",
    module: "masters",
    revalidate: ["/masters"],
    schema: buyerInput,
    upsertConflict: "code",
    fields: [
      { key: "code", header: "Code", kind: "string", required: true },
      { key: "name", header: "Name", kind: "string", required: true },
      { key: "country", header: "Country", kind: "string" },
      { key: "currency_code", header: "Currency", kind: "string" },
      { key: "contact_email", header: "Email", kind: "string" },
      { key: "contact_phone", header: "Phone", kind: "string" },
      { key: "address", header: "Address", kind: "string" },
      IS_ACTIVE,
    ],
  },
  {
    key: "items",
    label: "Products",
    table: "items",
    module: "masters",
    revalidate: ["/masters"],
    schema: itemInput,
    upsertConflict: "code",
    fields: [
      { key: "code", header: "Code", kind: "string", required: true },
      { key: "name", header: "Name", kind: "string", required: true },
      { key: "category", header: "Category", kind: "string" },
      { key: "uom_id", header: "UOM Id", kind: "uuid" },
      IS_ACTIVE,
    ],
  },
  {
    key: "uoms",
    label: "Units of Measure",
    table: "uoms",
    module: "masters",
    revalidate: ["/masters"],
    schema: uomInput,
    upsertConflict: "code",
    fields: [
      { key: "code", header: "Code", kind: "string", required: true },
      { key: "name", header: "Name", kind: "string", required: true },
      IS_ACTIVE,
    ],
  },
  {
    key: "vendors",
    label: "Vendors",
    table: "vendors",
    module: "materials_purchase",
    revalidate: ["/purchase/vendors"],
    schema: vendorInput,
    // Vendor `code` is DB-generated → insert-only (no upsert key).
    fields: [
      { key: "name", header: "Name", kind: "string", required: true },
      {
        key: "vendor_type",
        header: "Type",
        kind: "enum",
        enumValues: VENDOR_TYPES,
      },
      { key: "contact_person", header: "Contact Person", kind: "string" },
      { key: "email", header: "Email", kind: "string" },
      { key: "phone", header: "Phone", kind: "string" },
      { key: "gst_number", header: "GST Number", kind: "string" },
      { key: "address", header: "Address", kind: "string" },
      IS_ACTIVE,
    ],
  },
  {
    key: "workers",
    label: "Workers",
    table: "workers",
    module: "hr_payroll",
    revalidate: ["/hr/workers"],
    schema: workerInput,
    fields: [
      { key: "name", header: "Name", kind: "string", required: true },
      {
        key: "worker_type",
        header: "Worker Type",
        kind: "enum",
        required: true,
        enumValues: WORKER_TYPES,
      },
      { key: "biometric_id", header: "Biometric Id", kind: "string" },
      { key: "shift_wage_per_day", header: "Shift Wage/Day", kind: "number" },
      { key: "hourly_wage", header: "Hourly Wage", kind: "number" },
      { key: "piece_rate", header: "Piece Rate", kind: "number" },
      { key: "esi_applicable", header: "ESI Applicable", kind: "boolean" },
      { key: "pf_applicable", header: "PF Applicable", kind: "boolean" },
      { key: "joined_date", header: "Joined Date", kind: "date" },
      IS_ACTIVE,
    ],
  },
  {
    key: "staff",
    label: "Staff",
    table: "staff",
    module: "hr_payroll",
    revalidate: ["/hr/staff"],
    schema: staffInput,
    fields: [
      { key: "name", header: "Name", kind: "string", required: true },
      { key: "designation", header: "Designation", kind: "string" },
      { key: "monthly_salary", header: "Monthly Salary", kind: "number" },
      { key: "esi_applicable", header: "ESI Applicable", kind: "boolean" },
      { key: "pf_applicable", header: "PF Applicable", kind: "boolean" },
      { key: "joined_date", header: "Joined Date", kind: "date" },
      IS_ACTIVE,
    ],
  },
  {
    key: "contractors",
    label: "Contractors",
    table: "contractors",
    module: "hr_payroll",
    revalidate: ["/hr/contractors"],
    schema: contractorInput,
    fields: [
      { key: "name", header: "Name", kind: "string", required: true },
      { key: "contact_person", header: "Contact Person", kind: "string" },
      { key: "phone", header: "Phone", kind: "string" },
      IS_ACTIVE,
    ],
  },
];

/** Look up a descriptor by its `key`. */
export function getIoEntity(key: string): IoEntity | undefined {
  return IO_ENTITIES.find((e) => e.key === key);
}
