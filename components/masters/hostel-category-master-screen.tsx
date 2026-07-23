"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import {
  createHostelCategory,
  updateHostelCategory,
  deleteHostelCategory,
} from "@/lib/masters/hostel-category-actions";
import type { HostelCategory } from "@/lib/masters/hostel-category-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

/**
 * Legacy "Hostel Category" master (HR): Code (manual, optional) · Name (required).
 */
const descriptor: SimpleMasterDescriptor<HostelCategory> = {
  entityLabel: "Hostel Category",
  status: "active",
  fields: [
    { key: "code", label: "Code", mono: true, widthClass: "w-32" },
    { key: "name", label: "Name", required: true },
  ],
  fromRow: (r) => ({ code: r.code ?? "", name: r.name }),
  searchText: (r) => [r.code, r.name].filter(Boolean).join(" "),
  statusOf: (r) => (r.inactive ? "inactive" : "active"),
  toPayload: (v, s) => ({
    code: String(v.code) || null,
    name: String(v.name),
    inactive: !s.active,
  }),
  actions: {
    create: createHostelCategory,
    update: updateHostelCategory,
    remove: deleteHostelCategory,
  },
};

export function HostelCategoryMasterScreen({ rows, perms }: { rows: HostelCategory[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
