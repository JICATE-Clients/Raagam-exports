import { requirePermission, can } from "@/lib/auth/server";
import { listBuyers, listItems, listUoms, listCurrencies } from "@/lib/masters/service";
import {
  listConfigLookups,
  listTransporters,
  listGstRates,
} from "@/lib/masters/extras-service";
import { PageHeader } from "@/components/ui/page-header";
import MastersClient from "./masters-client";

export default async function MastersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePermission("masters", "view");
  const { tab } = await searchParams;

  const [
    buyers,
    items,
    uoms,
    currencies,
    lookups,
    transporters,
    gstRates,
    canCreate,
    canExport,
    canDelete,
  ] = await Promise.all([
    listBuyers(),
    listItems(),
    listUoms(),
    listCurrencies(),
    listConfigLookups(),
    listTransporters(),
    listGstRates(),
    can("masters", "create"),
    can("masters", "export"),
    can("masters", "delete"),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Master Data"
        description="Buyers, items, UOMs, material/spec masters, transporters, GST rates and currencies."
      />
      <MastersClient
        buyers={buyers}
        items={items}
        uoms={uoms}
        currencies={currencies}
        lookups={lookups}
        transporters={transporters}
        gstRates={gstRates}
        initialTab={tab}
        canCreate={canCreate}
        canExport={canExport}
        canDelete={canDelete}
      />
    </div>
  );
}
