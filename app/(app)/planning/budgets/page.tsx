import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import {
  listBudgets,
  getCurrencies,
  getOrdersForPicker,
} from "@/lib/planning/budget-service";
import { fmtMoney, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { NewBudgetForm } from "./new-budget-form";
import type { Budget, BudgetStatus } from "@/lib/planning/types";
import type { StatusTone } from "@/components/ui/status-pill";

function budgetStatusTone(status: BudgetStatus): StatusTone {
  switch (status) {
    case "draft":
      return "neutral";
    case "submitted":
      return "warning";
    case "approved":
      return "success";
    case "rejected":
      return "danger";
  }
}

const BUDGET_STATUS_LABELS: Record<BudgetStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

const columns: Column<Budget>[] = [
  {
    header: "Code",
    cell: (row) => (
      <Link
        href={`/planning/budgets/${row.id}`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {row.code ?? "—"}
      </Link>
    ),
  },
  {
    header: "Name",
    cell: (row) => <span className="text-sm">{row.name}</span>,
  },
  {
    header: "Type",
    cell: (row) => (
      <StatusPill tone={row.is_grouped ? "info" : "neutral"}>
        {row.is_grouped ? "Grouped" : "Single"}
      </StatusPill>
    ),
  },
  {
    header: "Status",
    cell: (row) => (
      <StatusPill tone={budgetStatusTone(row.status)}>
        {BUDGET_STATUS_LABELS[row.status]}
      </StatusPill>
    ),
  },
  {
    header: "Total",
    align: "right",
    cell: (row) => (
      <span className="tabular-nums text-sm">
        {fmtMoney(row.total_amount, row.currency_code)}
      </span>
    ),
  },
  {
    header: "Created",
    cell: (row) => (
      <span className="tabular-nums text-sm">{fmtDate(row.created_at)}</span>
    ),
  },
];

export default async function BudgetsPage() {
  await requirePermission("planning", "view");

  const [budgets, currencies, orders] = await Promise.all([
    listBudgets(),
    getCurrencies(),
    getOrdersForPicker(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Budgets"
        description="Group orders, pull BOM lines, and approve cost budgets"
      />

      <NewBudgetForm currencies={currencies} orders={orders} />

      <DataTable
        columns={columns}
        rows={budgets}
        getKey={(row) => row.id}
        empty="No budgets yet. Use 'New budget' above to create your first."
      />
    </div>
  );
}
