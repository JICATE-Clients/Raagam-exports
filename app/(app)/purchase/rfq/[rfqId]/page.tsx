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
import { statusTone } from "@/lib/ui/status-tone";

const RFQ_STATUS_TONE_OVERRIDES = {
  // Open is a live document here, already in motion, not an untouched one (was info before the shared table, kept).
  open: "info",
  awarded: "success", // this module's own word — not in the shared table
} as const;

function rfqStatusTone(status: RfqStatus): StatusTone {
  return statusTone(status, RFQ_STATUS_TONE_OVERRIDES);
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
