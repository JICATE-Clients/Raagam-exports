import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { getAmendmentHead } from "@/lib/orders/order-amendments/service";
import { AmendmentTabHeader } from "@/components/orders/amendment-tabs";
import { getBudgetFormData, listOrderBudgets } from "@/lib/orders/budget/service";
import { BudgetScreen } from "../../../budgets/budget-screen";

/**
 * THE AMENDMENT'S BUDGET TAB (2026-09-23) — the budget editor, embedded on the
 * budget this amendment revises. Always visited: the missing rates are filled
 * here (`?line=&field=` lands on the exact cell, Manual Entry Needed), and
 * Order Budget decides only which of its cells are open.
 */
export default async function AmendmentBudgetTab({
  params,
  searchParams,
}: {
  params: Promise<{ entryId: string }>;
  searchParams: Promise<{ line?: string; field?: string }>;
}) {
  await requirePermission("orders", "view");
  const [{ entryId }, { line, field }] = await Promise.all([params, searchParams]);
  const head = await getAmendmentHead(entryId);
  if (!head || !head.budget_id) notFound();
  const [budgets, data, canCreate, canEdit, canDelete, mCreate, mEdit, canApprove] = await Promise.all([
    listOrderBudgets(),
    getBudgetFormData(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
    can("masters", "create"),
    can("masters", "edit"),
    can("orders", "approve"),
  ]);
  return (
    <div className="space-y-3">
      <AmendmentTabHeader head={head} current="budget" />
      <BudgetScreen
        budgets={budgets}
        data={data}
        perms={{ canCreate, canEdit, canDelete, canApprove }}
        masterPerms={{ canCreate: mCreate, canEdit: mEdit }}
        openLine={line ?? null}
        openField={field ?? null}
        embed={{ id: head.budget_id, returnHref: `/orders/order-amendments/${entryId}` }}
      />
    </div>
  );
}
