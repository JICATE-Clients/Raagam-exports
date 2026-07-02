import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import {
  getOpeningStock,
  getOpeningStockLines,
  getItems,
} from "@/lib/stores/extras-service";
import { OPENING_STOCK_STATUS_LABELS, type OpeningStockStatus } from "@/lib/stores/extras-types";
import { OpeningStockDetail } from "./opening-stock-detail";

function tone(s: OpeningStockStatus): StatusTone {
  return s === "draft" ? "neutral" : s === "posted" ? "success" : "danger";
}

export default async function OpeningStockDetailPage({
  params,
}: {
  params: Promise<{ openingId: string }>;
}) {
  await requirePermission("stores", "view");
  const { openingId } = await params;
  const [doc, lines, items, canEdit, canDelete] = await Promise.all([
    getOpeningStock(openingId),
    getOpeningStockLines(openingId),
    getItems(),
    can("stores", "edit"),
    can("stores", "delete"),
  ]);
  if (!doc) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={doc.code ?? "Opening Stock"}
        description="Initial on-hand balances"
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone={tone(doc.status)}>{OPENING_STOCK_STATUS_LABELS[doc.status]}</StatusPill>
            <Link href="/stores/opening-stock" className="text-sm text-muted-foreground hover:text-foreground">
              Back to list
            </Link>
          </div>
        }
      />
      <OpeningStockDetail
        docId={openingId}
        status={doc.status}
        lines={lines}
        items={items}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
