import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { getBankLimits, getCurrencyOptions } from "@/lib/finance/bank-limits/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { BankLimitsClient } from "./bank-limits-client";

export default async function BankLimitsPage() {
  await requirePermission("finance", "view");

  const [limits, currencies, canCreate, canExport, canDelete] = await Promise.all([
    getBankLimits(),
    getCurrencyOptions(),
    can("finance", "create"),
    can("finance", "export"),
    can("finance", "delete"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bank Limits & Interests"
        description="Bank credit facilities — limits & interest rates"
        actions={
          <Link href="/finance">
            <Button variant="outline" size="sm">
              ← Finance
            </Button>
          </Link>
        }
      />

      <BankLimitsClient
        limits={limits}
        currencies={currencies}
        canCreate={canCreate}
        canExport={canExport}
        canDelete={canDelete}
      />
    </div>
  );
}
