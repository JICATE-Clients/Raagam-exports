"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import {
  createProductionSection,
  updateProductionSection,
  deleteProductionSection,
} from "@/lib/masters/production-section-actions";
import {
  SECTION_FOR,
  SECTION_FOR_LABELS,
  type ProductionSection,
} from "@/lib/masters/production-section-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const FOR_OPTIONS = SECTION_FOR.map((v) => ({ value: v, label: SECTION_FOR_LABELS[v] }));

const descriptor: SimpleMasterDescriptor<ProductionSection> = {
  entityLabel: "Production Section",
  ioEntityKey: "production-sections",
  status: "active",
  // Code is auto-generated from the name on create (client 2026-07-23: don't
  // ask users for codes) — shown as a read-only column, never edited.
  fields: [
    { key: "name", label: "Name", required: true },
    { key: "section_for", label: "Section For", kind: "select", options: FOR_OPTIONS },
  ],
  extraColumns: [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
  ],
  mobileTitleKey: "name",
  mobileMeta: (r) => r.code,
  extraFilters: [
    {
      key: "sectionFor",
      label: "Section For",
      options: FOR_OPTIONS,
      predicate: (r, v) => r.section_for === v,
    },
  ],
  fromRow: (r) => ({ name: r.name, section_for: r.section_for ?? "" }),
  searchText: (r) =>
    [r.code, r.name, r.section_for ? SECTION_FOR_LABELS[r.section_for] : null]
      .filter(Boolean)
      .join(" "),
  statusOf: (r) => (r.is_active ? "active" : "inactive"),
  toPayload: (v, s) => ({
    code: "", // blank → create auto-generates; update keeps the stored code
    name: String(v.name),
    section_for: (v.section_for as (typeof SECTION_FOR)[number] | "") || null,
    is_active: s.active,
  }),
  actions: {
    create: createProductionSection,
    update: updateProductionSection,
    remove: deleteProductionSection,
  },
};

export function ProductionSectionMasterScreen({
  rows,
  perms,
}: {
  rows: ProductionSection[];
  perms: Perms;
}) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
