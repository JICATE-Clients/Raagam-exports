import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { fmtDate, fmtNumber } from "@/lib/format";
import { getAsset, getAssetAssignments } from "@/lib/admin/extras-service";
import { ASSET_STATUS_LABELS, type AssetStatus } from "@/lib/admin/extras-types";
import { AssetDetail } from "./asset-detail";

function tone(s: AssetStatus): StatusTone {
  switch (s) {
    case "active":
      return "success";
    case "assigned":
      return "info";
    case "retired":
      return "neutral";
    case "disposed":
      return "danger";
  }
}

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ assetId: string }>;
}) {
  await requirePermission("system_admin", "view");
  const { assetId } = await params;
  const [asset, assignments, canEdit, canDelete] = await Promise.all([
    getAsset(assetId),
    getAssetAssignments(assetId),
    can("system_admin", "edit"),
    can("system_admin", "delete"),
  ]);
  if (!asset) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={asset.code ?? "Asset"}
        description={asset.name}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone={tone(asset.status)}>{ASSET_STATUS_LABELS[asset.status]}</StatusPill>
            <Link href="/admin/assets" className="text-sm text-muted-foreground hover:text-foreground">
              Back to list
            </Link>
          </div>
        }
      />
      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-muted-foreground">Category</dt><dd className="mt-0.5">{asset.category ?? "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Group</dt><dd className="mt-0.5">{asset.asset_group ?? "—"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Purchase date</dt><dd className="mt-0.5 tabular-nums">{fmtDate(asset.purchase_date)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Value</dt><dd className="mt-0.5 tabular-nums">{asset.value != null ? fmtNumber(asset.value) : "—"}</dd></div>
          </dl>
        </CardBody>
      </Card>
      <AssetDetail
        assetId={assetId}
        status={asset.status}
        assignments={assignments}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
