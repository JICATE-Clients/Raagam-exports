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
import { commodityInput } from "@/lib/masters/commodity-types";
import { categoryInput } from "@/lib/masters/category-types";
import { compositionInput } from "@/lib/masters/composition-types";
import { processInput } from "@/lib/masters/process-types";
import { componentInput } from "@/lib/masters/component-types";
import { materialInput } from "@/lib/masters/material-types";
import { stockUnitInput } from "@/lib/masters/stock-unit-types";
import { lookupInput, attributeInput } from "@/lib/masters/extras-types";
import { levyInput } from "@/lib/masters/levy-types";
import { materialAttributeInput } from "@/lib/masters/material-attribute-types";
import { outDocumentTermInput } from "@/lib/masters/out-document-term-types";

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

  // ---- Master Data ▸ Materials ---------------------------------------
  {
    key: "commodities",
    label: "Commodities",
    table: "commodities",
    module: "masters",
    revalidate: ["/masters/materials/commodities"],
    schema: commodityInput,
    fields: [
      { key: "short_name", header: "Short Name", kind: "string" },
      { key: "name", header: "Name", kind: "string" },
    ],
  },
  {
    key: "categories",
    label: "Categories",
    table: "categories",
    module: "masters",
    revalidate: ["/masters/materials/categories"],
    schema: categoryInput,
    fields: [
      { key: "short_name", header: "Short Name", kind: "string" },
      { key: "name", header: "Name", kind: "string" },
      { key: "made", header: "Made", kind: "string" },
      IS_ACTIVE,
    ],
  },
  {
    key: "compositions",
    label: "Compositions",
    table: "compositions",
    module: "masters",
    revalidate: ["/masters/materials/compositions"],
    schema: compositionInput,
    fields: [
      { key: "short_name", header: "Short Name", kind: "string" },
      { key: "name", header: "Name", kind: "string" },
    ],
  },
  {
    key: "processes",
    label: "Processes",
    table: "processes",
    module: "masters",
    revalidate: ["/masters/materials/processes"],
    schema: processInput,
    fields: [
      { key: "name", header: "Name", kind: "string", required: true },
      { key: "short_description", header: "Short Description", kind: "string" },
      { key: "hsn_code", header: "HSN Code", kind: "string" },
    ],
  },
  {
    key: "components",
    label: "Components",
    table: "components",
    module: "masters",
    revalidate: ["/masters/materials/components"],
    schema: componentInput,
    fields: [
      { key: "short_name", header: "Short Name", kind: "string" },
      { key: "description", header: "Description", kind: "string" },
    ],
  },
  {
    key: "materials",
    label: "Materials",
    table: "items",
    module: "masters",
    revalidate: ["/masters/materials/materials"],
    schema: materialInput,
    fields: [
      { key: "code", header: "Code", kind: "string", required: true },
      { key: "name", header: "Name", kind: "string" },
    ],
  },
  {
    key: "stock-units",
    label: "Stock Units",
    table: "uoms",
    module: "masters",
    revalidate: ["/masters/materials/stock-units"],
    schema: stockUnitInput,
    fields: [
      { key: "code", header: "Code", kind: "string", required: true },
      { key: "name", header: "Name", kind: "string", required: true },
      { key: "description", header: "Description", kind: "string" },
    ],
  },
  {
    key: "gauges",
    label: "Gauges",
    table: "config_lookups",
    module: "masters",
    revalidate: ["/masters/materials/gauges"],
    schema: lookupInput,
    fields: [
      { key: "code", header: "Code", kind: "string" },
      { key: "name", header: "Name", kind: "string", required: true },
    ],
  },
  {
    key: "knitting-dias",
    label: "Knitting Dias",
    table: "config_lookups",
    module: "masters",
    revalidate: ["/masters/materials/knitting-dias"],
    schema: lookupInput,
    fields: [
      { key: "code", header: "Code", kind: "string" },
      { key: "name", header: "Name", kind: "string", required: true },
    ],
  },
  {
    key: "counts",
    label: "Counts",
    table: "config_lookups",
    module: "masters",
    revalidate: ["/masters/materials/counts"],
    schema: lookupInput,
    fields: [
      { key: "code", header: "Code", kind: "string" },
      { key: "name", header: "Name", kind: "string", required: true },
    ],
  },
  {
    key: "yarn-purities",
    label: "Yarn Purities",
    table: "config_lookups",
    module: "masters",
    revalidate: ["/masters/materials/yarn-purities"],
    schema: lookupInput,
    fields: [
      { key: "code", header: "Code", kind: "string" },
      { key: "name", header: "Name", kind: "string", required: true },
    ],
  },
  {
    key: "attributes",
    label: "Attributes",
    table: "config_lookups",
    module: "masters",
    revalidate: ["/masters/materials/attributes"],
    schema: attributeInput,
    fields: [
      { key: "code", header: "Code", kind: "string" },
      { key: "name", header: "Name", kind: "string", required: true },
    ],
  },
  {
    key: "levies",
    label: "Levies",
    table: "levies",
    module: "masters",
    revalidate: ["/masters/materials/levies"],
    schema: levyInput,
    fields: [
      { key: "type", header: "Type", kind: "string" },
      { key: "description", header: "Description", kind: "string" },
      { key: "effective_from", header: "Effective From", kind: "date" },
    ],
  },
  {
    key: "material-attributes",
    label: "Material Attributes",
    table: "material_attributes",
    module: "masters",
    revalidate: ["/masters/materials/material-attributes"],
    schema: materialAttributeInput,
    fields: [
      { key: "item_class_id", header: "Item Class Id", kind: "uuid" },
      { key: "category_id", header: "Category Id", kind: "uuid" },
    ],
  },
  {
    key: "out-document-terms",
    label: "Out Document Terms",
    table: "out_document_terms",
    module: "masters",
    revalidate: ["/masters/materials/out-document-terms"],
    schema: outDocumentTermInput,
    fields: [
      { key: "type", header: "Type", kind: "string" },
      { key: "entry_date", header: "Entry Date", kind: "date" },
      { key: "item_class_id", header: "Item Class Id", kind: "uuid" },
    ],
  },
];

/** Look up a descriptor by its `key`. */
export function getIoEntity(key: string): IoEntity | undefined {
  return IO_ENTITIES.find((e) => e.key === key);
}
