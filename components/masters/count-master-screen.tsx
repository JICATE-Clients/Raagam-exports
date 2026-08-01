"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { createLookup, updateLookup, deleteLookup } from "@/lib/masters/extras-actions";
import type { ConfigLookup } from "@/lib/masters/extras-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

/**
 * Legacy "Count" master — backed by `config_lookups` kind `yarn_count`
 * (name→name, code mirrors name). The lookup-kind is bound here via the
 * payload, showing the closure/adapter shape other config-lookup masters use.
 */
const descriptor: SimpleMasterDescriptor<ConfigLookup> = {
  entityLabel: "Count",
  ioEntityKey: "counts",
  status: "active",
  fields: [
    {
      key: "name",
      label: "Name",
      required: true,
      format: "yarn_count",
      placeholder: "e.g. 10'S, 2/10'S, 40 DINER",
    },
  ],
  // Created Date / Created User are appended by the engine — see
  // components/ui/created-columns.tsx. This screen used to declare its own,
  // reading raw `created_by`; that is safe here (config_lookups stores a
  // legacy username as text) but was the template three uuid-backed screens
  // copied, where it printed a raw id.
  fromRow: (r) => ({ name: r.name }),
  searchText: (r) => [r.code, r.name].filter(Boolean).join(" "),
  statusOf: (r) => (r.is_active ? "active" : "inactive"),
  toPayload: (v, s) => ({
    kind: "yarn_count" as const,
    code: String(v.name) || null,
    name: String(v.name),
    notes: null,
    is_active: s.active,
  }),
  // Offers near-matching names already in THIS master while typing;
  // keyboard: down-arrow into the chips, Enter applies, Esc dismisses.
  spellSuggest: true,
  dupCheck: { table: "config_lookups", fieldKey: "name", scope: { kind: "yarn_count" } },
  actions: { create: createLookup, update: updateLookup, remove: deleteLookup },
};

export function CountMasterScreen({ rows, perms }: { rows: ConfigLookup[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
