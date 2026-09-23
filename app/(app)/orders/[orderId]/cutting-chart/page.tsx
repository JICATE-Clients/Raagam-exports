import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { Card, CardBody } from "@/components/ui/card";
import { OrderDocumentTabs } from "@/components/orders/order-document-tabs";
import { VFinalBanner } from "@/components/orders/v-final-banner";
import { CuttingChartDocument } from "@/components/orders/cutting-chart-document";
import { vFinalFor } from "@/lib/orders/amendments/v-final";
import { getCuttingChart } from "@/lib/orders/cutting-chart/service";

/**
 * THE CUTTING CHART, at `/orders/<sales order id>/cutting-chart` (client
 * 2026-09-23, the legacy RP printout). Keyed on the RE Number like its
 * siblings `/gos` and `/fabric-requirement`, so "the cutting chart for
 * HO/RE/26-27/0001" is one URL.
 *
 * V_FINAL (0619, spec §4B): while the order is amending, the cutting table
 * works from the approved quantities — `?version=proposed` shows the
 * amendment's in-flight figures under the banner.
 *
 * NO RELOAD GUARD — read-only, no form, no overlay; the call every sibling
 * document page records.
 */
export default async function CuttingChartPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  /** `?version=proposed` — the amendment's in-flight data instead of V_final (0619). */
  searchParams: Promise<{ version?: string }>;
}) {
  await requirePermission("orders", "view");
  const [{ orderId }, { version }] = await Promise.all([params, searchParams]);
  const vf = await vFinalFor("cutting-chart", orderId);
  const proposed = version === "proposed";
  const data = vf.state === "frozen" && !proposed ? vf.payload : await getCuttingChart(orderId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link href={`/orders/${orderId}`} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to order
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-medium">Cutting Chart</span>
      </div>

      <OrderDocumentTabs orderId={orderId} current="cutting-chart" />

      <VFinalBanner
        state={vf}
        proposed={proposed}
        hrefApproved={`/orders/${orderId}/cutting-chart`}
        hrefProposed={`/orders/${orderId}/cutting-chart?version=proposed`}
      />

      {"refused" in data ? (
        /* A REFUSAL IS THE SENTENCE IT CARRIES, never an empty chart — a blank
           cutting chart reads as "nothing to cut". It names the screen that
           would fix it: every refusal here is about the order's Approval Qty
           or its Garment Rejection Rule, both on Order Entry. */
        <Card>
          <CardBody>
            <p className="text-sm font-medium">Nothing to print</p>
            <p className="mt-1 text-sm text-muted-foreground">{data.refused}</p>
            <Link href="/orders/garment-orders" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
              Open Order Entry →
            </Link>
          </CardBody>
        </Card>
      ) : (
        <div className="rounded-md bg-[#f1f3f5] p-4">
          <CuttingChartDocument chart={data} />
        </div>
      )}
    </div>
  );
}
