"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import {
  createDefectGroup,
  updateDefectGroup,
  deleteDefectGroup,
} from "@/lib/masters/simple-master-actions";
import { DEFECT_GROUP_NAMES } from "@/lib/masters/name-vocabularies";

type Row = { id: string; code: string; name: string; is_active: boolean };
type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const descriptor: SimpleMasterDescriptor<Row> = {
  entityLabel: "Defect Group",
  ioEntityKey: "defect-groups",
  status: "active",
  // Code is auto-generated from the name on create (client 2026-07-23: don't
  // ask users for codes) — backend-only, never shown or edited.
  fields: [{ key: "name", label: "Name", required: true }],
  fromRow: (r) => ({ name: r.name }),
  searchText: (r) => [r.code, r.name].filter(Boolean).join(" "),
  statusOf: (r) => (r.is_active ? "active" : "inactive"),
  // Offers near-matching names — the curated vocabulary above plus the
  // rows already in THIS master — while typing;
  // keyboard: down-arrow into the chips, Enter applies, Esc dismisses.
  spellSuggest: { seed: DEFECT_GROUP_NAMES },
  dupCheck: { table: "defect_groups", fieldKey: "name", nameColumn: "name" },
  toPayload: (v, s) => ({
    code: "", // blank → create auto-generates; update keeps the stored code
    name: String(v.name),
    is_active: s.active,
  }),
  actions: { create: createDefectGroup, update: updateDefectGroup, remove: deleteDefectGroup },
};

export function DefectGroupMasterScreen({ rows, perms }: { rows: Row[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
