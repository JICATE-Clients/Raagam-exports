"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { createLookup, updateLookup, deleteLookup } from "@/lib/masters/extras-actions";
import type { ConfigLookup } from "@/lib/masters/extras-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

/**
 * Legacy "Knitting Dia" master — backed by `config_lookups` kind `knitting_dia`:
 * dia→code, description→name (falls back to dia). Shared lookup actions.
 */
const descriptor: SimpleMasterDescriptor<ConfigLookup> = {
  entityLabel: "Knitting Dia",
  ioEntityKey: "knitting-dias",
  status: "active",
  fields: [
    { key: "dia", label: "Dia", required: true, mono: true, widthClass: "w-32" },
    { key: "description", label: "Description", defaultsTo: "dia" },
  ],
  // name falls back to code when there's no distinct description
  fromRow: (r) => ({ dia: r.code ?? "", description: r.name === r.code ? "" : r.name }),
  searchText: (r) => [r.code, r.name].filter(Boolean).join(" "),
  statusOf: (r) => (r.is_active ? "active" : "inactive"),
  toPayload: (v, s) => ({
    kind: "knitting_dia" as const,
    code: String(v.dia) || null,
    name: String(v.description) || String(v.dia), // Description optional → fall back to Dia
    notes: null,
    is_active: s.active,
  }),
  dupCheck: {
    table: "config_lookups",
    fieldKey: "dia",
    scope: { kind: "knitting_dia" },
    // on-save guard checks the stored name, which falls back to Dia when Description is blank
    value: (v) => String(v.description) || String(v.dia),
  },
  actions: { create: createLookup, update: updateLookup, remove: deleteLookup },
};

export function KnittingDiaMasterScreen({ rows, perms }: { rows: ConfigLookup[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
