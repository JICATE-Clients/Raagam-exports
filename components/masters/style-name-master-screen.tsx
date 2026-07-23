"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import {
  createStyleName,
  updateStyleName,
  deleteStyleName,
} from "@/lib/masters/style-name-actions";
import type { StyleName } from "@/lib/masters/style-name-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };

const descriptor: SimpleMasterDescriptor<StyleName> = {
  entityLabel: "Style Name",
  ioEntityKey: "style_names",
  status: "active",
  // Single identity field — labeled "Name" in the UI (client 2026-07-23 #6:
  // one name field per master); still stored in `short_name`.
  fields: [{ key: "short_name", label: "Name", required: true }],
  fromRow: (r) => ({ short_name: r.short_name }),
  searchText: (r) => r.short_name,
  statusOf: (r) => (r.inactive ? "inactive" : "active"),
  toPayload: (v, s) => ({
    short_name: String(v.short_name),
    inactive: !s.active,
  }),
  dupCheck: { table: "style_names", fieldKey: "short_name", nameColumn: "short_name" },
  actions: { create: createStyleName, update: updateStyleName, remove: deleteStyleName },
};

export function StyleNameMasterScreen({ rows, perms }: { rows: StyleName[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
