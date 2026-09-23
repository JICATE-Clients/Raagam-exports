import Link from "next/link";
import { VFinalBanner } from "@/components/orders/v-final-banner";
import { vFinalFor } from "@/lib/orders/amendments/v-final";
import { requirePermission } from "@/lib/auth/server";
import { getOrderBudgetReport } from "@/lib/orders/budget/report";
import { OrderBudgetReportView } from "@/components/orders/order-budget-report";
import { Card, CardBody } from "@/components/ui/card";
import { OrderDocumentTabs } from "@/components/orders/order-document-tabs";

/**
 * THE ORDER BUDGET & PROFIT MARGIN REPORT, at `/orders/<sales order id>/budget`
 * (client 2026-09-23) — the fifth of Order Entry's reports, keyed on the RE
 * Number like `/gos` and `/fabric-requirement`.
 *
 * V_FINAL (0619, spec §4B): while the RE is amending, the budget as approved
 * prints by default — frozen at raise — and `?version=proposed` shows the
 * revised one, with its Approved vs Proposed comparison. The frozen copy hides
 * that comparison: it was captured when approved and proposed were one budget.
 *
 * NO RELOAD GUARD — read-only, no form, no overlay; the call every sibling
 * document page records.
 */
export default async function OrderBudgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  /** `?version=proposed` — the amendment's in-flight data instead of V_final (0619). */
  searchParams: Promise<{ version?: string }>;
}) {
  await requirePermission("orders", "view");
  const [{ orderId }, { version }] = await Promise.all([params, searchParams]);
  const vf = await vFinalFor("order-budget", orderId);
  const proposed = version === "proposed";
  const frozen = vf.state === "frozen" && !proposed;
  const data = frozen ? vf.payload : await getOrderBudgetReport(orderId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link href={`/orders/${orderId}`} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to order
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-medium">Order Budget</span>
      </div>

      <OrderDocumentTabs orderId={orderId} current="budget" />

      <VFinalBanner
        state={vf}
        proposed={proposed}
        hrefApproved={`/orders/${orderId}/budget`}
        hrefProposed={`/orders/${orderId}/budget?version=proposed`}
      />

      {"refused" in data ? (
        /* A REFUSAL IS ITS SENTENCE, never an empty budget — a blank one reads
           as "this order costs nothing". Names the screen that would fix it. */
        <Card>
          <CardBody>
            <p className="text-sm font-medium">Nothing to print</p>
            <p className="mt-1 text-sm text-muted-foreground">{data.refused}</p>
            <Link href="/orders/budgets" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
              Open Budgeting →
            </Link>
          </CardBody>
        </Card>
      ) : (
        <div className="rounded-md bg-[#f1f3f5] p-4">
          <OrderBudgetReportView data={data} showAmendment={!frozen} />
        </div>
      )}
    </div>
  );
}
