import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getForwardContracts,
  getCurrencyOptions,
} from "@/lib/finance/forward-contracts/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ForwardContractsClient } from "./forward-contracts-client";

export default async function ForwardContractsPage() {
  await requirePermission("finance", "view");

  const [contracts, currencies, canCreate, canEdit, canExport, canDelete] =
    await Promise.all([
      getForwardContracts(),
      getCurrencyOptions(),
      can("finance", "create"),
      can("finance", "edit"),
      can("finance", "export"),
      can("finance", "delete"),
    ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Forward Contracts"
        description="Forex forward-cover register (booking → utilised / cancelled)"
        actions={
          <Link href="/finance">
            <Button variant="outline" size="sm">
              ← Finance
            </Button>
          </Link>
        }
      />

      <ForwardContractsClient
        contracts={contracts}
        currencies={currencies}
        canCreate={canCreate}
        canEdit={canEdit}
        canExport={canExport}
        canDelete={canDelete}
      />
    </div>
  );
}
