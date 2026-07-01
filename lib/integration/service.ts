import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ApprovalItem, CrisisItem, TallyExport } from "@/lib/integration/types";
import type {
  SalesInvoiceRow,
  CustomerOrderRow,
  PurchaseOrderRow,
  SupplierPaymentRow,
} from "@/lib/integration/tally";

// ---------- Local DB result shapes (not exported) ----------

interface DbAmendment {
  id: string;
  sales_order_id: string | null;
  amendment_type: string | null;
  profit_impact: number | null;
  created_at: string;
}
interface DbCostSheet {
  id: string;
  opportunity_id: string | null;
  version: number | null;
  computed_fob: number | null;
  created_at: string;
}
interface DbPendingPO {
  id: string;
  code: string | null;
  total_amount: number | null;
  created_at: string;
}
interface DbBudget {
  id: string;
  code: string | null;
  name: string | null;
  total_amount: number | null;
  created_at: string;
}
interface DbPayrollRun {
  id: string;
  code: string | null;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
}
interface DbMilestone {
  id: string;
  sales_order_id: string | null;
  name: string | null;
  planned_date: string | null;
}
interface DbCrisisPO {
  id: string;
  code: string | null;
  expected_date: string | null;
}
interface DbCrisisAmendment {
  id: string;
  sales_order_id: string | null;
  amendment_type: string | null;
  created_at: string;
}
interface DbStockBalance {
  store_id: string;
  item_id: string;
  quantity: number;
  items: { code: string | null; name: string | null } | null;
}
interface DbReceivable {
  id: string;
  invoice_no: string | null;
  invoice_date: string | null;
  amount_inr: number | null;
  buyers: { name: string } | null;
}
interface DbSalesOrder {
  id: string;
  order_number: string | null;
  created_at: string;
  total_value: number | null;
  buyers: { name: string } | null;
}
interface DbExportPO {
  id: string;
  code: string | null;
  order_date: string | null;
  total_amount: number | null;
  vendors: { name: string } | null;
}
interface DbPayablePayment {
  id: string;
  payment_date: string | null;
  amount: number | null;
  reference: string | null;
  payables: { vendors: { name: string } | null } | null;
}

export interface ExportRowsResult<T> {
  rows: T[];
  entityIds: { entity_type: string; entity_id: string }[];
}

// ---------- Approvals ----------

export async function getPendingApprovals(): Promise<ApprovalItem[]> {
  const supabase = await createClient();

  const [
    { data: amendments },
    { data: costSheets },
    { data: pos },
    { data: budgets },
    { data: payrolls },
  ] = await Promise.all([
    supabase
      .from("order_amendments")
      .select("id, sales_order_id, amendment_type, profit_impact, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    supabase
      .from("cost_sheets")
      .select("id, opportunity_id, version, computed_fob, created_at")
      .eq("status", "submitted")
      .order("created_at", { ascending: false }),
    supabase
      .from("purchase_orders")
      .select("id, code, total_amount, created_at")
      .eq("status", "pending_approval")
      .order("created_at", { ascending: false }),
    supabase
      .from("budgets")
      .select("id, code, name, total_amount, created_at")
      .eq("status", "submitted")
      .order("created_at", { ascending: false }),
    supabase
      .from("payroll_runs")
      .select("id, code, period_start, period_end, created_at")
      .eq("status", "calculated")
      .order("created_at", { ascending: false }),
  ]);

  const amendmentItems = ((amendments ?? []) as DbAmendment[]).map(
    (a): ApprovalItem => ({
      module: "orders",
      label: "Order Amendment",
      reference: a.amendment_type ?? a.id,
      href: `/orders/${a.sales_order_id ?? a.id}`,
      amount: a.profit_impact ?? null,
      created_at: a.created_at,
    })
  );

  const costSheetItems = ((costSheets ?? []) as DbCostSheet[]).map(
    (c): ApprovalItem => ({
      module: "sales",
      label: "Cost Sheet",
      reference: c.version != null ? `v${c.version}` : c.id,
      href: `/sales/${c.opportunity_id ?? c.id}`,
      amount: c.computed_fob ?? null,
      created_at: c.created_at,
    })
  );

  const poItems = ((pos ?? []) as DbPendingPO[]).map(
    (p): ApprovalItem => ({
      module: "materials_purchase",
      label: "Purchase Order",
      reference: p.code ?? p.id,
      href: `/purchase/orders/${p.id}`,
      amount: p.total_amount ?? null,
      created_at: p.created_at,
    })
  );

  const budgetItems = ((budgets ?? []) as DbBudget[]).map(
    (b): ApprovalItem => ({
      module: "planning",
      label: "Budget",
      reference: b.code ?? b.name ?? b.id,
      href: `/planning/budgets/${b.id}`,
      amount: b.total_amount ?? null,
      created_at: b.created_at,
    })
  );

  const payrollItems = ((payrolls ?? []) as DbPayrollRun[]).map(
    (r): ApprovalItem => ({
      module: "hr_payroll",
      label: "Payroll Run",
      reference: r.code ?? r.id,
      href: `/hr/payroll/${r.id}`,
      amount: null,
      created_at: r.created_at,
    })
  );

  return [
    ...amendmentItems,
    ...costSheetItems,
    ...poItems,
    ...budgetItems,
    ...payrollItems,
  ];
}

// ---------- Crisis ----------

export async function getCrisisItems(): Promise<CrisisItem[]> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const [
    { data: milestones },
    { data: overduePOs },
    { data: amendments },
    { data: negStock },
  ] = await Promise.all([
    supabase
      .from("ta_milestones")
      .select("id, sales_order_id, name, planned_date")
      .lt("planned_date", today)
      .neq("status", "done")
      .order("planned_date", { ascending: true }),
    supabase
      .from("purchase_orders")
      .select("id, code, expected_date")
      .lt("expected_date", today)
      .in("status", ["approved", "partially_received"])
      .order("expected_date", { ascending: true }),
    supabase
      .from("order_amendments")
      .select("id, sales_order_id, amendment_type, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    supabase
      .from("stock_balances")
      .select("store_id, item_id, quantity, items!item_id(code, name)")
      .lt("quantity", 0),
  ]);

  const milestoneItems = ((milestones ?? []) as DbMilestone[]).map(
    (m): CrisisItem => ({
      kind: "overdue_milestone",
      severity: "danger",
      label: `Overdue T&A: ${m.name ?? "Milestone"}`,
      reference: m.name ?? m.id,
      href: `/orders/${m.sales_order_id ?? m.id}`,
      date: m.planned_date,
    })
  );

  const overduePoItems = ((overduePOs ?? []) as DbCrisisPO[]).map(
    (p): CrisisItem => ({
      kind: "overdue_po",
      severity: "warning",
      label: "Overdue Purchase Order",
      reference: p.code ?? p.id,
      href: `/purchase/orders/${p.id}`,
      date: p.expected_date,
    })
  );

  const amendmentItems = ((amendments ?? []) as DbCrisisAmendment[]).map(
    (a): CrisisItem => ({
      kind: "pending_amendment",
      severity: "warning",
      label: "Pending Amendment",
      reference: a.amendment_type ?? a.id,
      href: `/orders/${a.sales_order_id ?? a.id}`,
      date: a.created_at,
    })
  );

  const stockItems = ((negStock ?? []) as unknown as DbStockBalance[]).map(
    (s): CrisisItem => ({
      kind: "negative_stock",
      severity: "danger",
      label: `Negative Stock: ${s.items?.name ?? s.item_id}`,
      reference: s.items?.code ?? s.item_id,
      href: `/stores`,
      date: null,
    })
  );

  return [...milestoneItems, ...overduePoItems, ...amendmentItems, ...stockItems];
}

// ---------- Exports ----------

export async function listExports(): Promise<TallyExport[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tally_exports")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []) as TallyExport[];
}

export async function getExport(
  id: string
): Promise<(TallyExport & { item_count: number }) | null> {
  const supabase = await createClient();
  const [{ data: exp }, { count }] = await Promise.all([
    supabase.from("tally_exports").select("*").eq("id", id).single(),
    supabase
      .from("tally_export_items")
      .select("id", { count: "exact", head: true })
      .eq("export_id", id),
  ]);
  if (!exp) return null;
  return { ...(exp as TallyExport), item_count: count ?? 0 };
}

// ---------- Export row fetchers ----------

export async function getSalesInvoiceRows(
  periodStart: string | null,
  periodEnd: string | null
): Promise<ExportRowsResult<SalesInvoiceRow>> {
  const supabase = await createClient();
  let query = supabase
    .from("receivables")
    .select("id, invoice_no, invoice_date, amount_inr, buyers(name)")
    .order("invoice_date", { ascending: true });
  if (periodStart) query = query.gte("invoice_date", periodStart);
  if (periodEnd) query = query.lte("invoice_date", periodEnd);
  const { data } = await query;
  const rows: SalesInvoiceRow[] = ((data ?? []) as unknown as DbReceivable[]).map((r) => ({
    date: r.invoice_date,
    voucherNumber: r.invoice_no,
    party: r.buyers?.name ?? "Unknown",
    amount: r.amount_inr ?? 0,
  }));
  const entityIds = ((data ?? []) as unknown as DbReceivable[]).map((r) => ({
    entity_type: "receivable",
    entity_id: r.id,
  }));
  return { rows, entityIds };
}

export async function getCustomerOrderRows(
  periodStart: string | null,
  periodEnd: string | null
): Promise<ExportRowsResult<CustomerOrderRow>> {
  const supabase = await createClient();
  let query = supabase
    .from("sales_orders")
    .select("id, order_number, created_at, total_value, buyers(name)")
    .order("created_at", { ascending: true });
  if (periodStart) query = query.gte("created_at", periodStart);
  if (periodEnd) query = query.lte("created_at", periodEnd);
  const { data } = await query;
  const rows: CustomerOrderRow[] = ((data ?? []) as unknown as DbSalesOrder[]).map((r) => ({
    date: r.created_at.slice(0, 10),
    voucherNumber: r.order_number,
    party: r.buyers?.name ?? "Unknown",
    amount: r.total_value ?? 0,
  }));
  const entityIds = ((data ?? []) as unknown as DbSalesOrder[]).map((r) => ({
    entity_type: "sales_order",
    entity_id: r.id,
  }));
  return { rows, entityIds };
}

export async function getPurchaseOrderRows(
  periodStart: string | null,
  periodEnd: string | null
): Promise<ExportRowsResult<PurchaseOrderRow>> {
  const supabase = await createClient();
  let query = supabase
    .from("purchase_orders")
    .select("id, code, order_date, total_amount, vendors(name)")
    .order("order_date", { ascending: true });
  if (periodStart) query = query.gte("order_date", periodStart);
  if (periodEnd) query = query.lte("order_date", periodEnd);
  const { data } = await query;
  const rows: PurchaseOrderRow[] = ((data ?? []) as unknown as DbExportPO[]).map((r) => ({
    date: r.order_date,
    voucherNumber: r.code,
    party: r.vendors?.name ?? "Unknown",
    amount: r.total_amount ?? 0,
  }));
  const entityIds = ((data ?? []) as unknown as DbExportPO[]).map((r) => ({
    entity_type: "purchase_order",
    entity_id: r.id,
  }));
  return { rows, entityIds };
}

export async function getSupplierPaymentRows(
  periodStart: string | null,
  periodEnd: string | null
): Promise<ExportRowsResult<SupplierPaymentRow>> {
  const supabase = await createClient();
  let query = supabase
    .from("payable_payments")
    .select("id, payment_date, amount, reference, payables(vendors(name))")
    .order("payment_date", { ascending: true });
  if (periodStart) query = query.gte("payment_date", periodStart);
  if (periodEnd) query = query.lte("payment_date", periodEnd);
  const { data } = await query;
  const rows: SupplierPaymentRow[] = ((data ?? []) as unknown as DbPayablePayment[]).map((r) => ({
    date: r.payment_date,
    voucherNumber: r.reference,
    party: r.payables?.vendors?.name ?? "Unknown",
    amount: r.amount ?? 0,
  }));
  const entityIds = ((data ?? []) as unknown as DbPayablePayment[]).map((r) => ({
    entity_type: "payable_payment",
    entity_id: r.id,
  }));
  return { rows, entityIds };
}
