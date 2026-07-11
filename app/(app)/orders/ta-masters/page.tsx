import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { getTaActivities, getTaActivityTypes } from "@/lib/orders/ta-activities/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { TaMastersClient } from "./ta-masters-client";

export default async function TaActivityPage() {
  await requirePermission("orders", "view");

  const [activities, types, canCreate, canEdit, canDelete, mCreate, mEdit] =
    await Promise.all([
      getTaActivities(),
      getTaActivityTypes(),
      can("orders", "create"),
      can("orders", "edit"),
      can("orders", "delete"),
      can("masters", "create"),
      can("masters", "edit"),
    ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="TA Activity"
        description="Time & Action activity catalogue — Short Name, Name, Type, sub-activities & delivery-date flags."
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
        types={types}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        masterCanCreate={mCreate}
        masterCanEdit={mEdit}
      />
    </div>
  );
}
