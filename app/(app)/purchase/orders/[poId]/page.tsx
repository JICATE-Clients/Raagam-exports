import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getPurchaseOrder,
  getItems,
  getUoms,
} from "@/lib/purchase/po-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { PO_STATUS_LABELS } from "@/lib/purchase/types";
import type { PoStatus } from "@/lib/purchase/types";
import { PoDetail } from "./po-detail";
import { PoReview } from "./po-review";
import { getRequirementLines } from "@/lib/purchase/re-po/service";
import { statusTone } from "@/lib/ui/status-tone";

const PO_STATUS_TONE_OVERRIDES = {
  // Approved is a step in this document's life, not its end — work still follows it (was info before the shared table, kept).
  approved: "info",
} as const;

function poStatusTone(status: PoStatus): StatusTone {
  return statusTone(status, PO_STATUS_TONE_OVERRIDES);
}

export default async function PoDetailPage({
  params,
}: {
  params: Promise<{ poId: string }>;
}) {
  await requirePermission("materials_purchase", "view");
  const { poId } = await params;

  const [po, items, uoms, canEdit, canDelete, canApprove] = await Promise.all([
    getPurchaseOrder(poId),
    getItems(),
    getUoms(),
    can("materials_purchase", "edit"),
    can("materials_purchase", "delete"),
    can("materials_purchase", "approve"),
  ]);

  if (!po) notFound();

  /* RAISED ON RAISE PO (its lines carry a req_key) → the one-screen review with
     Approve · Revise · Reject (user 2026-10-26). Every other PO keeps the tabs. */
  const poLines = po.lines as unknown as { req_key?: string | null; garment_order_id?: string | null; iwo_id?: string | null }[];
  const raised = poLines.some((l) => l.req_key);
  let sourceNos: Record<string, string> = {};
  if (raised) {
    const ids = [...new Set(poLines.map((l) => l.garment_order_id ?? l.iwo_id).filter((v): v is string => !!v))];
    const req = ids.length ? await getRequirementLines(ids) : [];
    sourceNos = Object.fromEntries(req.map((l) => [l.source_id, l.source_no]));
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={po.code ?? "Purchase Order"}
        description={`Vendor: ${po.vendor_name ?? "—"} · Order date: ${fmtDate(po.order_date)}`}
        actions={
          <StatusPill tone={poStatusTone(po.status)}>
            {PO_STATUS_LABELS[po.status]}
          </StatusPill>
        }
      />

      {raised ? (
        <PoReview po={po} uoms={uoms} sourceNos={sourceNos} canEdit={canEdit} canApprove={canApprove} />
      ) : (
      <PoDetail
        po={po}
        items={items}
        uoms={uoms}
        canEdit={canEdit}
        canDelete={canDelete}
        canApprove={canApprove}
      />
      )}
    </div>
  );
}
