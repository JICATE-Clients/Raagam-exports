import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import {
  getIwo,
  getIwoBom,
  getIwoBomItems,
  getItems,
  getUoms,
} from "@/lib/planning/extras-service";
import { IwoBomDetail } from "./iwo-bom-detail";
import type { IwoBomItem } from "@/lib/planning/types";

export default async function IwoBomDetailPage({
  params,
}: {
  params: Promise<{ iwoId: string }>;
}) {
  await requirePermission("planning", "view");
  const { iwoId } = await params;

  const [iwo, bom, items, uoms, canEdit] = await Promise.all([
    getIwo(iwoId),
    getIwoBom(iwoId),
    getItems(),
    getUoms(),
    can("planning", "edit"),
  ]);
  if (!iwo) notFound();

  const bomItems: IwoBomItem[] = bom ? await getIwoBomItems(bom.id) : [];

  return (
    <div className="space-y-4">
      <PageHeader
        title={`BOM — ${iwo.code ?? iwo.title}`}
        description={iwo.title}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill tone={bom?.status === "final" ? "success" : "neutral"}>
              {bom ? (bom.status === "final" ? "Final" : "Draft") : "No BOM"}
            </StatusPill>
            <Link href="/planning/iwo-boms" className="text-sm text-muted-foreground hover:text-foreground">
              Back to list
            </Link>
          </div>
        }
      />
      <IwoBomDetail
        iwoId={iwoId}
        bomStatus={bom?.status ?? null}
        items={bomItems}
        itemOptions={items}
        uoms={uoms}
        canEdit={canEdit}
      />
    </div>
  );
}
