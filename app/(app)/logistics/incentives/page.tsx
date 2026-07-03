import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { getIncentiveFiles, getCurrencyOptions } from "@/lib/logistics/incentives/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { IncentivesClient } from "./incentives-client";

export default async function IncentivesPage() {
  await requirePermission("logistics", "view");

  const [files, currencies, canCreate, canEdit, canDelete, canExport] = await Promise.all([
    getIncentiveFiles(),
    getCurrencyOptions(),
    can("logistics", "create"),
    can("logistics", "edit"),
    can("logistics", "delete"),
    can("logistics", "export"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Export Incentives"
        description="Government export-incentive claims (RoDTEP / Drawback / RoSCTL)"
        actions={
          <Link href="/logistics">
            <Button variant="outline" size="sm">
              ← Logistics
            </Button>
          </Link>
        }
      />

      <IncentivesClient
        files={files}
        currencies={currencies}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        canExport={canExport}
      />
    </div>
  );
}
