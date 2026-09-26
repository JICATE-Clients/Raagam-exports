"use client";

import { useMemo } from "react";
import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { createBin, updateBin, deleteBin } from "@/lib/masters/bin-actions";
import type { Bin } from "@/lib/masters/bin-types";
import { FIELD_WIDTH } from "@/components/ui/field";

type LocationOption = { id: string; code: string | null; name: string | null };
type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };

/**
 * Bin master (Materials): Bin Code (req) · Location (opt, simple dropdown) ·
 * Description · status. Location options come from the dispatcher page, so the
 * descriptor is built inside the component to close over them.
 */
export function BinMasterScreen({
  rows,
  locations,
  perms,
}: {
  rows: Bin[];
  locations: LocationOption[];
  perms: Perms;
}) {
  const descriptor = useMemo<SimpleMasterDescriptor<Bin>>(() => {
    const locationLabel = new Map<string, string>();
    for (const l of locations) locationLabel.set(l.id, l.name ?? l.code ?? "—");
    return {
      entityLabel: "Bin",
      ioEntityKey: "bins",
      status: "active",
      /* COMPACT (erp-form-compact): each inline edit box takes a width from the
         shared vocabulary instead of filling its table column — Location and
         Description used to stretch across whatever the full-width table left
         them, and Bin Code carried a hand-typed `w-32`.
           code 144 · location 176 · description 288 */
      fields: [
        {
          key: "bin_code",
          label: "Bin Code",
          required: true,
          mono: true,
          widthClass: FIELD_WIDTH.code, // 144px — a short rack/bin code
        },
        {
          key: "location_id",
          label: "Location",
          kind: "select",
          options: locations.map((l) => ({ value: l.id, label: l.name ?? l.code ?? "—" })),
          widthClass: FIELD_WIDTH.term, // 176px — a store / godown name
        },
        {
          key: "description",
          label: "Description",
          widthClass: FIELD_WIDTH.name, // 288px — free text, the widest step
        },
      ],
      fromRow: (r) => ({
        bin_code: r.bin_code ?? "",
        location_id: r.location_id ?? "",
        description: r.description ?? "",
      }),
      searchText: (r) =>
        [
          r.bin_code,
          r.description,
          r.location?.name ?? (r.location_id ? locationLabel.get(r.location_id) : null),
        ]
          .filter(Boolean)
          .join(" "),
      statusOf: (r) => (r.inactive ? "inactive" : "active"),
      toPayload: (v, s) => ({
        bin_code: String(v.bin_code),
        location_id: String(v.location_id) || null,
        description: String(v.description) || null,
        inactive: !s.active,
      }),
      // Offers near-matching names already in THIS master while typing;
      // keyboard: down-arrow into the chips, Enter applies, Esc dismisses.
      spellSuggest: true,
      dupCheck: { table: "bins", fieldKey: "bin_code", nameColumn: "bin_code" },
      actions: { create: createBin, update: updateBin, remove: deleteBin },
    };
  }, [locations]);

  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
