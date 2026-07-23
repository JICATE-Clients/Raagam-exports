"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import {
  createDeduction,
  updateDeduction,
  deleteDeduction,
} from "@/lib/masters/deduction-actions";
import { CALC_TYPES, type Deduction } from "@/lib/masters/deduction-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

/**
 * Legacy "Deduction" master (HR): auto ID (entry_no) · Name · Sequence ·
 * Type (Fixed / Variable) · Base Head. The simpler sibling of Allowance.
 */
const descriptor: SimpleMasterDescriptor<Deduction> = {
  entityLabel: "Deduction",
  status: "active",
  fields: [
    { key: "name", label: "Name", required: true },
    { key: "sequence", label: "Seq", widthClass: "w-20" },
    {
      key: "calc_type",
      label: "Type",
      kind: "select",
      options: CALC_TYPES.map((t) => ({ value: t, label: t })),
      widthClass: "w-32",
    },
    { key: "base_head", label: "Base Head", kind: "checkbox" },
  ],
  extraColumns: [{ header: "ID", cell: (r) => r.entry_no }],
  fromRow: (r) => ({
    name: r.name,
    sequence: String(r.sequence),
    calc_type: r.calc_type ?? "",
    base_head: r.base_head,
  }),
  searchText: (r) => [String(r.entry_no), r.name, r.calc_type].filter(Boolean).join(" "),
  statusOf: (r) => (r.inactive ? "inactive" : "active"),
  toPayload: (v, s) => ({
    name: String(v.name),
    sequence: Number(v.sequence) || 0,
    calc_type: String(v.calc_type) || null,
    base_head: !!v.base_head,
    inactive: !s.active,
  }),
  actions: { create: createDeduction, update: updateDeduction, remove: deleteDeduction },
};

export function DeductionMasterScreen({ rows, perms }: { rows: Deduction[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
