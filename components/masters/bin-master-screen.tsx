"use client";

import { useMemo, useState } from "react";
import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { BinRack } from "@/components/masters/bin-rack";
import { Button } from "@/components/ui/button";
import { ViewToggle, useViewMode } from "@/components/ui/view-toggle";
import { createBinRange, updateBin, deleteBin } from "@/lib/masters/bin-actions";
import type { Bin } from "@/lib/masters/bin-types";
import type { BinStock } from "@/lib/masters/bin-service";
import { FIELD_WIDTH } from "@/components/ui/field";
import { fmtNumber } from "@/lib/format";
import type { StoreRow } from "@/lib/masters/store-master-types";
type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };

/**
 * Bin master (Materials). TWO VIEWS OF ONE LIST (user 2026-11-04, approved mockup):
 *
 *   Rack — the default. A store list beside the chosen store drawn as a physical rack
 *          (`BinRack`). "+ Add Bins" opens a one-line Prefix · From · To · Description
 *          row in the pane, filled from the store's own codes, and shows what Save makes.
 *   List — the master table: search, Status / Store filters, Created columns, Download,
 *          inline edit of Store and Description. Bin Code is fixed once made.
 *
 * ONE "+ Add Bins" for both, here, so the screen never shows two (AGENTS.md "Buttons:
 * one job, one button"). From the List it switches to the Rack, where bins are made.
 *
 * EVERY BIN IS IN A STORE (0800): its unit is the store's, set by the database, and
 * every bin box on GRN / Pending QC / the DCs offers only the chosen store's bins.
 */
export function BinMasterScreen({
  rows,
  stores,
  stock,
  perms,
}: {
  rows: Bin[];
  stores: StoreRow[];
  stock: Record<string, BinStock>;
  perms: Perms;
}) {
  const { view, setView } = useViewMode("bins", "cards");
  const [adding, setAdding] = useState(false);

  const descriptor = useMemo<SimpleMasterDescriptor<Bin>>(() => {
    const storeLabel = new Map<string, string>();
    for (const st of stores) storeLabel.set(st.id, st.name);
    // Offered: the active stores. A bin already in a switched-off store keeps showing it.
    const storeOptions = stores
      .filter((st) => st.is_active)
      .map((st) => ({ value: st.id, label: storeLabel.get(st.id) ?? st.name }));
    return {
      entityLabel: "Bin",
      ioEntityKey: "bins",
      status: "active",
      // Block / Unblock from the listing's ⋮ menu, not the form (client
      // 2026-09-26, the 08-17 rule for the Materials module) — see
      // `blockEntity` in simple-master-screen.tsx.
      blockEntity: "bin",
      mobileTitleKey: "bin_code",
      /* COMPACT: code 144 · store 176 · description 288 */
      fields: [
        // Bin Code leads: it is how a bin is known. Made by Prefix + From–To on the Rack
        // and fixed after that, so the inline edit shows it read-only.
        { key: "bin_code", label: "Bin Code", mono: true, lockedOnEdit: true, widthClass: FIELD_WIDTH.code },
        {
          key: "store_id",
          label: "Store",
          kind: "select",
          required: true,
          options: storeOptions,
          optionLabel: (v) => storeLabel.get(v) ?? "—",
          widthClass: FIELD_WIDTH.term, // 176px — a store name
        },
        {
          key: "description",
          label: "Description",
          widthClass: FIELD_WIDTH.name, // 288px — free text, the widest step
        },
      ],
      extraColumns: [
        {
          header: "Stock",
          cell: (r) => (stock[r.id] ? `${fmtNumber(stock[r.id].qty)} qty` : "—"),
        },
      ],
      extraFilters: [
        {
          key: "store",
          label: "Store",
          options: stores.map((st) => ({ value: st.id, label: st.name })),
          predicate: (r, v) => r.store_id === v,
        },
      ],
      fromRow: (r) => ({
        bin_code: r.bin_code ?? "",
        store_id: r.store_id ?? "",
        description: r.description ?? "",
      }),
      searchText: (r) =>
        [r.bin_code, r.description, r.store?.name ?? (r.store_id ? storeLabel.get(r.store_id) : null)]
          .filter(Boolean)
          .join(" "),
      statusOf: (r) => (r.inactive ? "inactive" : "active"),
      // The code goes back unchanged (it is locked on the row); updateBin re-checks it
      // against the other bins, excluding this one.
      toPayload: (v, s) => ({
        bin_code: String(v.bin_code ?? ""),
        store_id: String(v.store_id),
        description: String(v.description ?? "") || null,
        inactive: !s.active,
      }),
      // dup-check: exempt -- no bin code is typed here: codes come from Prefix + From–To on
      // the Rack, and createBinRange refuses a whole range when any code in it exists,
      // naming them. The Rack's own line shows the clash before Save. No typed name, so no
      // spell-suggest strip either.
      actions: { create: createBinRange, update: updateBin, remove: deleteBin },
    };
  }, [stores, stock]);

  const toolbar = (
    <>
      <ViewToggle value={view} onChange={setView} cardsLabel="Rack View" />
      {perms.canCreate && (
        <Button
          size="md"
          disabled={adding && view === "cards"}
          onClick={() => {
            setView("cards");
            setAdding(true);
          }}
        >
          + Add Bins
        </Button>
      )}
    </>
  );

  if (view === "cards") {
    return (
      <BinRack
        bins={rows}
        stores={stores}
        stock={stock}
        perms={perms}
        adding={adding}
        setAdding={setAdding}
        toolbar={toolbar}
      />
    );
  }
  // The List never adds (its own "+ Add" is off): bins are made as a range on the Rack.
  return (
    <SimpleMasterScreen
      rows={rows}
      perms={{ ...perms, canCreate: false }}
      descriptor={descriptor}
      toolbarExtra={toolbar}
    />
  );
}
