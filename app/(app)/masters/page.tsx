import { requirePermission, can } from "@/lib/auth/server";
import {
  listBuyers,
  listItems,
  listUoms,
  listCurrencies,
  listCustomersForPicker,
} from "@/lib/masters/service";
import {
  listConfigLookups,
  listTransporters,
  listGstRates,
} from "@/lib/masters/extras-service";
import { SUBMODULES, submoduleChildCount } from "@/lib/masters/submodules";
import { PageHeader } from "@/components/ui/page-header";
import { HubPage, type HubCardSpec } from "@/components/shell/group-hub";
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
      customers,
      lookups,
      transporters,
      gstRates,
      canCreate,
      canEdit,
      canExport,
      canDelete,
    ] = await Promise.all([
      listBuyers(),
      listItems(),
      listUoms(),
      listCurrencies(),
      // Feeds the Buyer ▸ Customer link, which is what lets an order reach that
      // party's nominated / recommended vendor lists (0380).
      listCustomersForPicker(),
      listConfigLookups(),
      listTransporters(),
      listGstRates(),
      can("masters", "create"),
      // Gates the pencil/bin inside the Currency picker on the Buyers form.
      can("masters", "edit"),
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
          customers={customers}
          lookups={lookups}
          transporters={transporters}
          gstRates={gstRates}
          initialTab={tab}
          canCreate={canCreate}
          canEdit={canEdit}
          canExport={canExport}
          canDelete={canDelete}
        />
      </div>
    );
  }

  // Default landing: the six Configure submodules.
  //
  // Every card here opens ANOTHER card grid, so each is a `hub` card: grid
  // glyph, chevron, and its number read as "N screens" rather than as a bare
  // figure that looks like a record count. That is the same number this page has
  // always shown (`submoduleChildCount`) — child masters, never rows — and the
  // shared card is what finally makes the two kinds of number distinguishable.
  const cards: HubCardSpec[] = SUBMODULES.map((s) => ({
    key: s.slug,
    href: `/masters/${s.slug}`,
    label: s.label,
    description: s.description,
    count: submoduleChildCount(s),
    dashed: s.status === "provisional",
    hub: true,
  }));

  return (
    <HubPage
      title="Master Data"
      description="Company-wide reference lists, grouped into six areas."
      cards={cards}
    />
  );
}
