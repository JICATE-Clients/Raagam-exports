"use client";

import { useMemo } from "react";
import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { createBin, updateBin, deleteBin } from "@/lib/masters/bin-actions";
import type { Bin } from "@/lib/masters/bin-types";
import { FIELD_WIDTH } from "@/components/ui/field";
import type { StoreRow } from "@/lib/masters/store-master-types";
type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };

/**
 * Bin master (Materials): Store (req) · Bin Code · Description · status.
 *
 * EVERY BIN IS IN A STORE (0800, user 2026-11-03). The Store replaced the Location box:
 * a bin's unit is now its store's, set by the database, so the two can never disagree,
 * and every bin box on GRN / Pending QC / the DCs offers only the chosen store's bins.
 * Bin Code may be left blank when the store has a Bin Prefix: it is numbered PREFIX +
 * 001, 002 … (createBin). Store options come from the dispatcher page (the unit's
 * active stores), so the descriptor is built inside the component to close over them.
 */
export function BinMasterScreen({
  rows,
  stores,
  perms,
}: {
  rows: Bin[];
  stores: StoreRow[];
  perms: Perms;
}) {
  const descriptor = useMemo<SimpleMasterDescriptor<Bin>>(() => {
    const storeLabel = new Map<string, string>();
    for (const st of stores) storeLabel.set(st.id, st.bin_prefix ? `${st.name} (${st.bin_prefix})` : st.name);
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
      /* COMPACT (erp-form-compact): each inline edit box takes a width from the
         shared vocabulary instead of filling its table column — Location and
         Description used to stretch across whatever the full-width table left
         them, and Bin Code carried a hand-typed `w-32`.
           store 176 · code 144 · description 288 */
      fields: [
        {
          key: "store_id",
          label: "Store",
          kind: "select",
          required: true,
          options: storeOptions,
          optionLabel: (v) => storeLabel.get(v) ?? "—",
          widthClass: FIELD_WIDTH.term, // 176px — a store name with its prefix
        },
        {
          key: "bin_code",
          label: "Bin Code",
          mono: true,
          // Blank = numbered from the store's Bin Prefix; createBin says so if it has none.
          placeholder: "Auto from prefix",
          widthClass: FIELD_WIDTH.code, // 144px — a short rack/bin code
        },
        {
          key: "description",
          label: "Description",
          widthClass: FIELD_WIDTH.name, // 288px — free text, the widest step
        },
      ],
      fromRow: (r) => ({
        store_id: r.store_id ?? "",
        bin_code: r.bin_code ?? "",
        description: r.description ?? "",
      }),
      searchText: (r) =>
        [
          r.bin_code,
          r.description,
          r.store?.name ?? (r.store_id ? storeLabel.get(r.store_id) : null),
        ]
          .filter(Boolean)
          .join(" "),
      statusOf: (r) => (r.inactive ? "inactive" : "active"),
      toPayload: (v, s) => ({
        bin_code: String(v.bin_code ?? ""),
        store_id: String(v.store_id),
        description: String(v.description) || null,
        inactive: !s.active,
      }),
      // Offers near-matching names already in THIS master while typing;
      // keyboard: down-arrow into the chips, Enter applies, Esc dismisses.
      spellSuggest: true,
      dupCheck: { table: "bins", fieldKey: "bin_code", nameColumn: "bin_code" },
      actions: { create: createBin, update: updateBin, remove: deleteBin },
    };
  }, [stores]);

  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
