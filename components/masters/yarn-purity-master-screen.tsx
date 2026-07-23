"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { createLookup, updateLookup, deleteLookup } from "@/lib/masters/extras-actions";
import type { ConfigLookup } from "@/lib/masters/extras-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

/**
 * Legacy "Yarn Purity" master — backed by `config_lookups` kind `yarn_purity`
 * (name→name, code mirrors name). Shared lookup actions, no dedicated table.
 */
const descriptor: SimpleMasterDescriptor<ConfigLookup> = {
  entityLabel: "Yarn Purity",
  ioEntityKey: "yarn-purities",
  status: "active",
  fields: [{ key: "name", label: "Name", required: true }],
  fromRow: (r) => ({ name: r.name }),
  searchText: (r) => [r.code, r.name].filter(Boolean).join(" "),
  statusOf: (r) => (r.is_active ? "active" : "inactive"),
  toPayload: (v, s) => ({
    kind: "yarn_purity" as const,
    code: String(v.name) || null,
    name: String(v.name),
    notes: null,
    is_active: s.active,
  }),
  dupCheck: { table: "config_lookups", fieldKey: "name", scope: { kind: "yarn_purity" } },
  actions: { create: createLookup, update: updateLookup, remove: deleteLookup },
};

export function YarnPurityMasterScreen({ rows, perms }: { rows: ConfigLookup[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
