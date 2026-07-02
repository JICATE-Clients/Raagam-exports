import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getPartyOpenings,
  getVendorOptions,
  getBuyerOptions,
  getCurrencyOptions,
} from "@/lib/finance/party-openings/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { PartyOpeningsClient } from "./party-openings-client";

export default async function PartyOpeningsPage() {
  await requirePermission("finance", "view");

  const [openings, vendors, buyers, currencies, canCreate, canDelete] =
    await Promise.all([
      getPartyOpenings(),
      getVendorOptions(),
      getBuyerOptions(),
      getCurrencyOptions(),
      can("finance", "create"),
      can("finance", "delete"),
    ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Party Openings"
        description="Opening balances for vendors (payables) and buyers (receivables)"
        actions={
          <Link href="/finance">
            <Button variant="outline" size="sm">
              ← Finance
            </Button>
          </Link>
        }
      />

      <PartyOpeningsClient
        openings={openings}
        vendors={vendors}
        buyers={buyers}
        currencies={currencies}
        canCreate={canCreate}
        canDelete={canDelete}
      />
    </div>
  );
}
