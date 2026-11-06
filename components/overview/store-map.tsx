import Link from "next/link";
import { Warehouse } from "lucide-react";
import { Truncated } from "@/components/ui/truncated";
import { Dot, MOOD_COLOUR } from "@/components/viz/kit";
import { STORE_ICON } from "@/components/purchase/inventory/store-icons";
import { fmtCompactInr } from "@/lib/dashboard/format";
import { tileMood, type StoreTile } from "@/lib/overview/stores";

/**
 * "WHERE IS THE STOCK?" — the store map (Stores ▸ Overview, wave 3, 2026-11-06). One tile per
 * store of the unit, with its own per-type icon (the Store Overview tabs' icons), how full its
 * bins are, how many lots, the oldest lot's age and anything on the floor. A tile OPENS THAT
 * STORE on Purchase ▸ Purchase Store ▸ Overview (`?store=`), so the rack is drawn in one place.
 */
export function StoreMap({ tiles, withValue }: { tiles: StoreTile[]; withValue: boolean }) {
  if (!tiles.length) return <p className="px-3.5 py-3 text-sm text-muted-foreground">No store is set up in this unit.</p>;
  return (
    <ul className="grid gap-2.5 px-3.5 py-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {tiles.map((t) => {
        const Icon = STORE_ICON[t.type] ?? Warehouse;
        const mood = tileMood(t);
        const colour = MOOD_COLOUR[mood];
        const fill = t.bins ? Math.round((t.binsUsed / t.bins) * 100) : null;
        return (
          <li key={t.id}>
            <Link
              href={`/purchase/inventory?store=${t.id}`}
              className="block rounded-lg border border-border bg-surface px-3 py-2.5 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary-soft text-primary">
                  <Icon aria-hidden className="size-4" />
                </span>
                <Truncated text={t.name} className="block min-w-0 flex-1 text-[13px] font-semibold" />
                <Dot colour={colour} />
              </div>
              {/* Bins: a bar, how full; a store with no bins says so instead of an empty bar. */}
              <div className="mt-2">
                {fill != null ? (
                  <>
                    <div className="h-2 rounded bg-surface-muted">
                      <div className="h-full rounded" style={{ width: `${Math.max(fill ? 3 : 0, fill)}%`, background: "var(--primary)", boxShadow: "0 0 8px -2px var(--primary)" }} />
                    </div>
                    <p className="mt-1 text-[11.5px] text-muted-foreground tabular-nums">
                      {t.binsUsed} of {t.bins} bins in use
                    </p>
                  </>
                ) : (
                  <p className="text-[11.5px] text-muted-foreground">No bins — stock is held by store only</p>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] tabular-nums">
                <span>
                  <b className="font-semibold">{t.lots}</b> lot{t.lots === 1 ? "" : "s"}
                </span>
                {t.oldest != null ? <span className="text-muted-foreground">oldest {t.oldest} d</span> : null}
                {withValue && t.value ? <span className="text-muted-foreground">{fmtCompactInr(t.value)}</span> : null}
                {t.floor ? <span className="font-semibold text-warning">{t.floor} on the floor</span> : null}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
