import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getRfq,
  getVendorsForPicker,
  getCurrencies,
} from "@/lib/purchase/po-service";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { StatusTone } from "@/components/ui/status-pill";
import { RfqDetail } from "./rfq-detail";
import type { RfqStatus } from "@/lib/purchase/types";

function rfqStatusTone(status: RfqStatus): StatusTone {
  switch (status) {
    case "open":
      return "info";
    case "closed":
      return "neutral";
    case "awarded":
      return "success";
  }
}

const RFQ_STATUS_LABELS: Record<RfqStatus, string> = {
  open: "Open",
  closed: "Closed",
  awarded: "Awarded",
};

export default async function RfqDetailPage({
  params,
}: {
  params: Promise<{ rfqId: string }>;
}) {
  await requirePermission("materials_purchase", "view");
  const { rfqId } = await params;

  const [rfq, vendors, currencies, canEdit] = await Promise.all([
    getRfq(rfqId),
    getVendorsForPicker(),
    getCurrencies(),
    can("materials_purchase", "edit"),
  ]);

  if (!rfq) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={rfq.title}
        description={`${rfq.code ?? "RFQ"} · Created ${fmtDate(rfq.created_at)}`}
        actions={
          <StatusPill tone={rfqStatusTone(rfq.status)}>
            {RFQ_STATUS_LABELS[rfq.status]}
          </StatusPill>
        }
      />

      <RfqDetail
        rfq={rfq}
        vendors={vendors}
        currencies={currencies}
        canEdit={canEdit}
      />
    </div>
  );
}
