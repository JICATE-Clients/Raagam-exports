"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { createDivision, updateDivision, deleteDivision } from "@/lib/masters/division-actions";
import type { Division } from "@/lib/masters/division-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean; isSuperAdmin?: boolean };

const descriptor: SimpleMasterDescriptor<Division> = {
  entityLabel: "Division",
  ioEntityKey: "divisions",
  status: "active",
  fields: [
    { key: "division_id", label: "Division ID", mono: true, widthClass: "w-32" },
    { key: "division_name", label: "Division Name", required: true },
    { key: "document_prefix_id", label: "Doc Prefix", mono: true, widthClass: "w-32" },
  ],
  fromRow: (r) => ({
    division_id: r.division_id ?? "",
    division_name: r.division_name ?? "",
    document_prefix_id: r.document_prefix_id ?? "",
  }),
  searchText: (r) => [r.division_id, r.division_name].filter(Boolean).join(" "),
  statusOf: (r) => (r.inactive ? "inactive" : "active"),
  toPayload: (v, s) => ({
    division_id: String(v.division_id) || null,
    division_name: String(v.division_name) || null,
    document_prefix_id: String(v.document_prefix_id) || null,
    inactive: !s.active,
  }),
  dupCheck: { table: "divisions", fieldKey: "division_name", nameColumn: "division_name" },
  actions: { create: createDivision, update: updateDivision, remove: deleteDivision },
};

export function DivisionMasterScreen({ rows, perms }: { rows: Division[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
