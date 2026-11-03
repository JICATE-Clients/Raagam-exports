"use client";

import { useMemo } from "react";
import { SimpleMasterScreen, type SimpleMasterDescriptor } from "@/components/masters/simple-master-screen";
import { createStore, updateStore, deleteStore } from "@/lib/masters/store-master-actions";
import type { StoreRow } from "@/lib/masters/store-master-types";
import { STORE_TYPES, STORE_TYPE_LABELS, SYSTEM_STORE_TYPES, type StoreType } from "@/lib/stores/types";
import { FIELD_WIDTH } from "@/components/ui/field";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };

/**
 * STORE MASTER (0800, user 2026-11-03), Materials beside Bins: the store rooms of the
 * unit you are working in.
 *
 *   Code (blank = generated, fixed once saved) · Store Name · Store Type (fixed once
 *   saved) · Bin Prefix · status.
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
    // A system type the unit already has is not offered for a NEW store; Storage always is.
    const held = new Set(rows.map((r) => r.store_type));
    const typeOptions = STORE_TYPES.filter((t) => t === "storage" || !SYSTEM_STORE_TYPES.includes(t) || !held.has(t)).map(
      (t) => ({ value: t, label: STORE_TYPE_LABELS[t] }),
    );
    return {
      entityLabel: "Store",
      status: "active",
      /* COMPACT: code 144 · name 288 · type 176 · prefix 144 */
      fields: [
        {
          key: "code",
          label: "Code",
          mono: true,
          placeholder: "Auto",
          lockedOnEdit: true,
          skipTab: true,
          widthClass: FIELD_WIDTH.code,
        },
        { key: "name", label: "Store Name", required: true, widthClass: FIELD_WIDTH.name },
        {
          key: "store_type",
          label: "Store Type",
          kind: "select",
          required: true,
          lockedOnEdit: true,
          options: typeOptions,
          optionLabel: (v) => STORE_TYPE_LABELS[v as StoreType] ?? v,
          widthClass: FIELD_WIDTH.term,
        },
        { key: "bin_prefix", label: "Bin Prefix", mono: true, placeholder: "E.g. YARN-", widthClass: FIELD_WIDTH.code },
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
