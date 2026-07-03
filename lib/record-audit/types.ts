export type AuditOperation = "INSERT" | "UPDATE" | "DELETE";

/** A row from public.record_audit (a single record change). */
export interface RecordAudit {
  id: string;
  table_name: string;
  record_id: string | null;
  operation: AuditOperation;
  actor_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_fields: string[] | null;
  created_at: string;
}

/** Enriched with the actor's display name (joined from profiles). */
export interface RecordAuditRow extends RecordAudit {
  actor_name: string | null;
  actor_email: string | null;
}

export interface AuditFilters {
  table?: string;
  operation?: AuditOperation;
  actorId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/** The tables the DB trigger audits → friendly labels for filters/display. */
export const TABLE_LABELS: Record<string, string> = {
  opportunities: "Opportunities",
  quotes: "Quotes",
  sales_orders: "Sales Orders",
  order_amendments: "Order Amendments",
  budgets: "Budgets",
  purchase_orders: "Purchase Orders",
  grns: "Goods Receipts",
  purchase_indents: "Indents",
  payables: "Payables",
  receivables: "Receivables",
  journal_entries: "Journal Entries",
  shipments: "Shipments",
  proforma_invoices: "Proforma Invoices",
  workers: "Workers",
  payroll_runs: "Payroll Runs",
  production_job_orders: "Job Orders",
  process_jobs: "Process Jobs",
  buyers: "Buyers",
  items: "Items",
};

export function tableLabel(name: string): string {
  return TABLE_LABELS[name] ?? name;
}
