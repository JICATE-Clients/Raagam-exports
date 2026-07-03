import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { getTaActivities } from "@/lib/orders/ta-activities/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { TaMastersClient } from "./ta-masters-client";

export default async function TaMastersPage() {
  await requirePermission("orders", "view");

  const [activities, canCreate, canEdit, canDelete, canExport] = await Promise.all([
    getTaActivities(),
    can("orders", "create"),
    can("orders", "edit"),
    can("orders", "delete"),
    can("orders", "export"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="TA Masters — Activities"
        description="Time & Action activity catalogue, owning department & default plan offset"
        actions={
          <Link href="/orders">
            <Button variant="outline" size="sm">
              ← Orders
            </Button>
          </Link>
        }
      />

      <TaMastersClient
        activities={activities}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        canExport={canExport}
      />
    </div>
  );
}
