import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { getCheques, getCurrencyOptions } from "@/lib/finance/cheques/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ChequesClient } from "./cheques-client";

export default async function ChequesPage() {
  await requirePermission("finance", "view");

  const [cheques, currencies, canCreate, canEdit, canDelete] = await Promise.all([
    getCheques(),
    getCurrencyOptions(),
    can("finance", "create"),
    can("finance", "edit"),
    can("finance", "delete"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Cheque Register"
        description="Cheque lifecycle — issued → deposited → cleared / cancelled / bounced"
        actions={
          <Link href="/finance">
            <Button variant="outline" size="sm">
              ← Finance
            </Button>
          </Link>
        }
      />

      <ChequesClient
        cheques={cheques}
        currencies={currencies}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
