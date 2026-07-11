import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getInternalWorkOrder,
  getIwoLines,
} from "@/lib/orders/internal-work-orders/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { IwoDetail } from "./iwo-detail";

export default async function IwoDetailPage({
  params,
}: {
  params: Promise<{ iwoId: string }>;
}) {
  await requirePermission("orders", "view");
  const { iwoId } = await params;

  const [iwo, lines, canEdit, canDelete] = await Promise.all([
    getInternalWorkOrder(iwoId),
    getIwoLines(iwoId),
    can("orders", "edit"),
    can("orders", "delete"),
  ]);

  if (!iwo) notFound();

  return (
    <div className="space-y-4">
      <PageHeader
        title={iwo.code ?? "Internal Work Order"}
        description={iwo.title ?? iwo.customer?.name ?? "Trial / internal work order"}
        actions={
          <Link href="/orders/internal-work-orders">
            <Button variant="outline" size="sm">
              ← All work orders
            </Button>
          </Link>
        }
      />

      <IwoDetail iwo={iwo} lines={lines} canEdit={canEdit} canDelete={canDelete} />
    </div>
  );
}
