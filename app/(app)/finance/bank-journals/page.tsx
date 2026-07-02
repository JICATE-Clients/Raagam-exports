import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { getBankJournals, getCurrencyOptions } from "@/lib/finance/bank-journals/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { BankJournalsClient } from "./bank-journals-client";

export default async function BankJournalsPage() {
  await requirePermission("finance", "view");

  const [journals, currencies, canCreate, canDelete] = await Promise.all([
    getBankJournals(),
    getCurrencyOptions(),
    can("finance", "create"),
    can("finance", "delete"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bank Journals"
        description="Bank transaction log — deposits, withdrawals, charges & interest"
        actions={
          <Link href="/finance">
            <Button variant="outline" size="sm">
              ← Finance
            </Button>
          </Link>
        }
      />

      <BankJournalsClient
        journals={journals}
        currencies={currencies}
        canCreate={canCreate}
        canDelete={canDelete}
      />
    </div>
  );
}
