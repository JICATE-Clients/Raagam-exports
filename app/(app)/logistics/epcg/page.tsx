import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { getEpcgDeclarations, getCurrencyOptions } from "@/lib/logistics/epcg/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { EpcgClient } from "./epcg-client";

export default async function EpcgPage() {
  await requirePermission("logistics", "view");

  const [declarations, currencies, canCreate, canEdit, canDelete, canExport] =
    await Promise.all([
      getEpcgDeclarations(),
      getCurrencyOptions(),
      can("logistics", "create"),
      can("logistics", "edit"),
      can("logistics", "delete"),
      can("logistics", "export"),
    ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="EPCG Declarations"
        description="Export Promotion Capital Goods licences & export-obligation tracking"
        actions={
          <Link href="/logistics">
            <Button variant="outline" size="sm">
              ← Logistics
            </Button>
          </Link>
        }
      />

      <EpcgClient
        declarations={declarations}
        currencies={currencies}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        canExport={canExport}
      />
    </div>
  );
}
