import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { getPackingList, getPackingLines } from "@/lib/production/extras-service";
import { PACKING_STATUS_LABELS, type PackingStatus } from "@/lib/production/extras-types";
import { PackingListDetail } from "./packing-list-detail";

function tone(s: PackingStatus): StatusTone {
  return s === "draft" ? "neutral" : s === "finalized" ? "success" : "danger";
}

export default async function PackingListDetailPage({
  params,
}: {
  params: Promise<{ packingId: string }>;
}) {
  await requirePermission("production", "view");
  const { packingId } = await params;
  const [doc, lines, canEdit, canDelete] = await Promise.all([
    getPackingList(packingId),
    getPackingLines(packingId),
    can("production", "edit"),
    can("production", "delete"),
  ]);
  if (!doc) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={doc.code ?? "Packing List"}
        description="Carton-wise packing detail"
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone={tone(doc.status)}>{PACKING_STATUS_LABELS[doc.status]}</StatusPill>
            <Link href="/production/packing-lists" className="text-sm text-muted-foreground hover:text-foreground">
              Back to list
            </Link>
          </div>
        }
      />
      <PackingListDetail
        docId={packingId}
        status={doc.status}
        lines={lines}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
