"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { createLookup, updateLookup, deleteLookup } from "@/lib/masters/extras-actions";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import { FIELD_WIDTH } from "@/components/ui/field";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

/**
 * Legacy "Knitting Dia" master — backed by `config_lookups` kind `knitting_dia`:
 * dia→code, description→name (falls back to dia). Shared lookup actions.
 */
const descriptor: SimpleMasterDescriptor<ConfigLookup> = {
  entityLabel: "Knitting Dia",
  ioEntityKey: "knitting-dias",
  status: "active",
  // Block / Unblock from the listing's ⋮ menu, not the form (client
  // 2026-09-26, the 08-17 rule for the Materials module) — see
  // `blockEntity` in simple-master-screen.tsx.
  blockEntity: "knitting_dia",
  fields: [
    // COMPACT (erp-form-compact) — widths from the shared vocabulary, not
    // hand-typed: a dia ("30", "34 OPEN") is a short code; the description is
    // free text.
    { key: "dia", label: "Dia", required: true, mono: true, widthClass: FIELD_WIDTH.range }, // 112px
    { key: "description", label: "Description", defaultsTo: "dia", widthClass: FIELD_WIDTH.name }, // 288px
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
  // Offers near-matching names already in THIS master while typing;
  // keyboard: down-arrow into the chips, Enter applies, Esc dismisses.
  spellSuggest: true,
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
