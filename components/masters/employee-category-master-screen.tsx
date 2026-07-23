"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import {
  createEmployeeCategory,
  updateEmployeeCategory,
  deleteEmployeeCategory,
} from "@/lib/masters/employee-category-actions";
import {
  EMPLOYEE_CATEGORY_FOR,
  type EmployeeCategory,
} from "@/lib/masters/employee-category-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

/**
 * Legacy HR "Employee Category" master — twin of Designation: Name · For
 * (Staff / Worker / Staff-Worker). Draft-capable via the inline status select
 * (`is_draft` persists exactly as before; short_name mirrors name).
 */
const descriptor: SimpleMasterDescriptor<EmployeeCategory> = {
  entityLabel: "Employee Category",
  status: "activeDraft",
  fields: [
    { key: "name", label: "Name", required: true },
    {
      key: "for_type",
      label: "For",
      kind: "select",
      required: true,
      options: EMPLOYEE_CATEGORY_FOR.map((f) => ({ value: f.value, label: f.label })),
      widthClass: "w-36",
    },
  ],
  fromRow: (r) => ({ name: r.name, for_type: r.for_type }),
  searchText: (r) => [r.name, r.for_type].filter(Boolean).join(" "),
  statusOf: (r) => (r.is_draft ? "draft" : r.inactive ? "inactive" : "active"),
  toPayload: (v, s) => ({
    short_name: String(v.name) || null,
    name: String(v.name),
    for_type: String(v.for_type),
    inactive: !s.active && !s.draft,
    is_draft: s.draft,
  }),
  actions: {
    create: createEmployeeCategory,
    update: updateEmployeeCategory,
    remove: deleteEmployeeCategory,
  },
};

export function EmployeeCategoryMasterScreen({ rows, perms }: { rows: EmployeeCategory[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
