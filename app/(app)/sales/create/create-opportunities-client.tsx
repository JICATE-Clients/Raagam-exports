"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/masters/filter-bar";
import { useToast } from "@/components/ui/toast";
import { useRowSelection } from "@/lib/data-io/use-row-selection";
import { createOpportunitiesForBuyers } from "@/lib/sales/actions";
import type { Buyer } from "@/lib/masters/types";

/**
 * Legacy "Create opportunities — By Customer": a bulk customer-selection grid.
 * Tag customers (Tag All / None / Toggle over the filtered set), optionally set
 * a shared Season, and create one opportunity per tagged customer.
 */
export function CreateOpportunitiesClient({
  buyers,
  canCreate,
}: {
  buyers: Buyer[];
  canCreate: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [season, setSeason] = useState("");
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState<"all" | string>("all");
  const sel = useRowSelection();

  const countries = useMemo(
    () =>
      [
        ...new Set(buyers.map((b) => b.country).filter((c): c is string => !!c)),
      ].sort((a, b) => a.localeCompare(b)),
    [buyers],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return buyers.filter((b) => {
      if (country !== "all" && b.country !== country) return false;
      if (q && !`${b.code} ${b.name}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [buyers, search, country]);

  const filteredIds = useMemo(() => filtered.map((b) => b.id), [filtered]);
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((b) => sel.selectedKeys.has(b.id));
  const count = sel.selectedIds.length;

  function submit() {
    if (!count) return;
    start(async () => {
      const res = await createOpportunitiesForBuyers({
        buyer_ids: sel.selectedIds,
        season: season.trim() || null,
      });
      if (res.ok) {
        success(
          `Created ${res.count} ${res.count === 1 ? "opportunity" : "opportunities"}.`,
        );
        sel.clear();
        router.push("/sales");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  const columns: Column<Buyer>[] = [
    { header: "Customer", cell: (b) => <span className="font-mono text-xs">{b.code}</span> },
    { header: "Customer Name", cell: (b) => <span className="text-foreground">{b.name}</span> },
    {
      header: "Country",
      cell: (b) =>
        b.country ?? <span className="text-muted-foreground">—</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Create Opportunities"
        description="Select customers and create one opportunity for each."
        actions={
          <Link href="/sales">
            <Button variant="outline" size="sm">
              ← Sales Pipeline
            </Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-48">
          <Label htmlFor="season">Season (optional)</Label>
          <Input
            id="season"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            placeholder="e.g. SS26"
          />
        </div>
        {canCreate && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => sel.selectAll(filteredIds)}
              disabled={!filtered.length}
            >
              Tag All
            </Button>
            <Button variant="outline" size="sm" onClick={sel.clear} disabled={!count}>
              None
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => sel.invert(filteredIds)}
              disabled={!filtered.length}
            >
              Toggle
            </Button>
          </div>
        )}
      </div>

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search customer code or name…"
        activeCount={country !== "all" ? 1 : 0}
        onReset={() => setCountry("all")}
        right={`${filtered.length} of ${buyers.length}`}
      >
        <div>
          <Label htmlFor="flt-country">Country</Label>
          <Select
            id="flt-country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          >
            <option value="all">All</option>
            {countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
      </FilterBar>

      {canCreate && count > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface/95 px-3 py-2 shadow-sm backdrop-blur">
          <span className="text-sm font-medium">{count} selected</span>
          <div className="flex-1" />
          <Button size="sm" onClick={submit} disabled={isPending}>
            {isPending
              ? "Creating…"
              : `Create ${count} ${count === 1 ? "opportunity" : "opportunities"}`}
          </Button>
          <button
            type="button"
            onClick={sel.clear}
            aria-label="Clear selection"
            className="ml-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={filtered}
        getKey={(b) => b.id}
        empty="No customers match your filter."
        selectable={canCreate}
        selectedKeys={sel.selectedKeys}
        onToggle={sel.toggle}
        onToggleAll={() =>
          allFilteredSelected ? sel.deselect(filteredIds) : sel.selectAll(filteredIds)
        }
      />
    </div>
  );
}
