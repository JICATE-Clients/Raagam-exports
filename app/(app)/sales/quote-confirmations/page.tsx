import Link from "next/link";
import { requirePermission, can } from "@/lib/auth/server";
import { listQuotesForConfirmation } from "@/lib/sales/service";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { QuoteConfirmationsClient } from "./quote-confirmations-client";

export default async function SalesQuoteConfirmationsPage() {
  await requirePermission("sales", "view");

  const [rows, canEdit] = await Promise.all([
    listQuotesForConfirmation(),
    can("sales", "edit"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Confirm Quotes"
        description="Set each quote's approval status — accepted quotes win the opportunity and feed Orders."
        actions={
          <Link href="/sales">
            <Button variant="outline" size="sm">
              ← Sales
            </Button>
          </Link>
        }
      />

      <QuoteConfirmationsClient rows={rows} canEdit={canEdit} />
    </div>
  );
}
