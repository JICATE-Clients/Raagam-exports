"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { createPrintItem, updatePrintItem, deletePrintItem } from "@/lib/masters/print-item-actions";
import {
  PRINT_ITEM_TYPES,
  PRINT_ITEM_TYPE_LABELS,
  type PrintItem,
} from "@/lib/masters/print-item-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const TYPE_OPTIONS = PRINT_ITEM_TYPES.map((v) => ({ value: v, label: PRINT_ITEM_TYPE_LABELS[v] }));

const descriptor: SimpleMasterDescriptor<PrintItem> = {
  entityLabel: "Print Item",
  ioEntityKey: "print-items",
  status: "active",
  // Code is auto-generated from the name on create (client 2026-07-23: don't
  // ask users for codes) — shown as a read-only column, never edited.
  fields: [
    { key: "name", label: "Name", required: true },
    { key: "item_type", label: "Item Type", kind: "select", options: TYPE_OPTIONS },
  ],
  extraColumns: [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
  ],
  mobileTitleKey: "name",
  mobileMeta: (r) => r.code,
  extraFilters: [
    {
      key: "itemType",
      label: "Item Type",
      options: TYPE_OPTIONS,
      predicate: (r, v) => r.item_type === v,
    },
  ],
  fromRow: (r) => ({ name: r.name, item_type: r.item_type ?? "" }),
  searchText: (r) =>
    [r.code, r.name, r.item_type ? PRINT_ITEM_TYPE_LABELS[r.item_type] : null]
      .filter(Boolean)
      .join(" "),
  statusOf: (r) => (r.is_active ? "active" : "inactive"),
  toPayload: (v, s) => ({
    code: "", // blank → create auto-generates; update keeps the stored code
    name: String(v.name),
    item_type: (v.item_type as "A" | "Y" | "F" | "") || null,
    is_active: s.active,
  }),
  // Live check mirrors the on-save name dup guard (codes are auto-generated).
  dupCheck: { table: "print_items", fieldKey: "name" },
  actions: { create: createPrintItem, update: updatePrintItem, remove: deletePrintItem },
};

export function PrintItemMasterScreen({ rows, perms }: { rows: PrintItem[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
