import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import {
  getDomesticInvoices,
  getBuyerOptions,
} from "@/lib/finance/domestic-invoices/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { DomesticInvoicesClient } from "./domestic-invoices-client";

export default async function DomesticInvoicesPage() {
  await requirePermission("finance", "view");

  const [invoices, buyers, canCreate, canEdit, canDelete] = await Promise.all([
    getDomesticInvoices(),
    getBuyerOptions(),
    can("finance", "create"),
    can("finance", "edit"),
    can("finance", "delete"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Domestic Garment Invoices"
        description="Domestic (INR / GST) garment sales invoices"
        actions={
          <Link href="/finance">
            <Button variant="outline" size="sm">
              ← Finance
            </Button>
          </Link>
        }
      />

      <DomesticInvoicesClient
        invoices={invoices}
        buyers={buyers}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </div>
  );
}
