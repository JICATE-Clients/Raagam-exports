"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import {
  createDesignation,
  updateDesignation,
  deleteDesignation,
} from "@/lib/masters/designation-actions";
import { DESIGNATION_FOR, type Designation } from "@/lib/masters/designation-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

/**
 * Legacy HR "Designation" master: Designation (name) · For (Staff / Worker /
 * Staff-Worker). Draft-capable — the inline status select offers
 * Active / Inactive / Draft (`is_draft` persists exactly as before).
 */
const descriptor: SimpleMasterDescriptor<Designation> = {
  entityLabel: "Designation",
  status: "activeDraft",
  fields: [
    { key: "name", label: "Designation", required: true },
    {
      key: "for_type",
      label: "For",
      kind: "select",
      required: true,
      options: DESIGNATION_FOR.map((f) => ({ value: f.value, label: f.label })),
      widthClass: "w-36",
    },
  ],
  fromRow: (r) => ({ name: r.name, for_type: r.for_type }),
  searchText: (r) => [r.name, r.for_type].filter(Boolean).join(" "),
  statusOf: (r) => (r.is_draft ? "draft" : r.inactive ? "inactive" : "active"),
  toPayload: (v, s) => ({
    name: String(v.name),
    for_type: String(v.for_type),
    inactive: !s.active && !s.draft,
    is_draft: s.draft,
  }),
  actions: { create: createDesignation, update: updateDesignation, remove: deleteDesignation },
};

export function DesignationMasterScreen({ rows, perms }: { rows: Designation[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
