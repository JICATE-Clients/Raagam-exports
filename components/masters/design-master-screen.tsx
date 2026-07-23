"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { createDesign, updateDesign, deleteDesign } from "@/lib/masters/simple-master-actions";

type Row = { id: string; name: string; is_active: boolean };
type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const descriptor: SimpleMasterDescriptor<Row> = {
  entityLabel: "Design",
  ioEntityKey: "designs",
  status: "active",
  fields: [{ key: "name", label: "Name", required: true }],
  fromRow: (r) => ({ name: r.name }),
  searchText: (r) => r.name,
  statusOf: (r) => (r.is_active ? "active" : "inactive"),
  toPayload: (v, s) => ({ name: String(v.name), is_active: s.active }),
  dupCheck: { table: "designs", fieldKey: "name", nameColumn: "name" },
  actions: { create: createDesign, update: updateDesign, remove: deleteDesign },
};

export function DesignMasterScreen({ rows, perms }: { rows: Row[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
