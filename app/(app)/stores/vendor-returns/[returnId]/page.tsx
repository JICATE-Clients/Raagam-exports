import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import {
  getVendorReturn,
  getVendorReturnLines,
  getItems,
} from "@/lib/stores/extras-service";
import { VENDOR_RETURN_STATUS_LABELS, type VendorReturnStatus } from "@/lib/stores/extras-types";
import { VendorReturnDetail } from "./vendor-return-detail";
import { statusTone } from "@/lib/ui/status-tone";

const TONE_OVERRIDES = {
  replaced: "info", // this module's own word — not in the shared table
  // Closed is this document's normal completion, not a retirement (was success before the shared table, kept).
  closed: "success",
} as const;

function tone(s: VendorReturnStatus): StatusTone {
  return statusTone(s, TONE_OVERRIDES);
}

export default async function VendorReturnDetailPage({
  params,
}: {
  params: Promise<{ returnId: string }>;
}) {
  await requirePermission("stores", "view");
  const { returnId } = await params;
  const [doc, lines, items, canEdit, canDelete] = await Promise.all([
    getVendorReturn(returnId),
    getVendorReturnLines(returnId),
    getItems(),
    can("stores", "edit"),
    can("stores", "delete"),
  ]);
  if (!doc) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={doc.code ?? "Vendor Return"}
        description={doc.reason ?? "Return to vendor"}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone={tone(doc.status)}>{VENDOR_RETURN_STATUS_LABELS[doc.status]}</StatusPill>
            <Link href="/stores/vendor-returns" className="text-sm text-muted-foreground hover:text-foreground">
              Back to list
            </Link>
          </div>
        }
      />
      <VendorReturnDetail
        docId={returnId}
        status={doc.status}
        lines={lines}
        items={items}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
