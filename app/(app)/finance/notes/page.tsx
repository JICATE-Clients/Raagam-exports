import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getFinanceNotes,
  getVendorOptions,
  getBuyerOptions,
  getCurrencyOptions,
} from "@/lib/finance/notes/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { FinanceNotesClient } from "./notes-client";

export default async function FinanceNotesPage() {
  await requirePermission("finance", "view");

  const [notes, vendors, buyers, currencies, canCreate, canEdit, canExport, canDelete] =
    await Promise.all([
      getFinanceNotes(),
      getVendorOptions(),
      getBuyerOptions(),
      getCurrencyOptions(),
      can("finance", "create"),
      can("finance", "edit"),
      can("finance", "export"),
      can("finance", "delete"),
    ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Debit / Credit Notes"
        description="Adjustment notes against vendors (payables) and buyers (receivables)"
        actions={
          <Link href="/finance">
            <Button variant="outline" size="sm">
              ← Finance
            </Button>
          </Link>
        }
      />

      <FinanceNotesClient
        notes={notes}
        vendors={vendors}
        buyers={buyers}
        currencies={currencies}
        canCreate={canCreate}
        canEdit={canEdit}
        canExport={canExport}
        canDelete={canDelete}
      />
    </div>
  );
}
