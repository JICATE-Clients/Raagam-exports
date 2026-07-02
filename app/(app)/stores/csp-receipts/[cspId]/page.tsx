import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import {
  getCspReceipt,
  getCspReceiptLines,
  getItems,
} from "@/lib/stores/extras-service";
import { CSP_STATUS_LABELS, type CspStatus } from "@/lib/stores/extras-types";
import { CspReceiptDetail } from "./csp-receipt-detail";

function tone(s: CspStatus): StatusTone {
  return s === "draft" ? "neutral" : s === "posted" ? "success" : "danger";
}

export default async function CspReceiptDetailPage({
  params,
}: {
  params: Promise<{ cspId: string }>;
}) {
  await requirePermission("stores", "view");
  const { cspId } = await params;
  const [doc, lines, items, canEdit, canDelete] = await Promise.all([
    getCspReceipt(cspId),
    getCspReceiptLines(cspId),
    getItems(),
    can("stores", "edit"),
    can("stores", "delete"),
  ]);
  if (!doc) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={doc.code ?? "CSP Receipt"}
        description={doc.reference ?? "Customer-supplied material receipt"}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone={tone(doc.status)}>{CSP_STATUS_LABELS[doc.status]}</StatusPill>
            <Link href="/stores/csp-receipts" className="text-sm text-muted-foreground hover:text-foreground">
              Back to list
            </Link>
          </div>
        }
      />
      <CspReceiptDetail
        docId={cspId}
        status={doc.status}
        lines={lines}
        items={items}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
