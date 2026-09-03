import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import {
  getFabricRequirementSheet,
  isFabricSheetRefusal,
} from "@/lib/orders/fabric-requirement/service";
import {
  fabricRequirementSheetRows,
  yarnSheetRows,
} from "@/lib/orders/fabric-requirement/sheet";
import { FabricRequirementSheetDocument } from "@/components/orders/fabric-requirement-sheet";
import { FabricRequirementToolbar } from "@/components/orders/fabric-requirement-toolbar";
import { fmtDateTime } from "@/lib/format";
import { Card, CardBody } from "@/components/ui/card";
import { OrderDocumentTabs } from "@/components/orders/order-document-tabs";

/**
 * THE FABRIC REQUIREMENT SHEET, at `/orders/<sales order id>/fabric-requirement`.
 *
 * The third document on the order, beside `/gos` and `/requirement`, and the
 * same URL shape on purpose: the floor asks for "the fabric sheet for
 * HO/RE/26-27/0009", so all three key on the RE Number rather than on the BOM
 * behind them. `getFabricRequirementSheet` picks the CURRENT Fabric BOM and
 * prints its code, so a sheet in a hand can be checked against what the system
 * holds.
 *
 * ## WHY IT IS NOT A SECTION OF THE ACCESSORIES SHEET
 *
 * `gos-sheet.tsx` already draws the line the other way — "accessories are on the
 * Accessories Requirement Sheet" — and the same argument separates these two.
 * They are read by DIFFERENT departments (knitting and dyeing here, trims
 * purchasing there), computed on different rules (fabric carries the rejection
 * allowance and trims do not), revised on different cycles, and signed
 * separately. One document carrying both would be reissued whenever either half
 * moved, and every reissue asks two departments to re-check a page only one of
 * them cares about.
 *
 * ## NO RELOAD GUARD
 *
 * Read-only, no form, no overlay — the same call `GosPage` and `RequirementPage`
 * record. Registering a guard here would permanently block the silent updater on
 * this route to protect nothing.
 */
export default async function FabricRequirementPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await requirePermission("orders", "view");
  const { orderId } = await params;
  const data = await getFabricRequirementSheet(orderId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <Link
            href={`/orders/${orderId}`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to order
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-medium">Fabric Requirement</span>
        </div>
        {!isFabricSheetRefusal(data) && (
          <FabricRequirementToolbar
            rows={fabricRequirementSheetRows(data.rows, data.names)}
            yarns={yarnSheetRows(data.yarns, data.names)}
            meta={{
              company: data.company.name ?? "RAAGAM EXPORTS",
              address: data.company.address,
              gstin: data.company.gstin,
              docNo: data.bom.code,
              customer: data.order.customer,
              scNo: data.order.scNo,
              orderNo: data.order.orderNo,
              computedAt: data.bom.computedAt ? fmtDateTime(data.bom.computedAt) : null,
            }}
          />
        )}
      </div>

      {/* THE SWITCHER ACROSS THE ORDER'S THREE DOCUMENTS (client 2026-09-02).
          Below the breadcrumb rather than inside it: the header row's job is
          "where am I / act on this page", and folding three links into it would
          push the toolbar buttons off the right on a narrow screen. It carries
          its own `print:hidden`. */}
      <OrderDocumentTabs orderId={orderId} current="fabric" />

      {isFabricSheetRefusal(data) ? (
        /*
         * A REFUSAL IS THE SENTENCE IT CARRIES, never an empty sheet. A blank
         * fabric requirement is indistinguishable from an order that genuinely
         * needs no cloth — which is not a state a garment order can be in — and
         * on paper there is nobody to disbelieve it. The same rule the engine
         * follows for a quantity, one layer out.
         *
         * IT IS REACHED, NOT AVOIDED. The row menu that opens this page no
         * longer greys itself out when the BOM is missing (client 2026-09-02),
         * so this card is now the whole explanation an operator gets — which is
         * why it names the screen to go to rather than only stating the fact.
         */
        <Card>
          <CardBody>
            <p className="text-sm font-medium">Nothing to print</p>
            <p className="mt-1 text-sm text-muted-foreground">{data.refused}</p>
            <Link
              href="/orders/fabric-bom"
              className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
            >
              Open Fabric BOM →
            </Link>
          </CardBody>
        </Card>
      ) : (
        <FabricRequirementSheetDocument data={data} />
      )}
    </div>
  );
}
