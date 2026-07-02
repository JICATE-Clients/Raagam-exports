import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { getExchangeRates, getCurrencyOptions } from "@/lib/finance/exchange-rates/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ExchangeRatesClient } from "./exchange-rates-client";

export default async function ExchangeRatesPage() {
  await requirePermission("finance", "view");

  const [rates, currencies, canCreate, canDelete] = await Promise.all([
    getExchangeRates(),
    getCurrencyOptions(),
    can("finance", "create"),
    can("finance", "delete"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Actual Exchange Rates"
        description="Booked vs actual realised forex rate — gain / loss tracking"
        actions={
          <Link href="/finance">
            <Button variant="outline" size="sm">
              ← Finance
            </Button>
          </Link>
        }
      />

      <ExchangeRatesClient
        rates={rates}
        currencies={currencies}
        canCreate={canCreate}
        canDelete={canDelete}
      />
    </div>
  );
}
