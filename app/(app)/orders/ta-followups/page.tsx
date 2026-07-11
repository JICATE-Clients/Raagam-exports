import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { listTaFollowups } from "@/lib/orders/ta-followups/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { TaFollowupsClient } from "./ta-followups-client";

export default async function TaFollowupsPage() {
  await requirePermission("orders", "view");

  const [rows, canEdit] = await Promise.all([
    listTaFollowups(),
    can("orders", "edit"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="TA Followups"
        description="Record actual progress against each planned Time & Action activity."
        actions={
          <Link href="/orders">
            <Button variant="outline" size="sm">
              ← Garment Orders
            </Button>
          </Link>
        }
      />

      <TaFollowupsClient rows={rows} canEdit={canEdit} />
    </div>
  );
}
