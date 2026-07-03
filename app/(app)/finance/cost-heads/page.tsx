import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getCostHeads,
  getCostItems,
  getActiveHeads,
} from "@/lib/finance/cost-heads/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { CostHeadsClient } from "./cost-heads-client";

export default async function CostHeadsPage() {
  await requirePermission("finance", "view");

  const [heads, items, activeHeads, canCreate, canEdit, canDelete, canExport] =
    await Promise.all([
      getCostHeads(),
      getCostItems(),
      getActiveHeads(),
      can("finance", "create"),
      can("finance", "edit"),
      can("finance", "delete"),
      can("finance", "export"),
    ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cost Heads & Items"
        description="Cost-head catalogue and granular cost items"
        actions={
          <Link href="/finance">
            <Button variant="outline" size="sm">
              ← Finance
            </Button>
          </Link>
        }
      />

      <CostHeadsClient
        heads={heads}
        items={items}
        activeHeads={activeHeads}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        canExport={canExport}
      />
    </div>
  );
}
