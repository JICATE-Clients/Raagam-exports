import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getProvisionalInvoices,
  getBuyerOptions,
  getCurrencyOptions,
} from "@/lib/finance/provisional-invoices/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ProvisionalInvoicesClient } from "./provisional-invoices-client";

export default async function ProvisionalInvoicesPage() {
  await requirePermission("finance", "view");

  const [invoices, buyers, currencies, canCreate, canEdit, canExport, canDelete] =
    await Promise.all([
      getProvisionalInvoices(),
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
        title="Provisional Invoices"
        description="Preliminary export invoices raised before the final invoice"
        actions={
          <Link href="/finance">
            <Button variant="outline" size="sm">
              ← Finance
            </Button>
          </Link>
        }
      />

      <ProvisionalInvoicesClient
        invoices={invoices}
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
