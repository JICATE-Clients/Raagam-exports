"use client";

import { useMemo } from "react";
import { SimpleMasterScreen, type SimpleMasterDescriptor } from "@/components/masters/simple-master-screen";
import { createStore, updateStore, deleteStore } from "@/lib/masters/store-master-actions";
import type { StoreRow } from "@/lib/masters/store-master-types";
import { STORE_TYPE_LABELS } from "@/lib/stores/types";
import { FIELD_WIDTH } from "@/components/ui/field";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };

/**
 * STORE MASTER (0800, user 2026-11-03), Materials beside Bins: the store rooms of the
 * unit you are working in.
 *
 *   Store Name · status. (2026-11-04: Store Type, Code and Bin Prefix are no longer
 *   shown — new stores are Storage, their code is generated, and they carry no prefix.)
 *
 * Material, Purchase, Processing, Rejection, Surplus and In Transit are the SYSTEM types:
 * one each per unit, and the system routes stock into them by type (a GRN's rejected qty
 * goes to the Rejection store, and so on). New stores are normally Storage: Yarn Store,
 * Fabric Store. The database refuses a second system store in a unit, and a type change
 * after saving, since either would silently re-route stock.
 *
 * Bin Prefix: a bin added to this store with no code is numbered PREFIX + 001 (Bins).
 */
export function StoreMasterScreen({ rows, perms }: { rows: StoreRow[]; perms: Perms }) {
  const descriptor = useMemo<SimpleMasterDescriptor<StoreRow>>(() => {
    return {
      entityLabel: "Store",
      status: "active",
      /* COMPACT: name 288 — the only field left */
      mobileTitleKey: "name",
      fields: [
        // Code column hidden (user 2026-11-04). The code is still generated on save —
        // blankValues carries no `code`, so toPayload sends "" and the action numbers
        // it; an edit sends back the row's own code via fromRow, so it never changes.
        { key: "name", label: "Store Name", required: true, widthClass: FIELD_WIDTH.name },
        // Store Type removed from the form (user 2026-11-04: "no need"). A new store
        // saves as Storage (toPayload's default); an edit keeps the type it already has
        // (fromRow carries it), so a system store is never re-typed by a save.
        // Bin Prefix hidden (user 2026-11-04). A new store saves with no prefix, so its
        // bins take a typed code (nextBinCode returns null); an edit sends back the
        // store's existing prefix via fromRow, so stores that have one keep it.
      ],
      fromRow: (r) => ({
        code: r.code ?? "",
        name: r.name ?? "",
        store_type: r.store_type ?? "storage",
        bin_prefix: r.bin_prefix ?? "",
      }),
      searchText: (r) => [r.code, r.name, STORE_TYPE_LABELS[r.store_type], r.bin_prefix].filter(Boolean).join(" "),
      statusOf: (r) => (r.is_active ? "active" : "inactive"),
      toPayload: (v, s) => ({
        code: String(v.code ?? ""),
        name: String(v.name),
        store_type: String(v.store_type || "storage"),
        bin_prefix: String(v.bin_prefix ?? "") || null,
        is_active: s.active,
      }),
      spellSuggest: true,
      dupCheck: { table: "stores", fieldKey: "name", nameColumn: "name" },
      actions: { create: createStore, update: updateStore, remove: deleteStore },
    };
  }, [rows]);

  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
