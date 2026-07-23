"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import {
  createStyleStockCategory,
  updateStyleStockCategory,
  deleteStyleStockCategory,
} from "@/lib/masters/simple-master-actions";

type Row = { id: string; code: string; is_active: boolean };
type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const descriptor: SimpleMasterDescriptor<Row> = {
  entityLabel: "Style Stock Category",
  ioEntityKey: "style-stock-categories",
  status: "active",
  // `code` is this table's only data column — the form asks for a Name and
  // stores it as the code (code = name convention; client 2026-07-23: forms
  // must not ask for codes).
  fields: [{ key: "code", label: "Name", required: true }],
  fromRow: (r) => ({ code: r.code }),
  searchText: (r) => r.code,
  statusOf: (r) => (r.is_active ? "active" : "inactive"),
  toPayload: (v, s) => ({ code: String(v.code), is_active: s.active }),
  dupCheck: { table: "style_stock_categories", fieldKey: "code", nameColumn: "code" },
  actions: {
    create: createStyleStockCategory,
    update: updateStyleStockCategory,
    remove: deleteStyleStockCategory,
  },
};

export function StyleStockCategoryMasterScreen({ rows, perms }: { rows: Row[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
