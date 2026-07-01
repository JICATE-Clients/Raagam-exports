import { requirePermission } from "@/lib/auth/server";
import { listBuyers, listItems, listUoms, listCurrencies } from "@/lib/masters/service";
import { PageHeader } from "@/components/ui/page-header";
import MastersClient from "./masters-client";

export default async function MastersPage() {
  await requirePermission("masters", "view");

  const [buyers, items, uoms, currencies] = await Promise.all([
    listBuyers(),
    listItems(),
    listUoms(),
    listCurrencies(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Master Data"
        description="Manage buyers, items, and units of measure."
      />
      <MastersClient
        buyers={buyers}
        items={items}
        uoms={uoms}
        currencies={currencies}
      />
    </div>
  );
}
