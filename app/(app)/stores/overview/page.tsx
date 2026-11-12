import { requirePermission } from "@/lib/auth/server";
import { inventoryDashboard, pendingQcCount } from "@/lib/reports/stock-statement-service";
import { unitStoresAndBins } from "@/lib/stores/unit-layout";
import { today } from "@/lib/dashboard/range";
import { storesOverview, type StoreTile } from "@/lib/overview/stores";
import { asOfNow } from "@/lib/overview/words";
import { NeedsDoing, Strip, VizCard } from "@/components/viz/kit";
import { LoadError } from "@/components/analytics/board-ui";
import { MoreLinks, OverviewHeader, Say } from "@/components/overview/frame";
import { StoreMap } from "@/components/overview/store-map";

/**
 * STORES ▸ OVERVIEW — "Where is the stock, and what is waiting on the store?" (wave 3,
 * 2026-11-06). Replaces a card grid of four Purchase screens and a tile per store; the store
 * screens moved to Purchase on 2026-11-02, so this page is a MAP of the unit's stores whose
 * tiles open Purchase ▸ Purchase Store ▸ Overview on that store (`?store=`). The rack lives
 * there only. Stock is read from the same layers that screen reads (`inventoryDashboard`).
 */
export default async function StoresOverviewPage() {
  await requirePermission("stores", "view");
  const t = today();
  const asOf = asOfNow();
  const header = <OverviewHeader title="Stores" question="Where is the stock, and what is waiting on the store?" who={null} mine={0} everyone={0} asOf={asOf} />;

  let layout: Awaited<ReturnType<typeof unitStoresAndBins>>;
  let read: Awaited<ReturnType<typeof inventoryDashboard>>;
  try {
    [layout, read] = await Promise.all([unitStoresAndBins(), inventoryDashboard(t)]);
  } catch (e) {
    return (
      <div className="space-y-3">
        {header}
        <LoadError message={e instanceof Error ? e.message : String(e)} />
      </div>
    );
  }
  const qc = await pendingQcCount().catch(() => null);

  const rows = read.rows as { store: string; bin: string; age_days: number; value?: number | null }[];
  const tiles: StoreTile[] = layout.stores.map((s) => {
    const mine = rows.filter((r) => r.store === s.name);
    const bins = layout.bins.filter((b) => b.store_id === s.id && !b.inactive);
    const inBin = new Set(mine.filter((r) => r.bin && r.bin !== "—").map((r) => r.bin));
    return {
      id: s.id,
      name: s.name,
      type: s.store_type,
      bins: bins.length,
      binsUsed: bins.filter((b) => b.bin_code && inBin.has(b.bin_code)).length,
      lots: mine.length,
      // On the floor only where the store HAS bins — a binless store holds stock by store.
      floor: bins.length ? mine.filter((r) => !r.bin || r.bin === "—").length : 0,
      oldest: mine.length ? Math.max(...mine.map((r) => r.age_days)) : null,
      value: read.access === "value" ? mine.reduce((a, r) => a + (Number(r.value) || 0), 0) : null,
    };
  });
  // Stores holding stock first, then the rest — the busy ones are what the operator came for.
  tiles.sort((a, b) => b.lots - a.lots || a.name.localeCompare(b.name));
  const o = storesOverview(tiles, qc);

  return (
    <div className="space-y-2.5">
      {header}
      {read.access === "none" ? (
        <p className="text-xs text-muted-foreground">
          Stock figures come from the Stock Statement reports, and this login has no Reports access — the stores are listed without their stock.
        </p>
      ) : null}
      <Say lines={o.say} />
      <Strip compact cells={o.strip} />
      <VizCard title="Where is the stock?" question="One tile per store in this unit · a tile opens that store's rack on Store Overview">
        <StoreMap tiles={tiles} withValue={read.access === "value"} />
      </VizCard>
      <NeedsDoing compact cells={o.needs} />
      <MoreLinks
        links={[
          { href: "/purchase/inventory", label: "Store Overview" },
          { href: "/stores/qc-pending", label: "Pending QC" },
          { href: "/analytics/stock", label: "Stock board" },
        ]}
      />
    </div>
  );
}
