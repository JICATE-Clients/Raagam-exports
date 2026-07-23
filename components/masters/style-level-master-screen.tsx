"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import {
  createStyleLevel,
  updateStyleLevel,
  deleteStyleLevel,
} from "@/lib/masters/style-level-actions";
import type { StyleLevel } from "@/lib/masters/style-level-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };

const descriptor: SimpleMasterDescriptor<StyleLevel> = {
  entityLabel: "Style Level",
  ioEntityKey: "style_levels",
  status: "active",
  fields: [
    { key: "level_name", label: "Level Name", required: true },
    { key: "level", label: "Level", widthClass: "w-24" },
  ],
  fromRow: (r) => ({
    level_name: r.level_name ?? r.level_short_name ?? "",
    level: r.level != null ? String(r.level) : "",
  }),
  searchText: (r) => [r.level_short_name, r.level_name].filter(Boolean).join(" "),
  statusOf: (r) => (r.inactive ? "inactive" : "active"),
  // legacy quirk preserved: level_name doubles as level_short_name
  toPayload: (v, s) => ({
    level_short_name: String(v.level_name),
    level_name: String(v.level_name) || null,
    level: String(v.level) ? Number(v.level) : null,
    inactive: !s.active,
  }),
  actions: { create: createStyleLevel, update: updateStyleLevel, remove: deleteStyleLevel },
};

export function StyleLevelMasterScreen({ rows, perms }: { rows: StyleLevel[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
