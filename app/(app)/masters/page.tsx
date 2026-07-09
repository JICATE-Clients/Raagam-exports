import { requirePermission, can } from "@/lib/auth/server";
import { listBuyers, listItems, listUoms, listCurrencies } from "@/lib/masters/service";
import {
  listConfigLookups,
  listTransporters,
  listGstRates,
} from "@/lib/masters/extras-service";
import { SUBMODULES, submoduleChildCount } from "@/lib/masters/submodules";
import { PageHeader } from "@/components/ui/page-header";
import { HubCard } from "@/components/masters/hub-card";
import MastersClient from "./masters-client";

export default async function MastersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePermission("masters", "view");
  const { tab } = await searchParams;

  // Legacy tabbed editors (Buyers / Items / UOMs / Transporters / GST / Currencies).
  // Reached only via ?tab= links from the submodule hubs while they're migrated.
  if (tab) {
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

  // Default landing: the six Configure submodules.
  return (
    <div className="space-y-4">
      <PageHeader
        title="Master Data"
        description="Company-wide reference lists, grouped into six areas."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SUBMODULES.map((s) => {
          const count = submoduleChildCount(s);
          return (
            <HubCard
              key={s.slug}
              href={`/masters/${s.slug}`}
              title={s.label}
              subtitle={s.description}
              count={count}
              dashed={s.status === "provisional"}
            />
          );
        })}
      </div>
    </div>
  );
}
