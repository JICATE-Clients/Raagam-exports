import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getProcessRfq,
  getProcessRfqQuotes,
  getVendorOptions,
} from "@/lib/process/rfq/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ProcessRfqDetail } from "./process-rfq-detail";

export default async function ProcessRfqDetailPage({
  params,
}: {
  params: Promise<{ rfqId: string }>;
}) {
  await requirePermission("process_planning", "view");
  const { rfqId } = await params;

  const [rfq, quotes, vendors, canEdit, canDelete, canApprove] =
    await Promise.all([
      getProcessRfq(rfqId),
      getProcessRfqQuotes(rfqId),
      getVendorOptions(),
      can("process_planning", "edit"),
      can("process_planning", "delete"),
      can("process_planning", "approve"),
    ]);

  if (!rfq) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Process RFQ ${rfq.code ?? ""}`}
        description={`${rfq.process_type} · ${rfq.sales_orders?.order_number ?? "no order"}`}
        actions={
          <Link href="/process/rfq">
            <Button variant="outline" size="sm">
              ← All RFQs
            </Button>
          </Link>
        }
      />

      <ProcessRfqDetail
        rfq={rfq}
        quotes={quotes}
        vendors={vendors}
        canEdit={canEdit}
        canDelete={canDelete}
        canApprove={canApprove}
      />
    </div>
  );
}
