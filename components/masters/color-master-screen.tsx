"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { createColor, updateColor, deleteColor } from "@/lib/masters/color-actions";
import type { Color } from "@/lib/masters/color-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };

const descriptor: SimpleMasterDescriptor<Color> = {
  entityLabel: "Color",
  ioEntityKey: "colors",
  status: "active",
  fields: [{ key: "color_name", label: "Color Name", required: true }],
  fromRow: (r) => ({ color_name: r.color_name ?? "" }),
  searchText: (r) => r.color_name ?? "",
  statusOf: (r) => (r.inactive ? "inactive" : "active"),
  toPayload: (v, s) => ({
    color_name: String(v.color_name) || null,
    inactive: !s.active,
  }),
  dupCheck: { table: "colors", fieldKey: "color_name", nameColumn: "color_name" },
  actions: { create: createColor, update: updateColor, remove: deleteColor },
};

export function ColorMasterScreen({ rows, perms }: { rows: Color[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
