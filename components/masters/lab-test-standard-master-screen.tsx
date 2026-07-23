"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import {
  createLabTestStandard,
  updateLabTestStandard,
  deleteLabTestStandard,
} from "@/lib/masters/simple-master-actions";

type Row = { id: string; code: string; name: string; category: string | null; is_active: boolean };
type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const descriptor: SimpleMasterDescriptor<Row> = {
  entityLabel: "Lab Test Standard",
  ioEntityKey: "lab-test-standards",
  status: "active",
  // Code is auto-generated from the name on create (client 2026-07-23: don't
  // ask users for codes) — shown as a read-only column, never edited.
  fields: [
    { key: "name", label: "Name", required: true },
    { key: "category", label: "Category" },
  ],
  extraColumns: [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
  ],
  mobileTitleKey: "name",
  mobileMeta: (r) => r.code,
  fromRow: (r) => ({ name: r.name, category: r.category ?? "" }),
  searchText: (r) => [r.code, r.name, r.category].filter(Boolean).join(" "),
  statusOf: (r) => (r.is_active ? "active" : "inactive"),
  toPayload: (v, s) => ({
    code: "", // blank → create auto-generates; update keeps the stored code
    name: String(v.name),
    category: String(v.category) || null,
    is_active: s.active,
  }),
  actions: {
    create: createLabTestStandard,
    update: updateLabTestStandard,
    remove: deleteLabTestStandard,
  },
};

export function LabTestStandardMasterScreen({ rows, perms }: { rows: Row[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
