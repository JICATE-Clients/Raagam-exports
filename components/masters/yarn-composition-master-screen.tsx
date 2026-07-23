"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import {
  createYarnComposition,
  updateYarnComposition,
  deleteYarnComposition,
} from "@/lib/masters/simple-master-actions";

type Row = { id: string; code: string; name: string; is_active: boolean };
type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const descriptor: SimpleMasterDescriptor<Row> = {
  entityLabel: "Yarn Composition",
  ioEntityKey: "yarn-compositions",
  status: "active",
  // Code is auto-generated from the name on create (client 2026-07-23: don't
  // ask users for codes) — shown as a read-only column, never edited.
  fields: [{ key: "name", label: "Name", required: true }],
  extraColumns: [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
  ],
  mobileMeta: (r) => r.code,
  fromRow: (r) => ({ name: r.name }),
  searchText: (r) => [r.code, r.name].filter(Boolean).join(" "),
  statusOf: (r) => (r.is_active ? "active" : "inactive"),
  toPayload: (v, s) => ({
    code: "", // blank → create auto-generates; update keeps the stored code
    name: String(v.name),
    is_active: s.active,
  }),
  actions: {
    create: createYarnComposition,
    update: updateYarnComposition,
    remove: deleteYarnComposition,
  },
};

export function YarnCompositionMasterScreen({ rows, perms }: { rows: Row[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
