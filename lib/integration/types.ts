import { z } from "zod";

export const EXPORT_TYPES = [
  "sales_invoices",
  "customer_orders",
  "purchase_orders",
  "supplier_payments",
  "all",
] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];

export const EXPORT_TYPE_LABELS: Record<ExportType, string> = {
  sales_invoices: "Sales Invoices",
  customer_orders: "Customer Orders",
  purchase_orders: "Purchase Orders",
  supplier_payments: "Supplier Payments",
  all: "All (combined)",
};

export interface TallyExport {
  id: string;
  code: string | null;
  export_type: ExportType;
  period_start: string | null;
  period_end: string | null;
  format: string;
  record_count: number;
  status: "generated" | "failed";
  error_message: string | null;
  xml_content: string | null;
  created_by: string | null;
  created_at: string;
}

export interface TallyExportItem {
  id: string;
  export_id: string;
  entity_type: string;
  entity_id: string;
  exported_at: string;
}

/** A pending item for the unified MD approval digest. */
export interface ApprovalItem {
  module: string; // sales | orders | planning | materials_purchase | hr_payroll
  label: string; // human description
  reference: string; // code / number
  href: string; // deep link
  amount?: number | null;
  created_at?: string | null;
}

/** A row in the daily crisis summary. */
export interface CrisisItem {
  kind: "overdue_milestone" | "overdue_po" | "pending_amendment" | "negative_stock";
  severity: "danger" | "warning";
  label: string;
  reference: string;
  href: string;
  date?: string | null;
}

export const tallyExportInput = z.object({
  export_type: z.enum(EXPORT_TYPES),
  period_start: z.string().optional().nullable(),
  period_end: z.string().optional().nullable(),
});
export type TallyExportInput = z.infer<typeof tallyExportInput>;
