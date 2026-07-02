import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import {
  getPdRequest,
  getPdProducts,
  getStyles,
} from "@/lib/planning/extras-service";
import { PD_STATUS_LABELS, type PdStatus } from "@/lib/planning/types";
import { PdDetail } from "./pd-detail";

function tone(s: PdStatus): StatusTone {
  return s === "open" ? "info" : s === "closed" ? "success" : "danger";
}

export default async function PdRequestDetailPage({
  params,
}: {
  params: Promise<{ pdId: string }>;
}) {
  await requirePermission("planning", "view");
  const { pdId } = await params;
  const [request, products, styles, canEdit, canDelete] = await Promise.all([
    getPdRequest(pdId),
    getPdProducts(pdId),
    getStyles(),
    can("planning", "edit"),
    can("planning", "delete"),
  ]);
  if (!request) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={request.code ?? "PD Request"}
        description={request.title}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone={tone(request.status)}>{PD_STATUS_LABELS[request.status]}</StatusPill>
            <Link href="/planning/product-dev" className="text-sm text-muted-foreground hover:text-foreground">
              Back to list
            </Link>
          </div>
        }
      />
      <PdDetail
        pdId={pdId}
        stage={request.stage}
        status={request.status}
        description={request.description}
        products={products}
        styles={styles}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
