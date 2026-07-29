import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { listBudgets } from "@/lib/planning/budget-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import type { BudgetRow } from "@/lib/planning/budget-service";
import type { BudgetStatus, BudgetType } from "@/lib/planning/budget-types";
import { BUDGET_TYPE_LABELS } from "@/lib/planning/budget-types";

const BUDGET_STATUS_LABELS: Record<BudgetStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

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

const columns: Column<BudgetRow>[] = [
  {
    header: "Code",
    cell: (r) => (
      <Link
        href={`/planning/budgets/${r.id}`}
        className="font-mono text-xs font-medium text-primary hover:underline"
      >
        {r.code ?? "--"}
      </Link>
    ),
  },
  {
    header: "Type",
    cell: (r) => (
      <span className="text-sm">
        {BUDGET_TYPE_LABELS[r.budget_type as BudgetType] ?? r.budget_type}
      </span>
    ),
  },
  {
    header: "Customer",
    cell: (r) => <span className="text-sm">{r.customer_name ?? "--"}</span>,
  },
  {
    header: "Group",
    cell: (r) => <span className="text-sm">{r.group_no ?? "--"}</span>,
  },
  {
    header: "Status",
    cell: (r) => (
      <StatusPill tone={budgetStatusTone(r.status)}>
        {BUDGET_STATUS_LABELS[r.status]}
      </StatusPill>
    ),
  },
  {
    header: "Date",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtDate(r.created_at)}</span>
    ),
  },
];

export default async function BudgetsPage() {
  await requirePermission("planning", "view");

  const [budgets, canCreate] = await Promise.all([
    listBudgets(),
    can("planning", "create"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Budgets"
        description="SQ / PPM Budget costing documents."
        actions={
          canCreate ? (
            <Link
              href="/planning/budgets/new"
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
            >
              New
            </Link>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        rows={budgets}
        getKey={(r) => r.id}
        empty="No budgets yet."
      />
    </div>
  );
}
