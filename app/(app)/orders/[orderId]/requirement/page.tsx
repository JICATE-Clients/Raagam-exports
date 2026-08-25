import Link from "next/link";
import { requirePermission } from "@/lib/auth/server";
import { getRequirementSheet, isSheetRefusal } from "@/lib/orders/requirement/service";
import { requirementRows } from "@/lib/orders/requirement/sheet";
import { RequirementSheetDocument } from "@/components/orders/requirement-sheet";
import { RequirementToolbar } from "@/components/orders/requirement-toolbar";
import { fmtDateTime } from "@/lib/format";
import { Card, CardBody } from "@/components/ui/card";

/**
 * THE ACCESSORIES REQUIREMENT SHEET, at `/orders/<sales order id>/requirement`.
 *
 * The companion to `/orders/<id>/gos`, and the same URL shape on purpose: the
 * floor asks for "the sheet for HO/RE/26-27/0009", so both documents key on the
 * RE Number rather than on the amendment behind it. `getRequirementSheet` picks
 * the CURRENT Material BOM and prints its code, so a sheet in a hand can be
 * checked against what the system holds.
 *
 * ## WHY THE REQUIREMENT IS NOT ON THE ORDER SHEET
 *
 * `gos-sheet.tsx` says it in its own words — "accessories are on the Accessories
 * Requirement Sheet". The Order Sheet is a construction directive: styles,
 * structures, components. This is a purchase directive, read by a different
 * department, revised on a different cycle, and signed separately. One document
 * carrying both would be revised whenever either half moved.
 *
 * ## NO RELOAD GUARD
 *
 * Read-only, no form, no overlay — the same call `GosPage` records. Registering
 * a guard here would permanently block the silent updater on this route to
 * protect nothing.
 */
export default async function RequirementPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await requirePermission("orders", "view");
  const { orderId } = await params;
  const data = await getRequirementSheet(orderId);

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
          <span className="text-sm font-medium">Accessories Requirement</span>
        </div>
        {!isSheetRefusal(data) && (
          <RequirementToolbar
            rows={requirementRows(data.rows, data.names)}
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

      {isSheetRefusal(data) ? (
        /*
         * A REFUSAL IS THE SENTENCE IT CARRIES, never an empty sheet. A blank
         * requirement is indistinguishable from an order that genuinely needs no
         * trims — and on paper there is nobody to disbelieve it. The same rule
         * the engine follows for a quantity, one layer out.
         */
        <Card>
          <CardBody>
            <p className="text-sm font-medium">Nothing to print</p>
            <p className="mt-1 text-sm text-muted-foreground">{data.refused}</p>
          </CardBody>
        </Card>
      ) : (
        <RequirementSheetDocument data={data} />
      )}
    </div>
  );
}
