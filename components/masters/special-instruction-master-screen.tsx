"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import {
  createSpecialInstruction,
  updateSpecialInstruction,
  deleteSpecialInstruction,
} from "@/lib/masters/simple-master-actions";

type Row = { id: string; code: string; description: string; is_active: boolean };
type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const descriptor: SimpleMasterDescriptor<Row> = {
  entityLabel: "Special Instruction",
  ioEntityKey: "special-instructions",
  status: "active",
  // Code is auto-generated from the description on create (client 2026-07-23:
  // don't ask users for codes) — backend-only, never shown or edited.
  fields: [{ key: "description", label: "Description", required: true }],
  fromRow: (r) => ({ description: r.description }),
  searchText: (r) => [r.code, r.description].filter(Boolean).join(" "),
  statusOf: (r) => (r.is_active ? "active" : "inactive"),
  toPayload: (v, s) => ({
    code: "", // blank → create auto-generates; update keeps the stored code
    description: String(v.description),
    is_active: s.active,
  }),
  actions: {
    create: createSpecialInstruction,
    update: updateSpecialInstruction,
    remove: deleteSpecialInstruction,
  },
};

export function SpecialInstructionMasterScreen({ rows, perms }: { rows: Row[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
