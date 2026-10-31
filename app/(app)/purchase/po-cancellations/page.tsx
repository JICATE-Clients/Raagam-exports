import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import {
  listPoCancellations,
  getCancellablePos,
  getPosForCancelRequest,
  listPoCancelRequests,
} from "@/lib/purchase/extras-service";
import { PoCancellationsClient } from "./po-cancellations-client";

export default async function PoCancellationsPage({
  searchParams,
}: {
  searchParams: Promise<{ po?: string; open?: string }>;
}) {
  await requirePermission("materials_purchase", "view");
  const sp = await searchParams;
  const [rows, draftPos, requestPos, requests, canEdit, canApprove] = await Promise.all([
    listPoCancellations(),
    getCancellablePos(),
    getPosForCancelRequest(),
    listPoCancelRequests(),
    can("materials_purchase", "edit"),
    can("materials_purchase", "approve"),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Cancel Purchase Order"
        description="Request cancellation of a whole PO or part of its lines — the MD approves it in My Approvals."
      />
      <PoCancellationsClient
        rows={rows}
        draftPos={draftPos}
        requestPos={requestPos}
        requests={requests}
        canEdit={canEdit}
        canApprove={canApprove}
        initialPoId={sp.po ?? null}
        openId={sp.open ?? null}
      />
    </div>
  );
}
