import type { Module } from "@/lib/auth/types";

/**
 * The record kinds "Search Everywhere" can return. Nav/action results are
 * produced separately on the client (see components/shell/nav-search.ts); this
 * enum only covers database records fetched via lib/search/service.ts.
 */
export type SearchEntity =
  | "customer"
  | "vendor"
  | "employee"
  | "product"
  | "order"
  | "invoice";

/** A single database-record hit, in the uniform shape the palette renders. */
export interface SearchResult {
  /** Entity kind — drives the group heading and icon in the palette. */
  type: SearchEntity;
  /** Row primary key (used for React keys and `?focus=` deep-linking). */
  id: string;
  /** Primary line, e.g. buyer name or order number. */
  title: string;
  /** Secondary line, e.g. "Customer · JB Fashions" or a code. */
  subtitle: string;
  /** Module the record belongs to — already permission-checked before return. */
  module: Module;
  /** Where selecting the result navigates to. */
  href: string;
}

/**
 * One searchable table. `searchEverywhere` iterates this registry, skipping any
 * entry the current user lacks `<module>:view` on, then runs a parallel ILIKE
 * query over `columns` and maps each row with `title`/`subtitle`/`buildHref`.
 *
 * `label` is the group heading shown in the palette. Multiple entries may share
 * a `type`/`label` (e.g. the three employee tables, the five invoice tables).
 */
export interface SearchEntityDef {
  type: SearchEntity;
  /** Group heading in the palette (e.g. "Customers", "Invoices"). */
  label: string;
  /** Supabase table name. */
  table: string;
  /** Module permission required to include this entity in results. */
  module: Module;
  /** Columns matched with case-insensitive `ilike` (OR'd together). */
  columns: string[];
  /** Extra columns to select for title/subtitle rendering. */
  select?: string[];
  title: (row: Record<string, unknown>) => string;
  subtitle: (row: Record<string, unknown>) => string;
  buildHref: (row: Record<string, unknown>) => string;
}

const str = (v: unknown): string => (v == null ? "" : String(v));

/** Prefer a human name, falling back to a code, falling back to a placeholder. */
const nameOrCode = (row: Record<string, unknown>, fallback: string): string =>
  str(row.name) || str(row.code) || fallback;

export const SEARCH_ENTITIES: SearchEntityDef[] = [
  {
    type: "customer",
    label: "Customers",
    table: "buyers",
    module: "masters",
    columns: ["name", "code", "contact_email", "contact_phone"],
    select: ["id", "name", "code", "country"],
    title: (r) => nameOrCode(r, "Customer"),
    subtitle: (r) =>
      [str(r.code), str(r.country)].filter(Boolean).join(" · ") || "Customer",
    buildHref: () => "/masters?tab=buyers",
  },
  {
    type: "vendor",
    label: "Vendors",
    table: "vendors",
    module: "materials_purchase",
    columns: ["name", "code", "email", "phone", "gst_number"],
    select: ["id", "name", "code", "vendor_type"],
    title: (r) => nameOrCode(r, "Vendor"),
    subtitle: (r) =>
      [str(r.code), str(r.vendor_type)].filter(Boolean).join(" · ") || "Vendor",
    buildHref: () => "/purchase/vendors",
  },
  {
    type: "employee",
    label: "Employees",
    table: "workers",
    module: "hr_payroll",
    columns: ["name", "code", "biometric_id"],
    select: ["id", "name", "code", "worker_type"],
    title: (r) => nameOrCode(r, "Worker"),
    subtitle: (r) =>
      [str(r.code), str(r.worker_type), "Worker"].filter(Boolean).join(" · "),
    buildHref: () => "/hr/workers",
  },
  {
    type: "employee",
    label: "Employees",
    table: "staff",
    module: "hr_payroll",
    columns: ["name", "code", "designation"],
    select: ["id", "name", "code", "designation"],
    title: (r) => nameOrCode(r, "Staff"),
    subtitle: (r) =>
      [str(r.code), str(r.designation), "Staff"].filter(Boolean).join(" · "),
    buildHref: () => "/hr/staff",
  },
  {
    type: "employee",
    label: "Employees",
    table: "contractors",
    module: "hr_payroll",
    columns: ["name", "code", "contact_person", "phone"],
    select: ["id", "name", "code", "contact_person"],
    title: (r) => nameOrCode(r, "Contractor"),
    subtitle: (r) =>
      [str(r.code), str(r.contact_person), "Contractor"]
        .filter(Boolean)
        .join(" · "),
    buildHref: () => "/hr/contractors",
  },
  {
    type: "product",
    label: "Products",
    table: "items",
    module: "masters",
    columns: ["name", "code", "category"],
    select: ["id", "name", "code", "category"],
    title: (r) => nameOrCode(r, "Item"),
    subtitle: (r) =>
      [str(r.code), str(r.category)].filter(Boolean).join(" · ") || "Product",
    buildHref: () => "/masters?tab=items",
  },
  {
    type: "order",
    label: "Orders",
    table: "sales_orders",
    module: "orders",
    columns: ["order_number"],
    select: ["id", "order_number", "status"],
    title: (r) => str(r.order_number) || "Order",
    subtitle: (r) => [str(r.status), "Sales order"].filter(Boolean).join(" · "),
    buildHref: (r) => `/orders/${str(r.id)}`,
  },
  {
    type: "invoice",
    label: "Invoices",
    table: "receivables",
    module: "finance",
    columns: ["code", "invoice_no"],
    select: ["id", "code", "invoice_no", "status"],
    title: (r) => str(r.invoice_no) || str(r.code) || "Receivable",
    subtitle: (r) =>
      [str(r.code), str(r.status), "Receivable (AR)"]
        .filter(Boolean)
        .join(" · "),
    buildHref: () => "/finance/receivables",
  },
  {
    type: "invoice",
    label: "Invoices",
    table: "payables",
    module: "finance",
    columns: ["code", "bill_no"],
    select: ["id", "code", "bill_no", "status"],
    title: (r) => str(r.bill_no) || str(r.code) || "Payable",
    subtitle: (r) =>
      [str(r.code), str(r.status), "Payable (AP)"].filter(Boolean).join(" · "),
    buildHref: () => "/finance/payables",
  },
  {
    type: "invoice",
    label: "Invoices",
    table: "proforma_invoices",
    module: "logistics",
    columns: ["code"],
    select: ["id", "code", "status"],
    title: (r) => str(r.code) || "Proforma",
    subtitle: (r) =>
      [str(r.status), "Proforma invoice"].filter(Boolean).join(" · "),
    buildHref: () => "/logistics/proforma",
  },
  {
    type: "invoice",
    label: "Invoices",
    table: "provisional_invoices",
    module: "finance",
    columns: ["code"],
    select: ["id", "code", "status"],
    title: (r) => str(r.code) || "Provisional",
    subtitle: (r) =>
      [str(r.status), "Provisional invoice"].filter(Boolean).join(" · "),
    buildHref: () => "/finance/provisional-invoices",
  },
  {
    type: "invoice",
    label: "Invoices",
    table: "domestic_garment_invoices",
    module: "finance",
    columns: ["code"],
    select: ["id", "code", "status"],
    title: (r) => str(r.code) || "Domestic invoice",
    subtitle: (r) =>
      [str(r.status), "Domestic invoice"].filter(Boolean).join(" · "),
    buildHref: () => "/finance/domestic-invoices",
  },
];
