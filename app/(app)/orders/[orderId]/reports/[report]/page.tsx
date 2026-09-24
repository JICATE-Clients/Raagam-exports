import Link from "next/link";
import { cadOrderPending } from "@/lib/orders/cad-lifecycle/guard";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/server";
import { Card, CardBody } from "@/components/ui/card";
import { OrderDocumentTabs } from "@/components/orders/order-document-tabs";
import { FabricBomReportView } from "@/components/orders/fabric-bom-reports-sheet";
import { MaterialBomReportView } from "@/components/orders/material-bom-reports-sheet";
import {
  findOrderReport,
  isFabricBomSheetReport,
  isMaterialBomSheetReport,
  type OrderReportKey,
} from "@/lib/orders/order-reports";
import {
  currentMaterialBom,
  materialBomRequirementReport,
} from "@/lib/orders/material-bom-amendment/requirement-report";
import { currentFabricBom, isFabricSheetRefusal } from "@/lib/orders/fabric-requirement/service";
import { fabricBomEntryRegister, yarnFabricRequirementReport } from "@/lib/orders/fabric-bom/reports";
import { VFinalBanner } from "@/components/orders/v-final-banner";
import { vFinalFor } from "@/lib/orders/amendments/v-final";

/**
 * ANY REGISTERED ORDER REPORT WITHOUT A PAGE OF ITS OWN, at
 * `/orders/<sales order id>/reports/<key>`.
 *
 * The reason this route exists is the reason `lib/orders/order-reports.ts`
 * does (client 2026-09-19): the Fabric BOM's Entry Register, Yarn & Fabric
 * Requirement and Printing Requirement had no URL keyed on the ORDER — they
 * opened only from a button inside the Fabric BOM editor, so Order Entry's
 * Reports could not reach them. A report declared in the registry is served
 * here the moment it has a view; nothing about the route changes per report.
 *
 * SAME URL SHAPE AS `/gos`, `/requirement` and `/fabric-requirement`: keyed on
 * the RE Number, with the document resolving its own CURRENT BOM
 * (`currentFabricBom`, the one rule the Fabric Requirement sheet uses too).
 *
 * NO RELOAD GUARD — read-only, no form, no overlay; the call every sibling
 * document page records.
 */
export default async function OrderReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string; report: string }>;
  /** `?version=proposed` — the amendment's in-flight data instead of V_final (0619). */
  searchParams: Promise<{ version?: string }>;
}) {
  await requirePermission("orders", "view");
  const [{ orderId, report: key }, { version }] = await Promise.all([params, searchParams]);
  const proposed = version === "proposed";

  const report = findOrderReport(key);
  // A key with its own page is served THERE; answering it here too would give
  // one report two URLs that could drift apart.
  if (!report || report.page) notFound();

  /* V_FINAL (0619, spec §4B): the registry names each report's frozen source;
     while the order is amending that is what prints, unless `?version=proposed`. */
  const vf = await vFinalFor(report.vFinal, orderId);
  const frozen = vf.state === "frozen" && !proposed ? vf.payload : null;

  let body: React.ReactNode;
  if (isFabricBomSheetReport(report)) {
    const snap = frozen as import("@/lib/orders/amendments/v-final").VFinalPayloads["fabric-bom-reports"] | null;
    const current = snap ? null : await currentFabricBom(orderId);
    if (snap && "refused" in snap) {
      body = <Refusal message={snap.refused} href="/orders/fabric-bom" action="Open Fabric BOM →" />;
    } else if (current && isFabricSheetRefusal(current)) {
      body = <Refusal message={current.refused} href="/orders/fabric-bom" action="Open Fabric BOM →" />;
    } else {
      /* BOTH LOADED, as the editor's sheet does: Printing Requirement reads the
         Yarn & Fabric Requirement object, so the pair is one fetch's worth. */
      const bomId = current && !isFabricSheetRefusal(current) ? current.bom.id : "";
      const [register, requirement] =
        snap && !("refused" in snap)
          ? [snap.register, snap.requirement]
          : await Promise.all([fabricBomEntryRegister(bomId), yarnFabricRequirementReport(bomId)]);
      /* THE CAD STAMP IS LIVE (0628): a frozen copy carries the flag as it stood
         at the freeze, so it is re-read now — off the order the frozen header
         names — and laid over it. A live report already read it. */
      const frozenHeader =
        snap && !("refused" in snap)
          ? !("refused" in register)
            ? register.header
            : !("refused" in requirement)
              ? requirement.header
              : null
          : null;
      const cadPending = frozenHeader ? await cadOrderPending(frozenHeader.garmentOrderId) : undefined;
      body = (
        <div className="rounded-md bg-[#f1f3f5] p-4">
          <FabricBomReportView report={report.key} register={register} requirement={requirement} cadPending={cadPending} />
        </div>
      );
    }
  } else if (isMaterialBomSheetReport(report)) {
    /* THE ORDER'S CURRENT MATERIAL BOM — latest recorded, the rule the
       Accessories Requirement sheet and the purchase ceiling both use. */
    const snap = frozen as import("@/lib/orders/amendments/v-final").VFinalPayloads["material-bom-requirement"] | null;
    const current = snap ? ("refused" in snap ? { refused: snap.refused } : { id: snap.bomId }) : await currentMaterialBom(orderId);
    if ("refused" in current) {
      body = <Refusal message={current.refused} href="/orders/material-bom" action="Open Material BOM →" />;
    } else {
      const requirement =
        snap && !("refused" in snap) ? snap.requirement : await materialBomRequirementReport(current.id);
      body = (
        <div className="rounded-md bg-[#f1f3f5] p-4">
          <MaterialBomReportView report={report.key} requirement={requirement} />
        </div>
      );
    }
  } else {
    /* A registered report with no page and no renderer. `check:order-reports`
       refuses to let this ship; the branch is here so the route says so rather
       than drawing a blank page if it ever does. */
    body = <Refusal message={`${report.label} has no view yet.`} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link href={`/orders/${orderId}`} className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to order
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-medium">{report.label}</span>
      </div>

      <OrderDocumentTabs orderId={orderId} current={report.key as OrderReportKey} />

      <VFinalBanner
        state={vf}
        proposed={proposed}
        hrefApproved={`/orders/${orderId}/reports/${report.key}`}
        hrefProposed={`/orders/${orderId}/reports/${report.key}?version=proposed`}
      />

      {body}
    </div>
  );
}

/**
 * A REFUSAL IS THE SENTENCE IT CARRIES, never an empty report — a blank Fabric
 * BOM report reads as "this order needs no cloth", which no garment order can
 * be. Names the screen that would fix it, as the sibling pages do.
 */
function Refusal({ message, href, action }: { message: string; href?: string; action?: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-sm font-medium">Nothing to print</p>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        {href && action && (
          <Link href={href} className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
            {action}
          </Link>
        )}
      </CardBody>
    </Card>
  );
}
