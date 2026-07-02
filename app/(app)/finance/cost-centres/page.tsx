import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getCostCentreGroups,
  getCostCentres,
  getActiveGroups,
} from "@/lib/finance/cost-centres/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { CostCentresClient } from "./cost-centres-client";

export default async function CostCentresPage() {
  await requirePermission("finance", "view");

  const [groups, centres, activeGroups, canCreate, canEdit, canDelete] =
    await Promise.all([
      getCostCentreGroups(),
      getCostCentres(),
      getActiveGroups(),
      can("finance", "create"),
      can("finance", "edit"),
      can("finance", "delete"),
    ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cost Centres"
        description="Cost-centre groups & centres for department-wise cost tracking"
        actions={
          <Link href="/finance">
            <Button variant="outline" size="sm">
              ← Finance
            </Button>
          </Link>
        }
      />

      <CostCentresClient
        groups={groups}
        centres={centres}
        activeGroups={activeGroups}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
