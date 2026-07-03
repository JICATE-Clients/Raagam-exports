import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { getOtherEntries, getCurrencyOptions } from "@/lib/finance/other-entries/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { OtherEntriesClient } from "./other-entries-client";

export default async function OtherEntriesPage() {
  await requirePermission("finance", "view");

  const [entries, currencies, canCreate, canExport, canDelete] = await Promise.all([
    getOtherEntries(),
    getCurrencyOptions(),
    can("finance", "create"),
    can("finance", "export"),
    can("finance", "delete"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Other Income & Expenses"
        description="Misc income / expense entries not tied to a bill or invoice"
        actions={
          <Link href="/finance">
            <Button variant="outline" size="sm">
              ← Finance
            </Button>
          </Link>
        }
      />

      <OtherEntriesClient
        entries={entries}
        currencies={currencies}
        canCreate={canCreate}
        canExport={canExport}
        canDelete={canDelete}
      />
    </div>
  );
}
