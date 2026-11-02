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
import { EMPLOYEE_CATEGORY_NAMES } from "@/lib/masters/name-vocabularies";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

/**
 * Legacy HR "Employee Category" master — twin of Designation: Name · For
 * (Staff / Worker). Timing Group (0769) is off this form (user 2026-10-30):
 * the stored value is never sent, so a save leaves it as it was. Draft-capable via the inline status select
 * (`is_draft` persists exactly as before; short_name mirrors name).
 */
const descriptor: SimpleMasterDescriptor<EmployeeCategory> = {
  entityLabel: "Employee Category",
  // Sheet, not inline row edit — the HR sub-module agreed on the Allowance
  // shape (client 2026-09-04). See `editor` in simple-master-screen.tsx.
  editor: "sheet",
  status: "activeDraft",
  fields: [
    { key: "name", label: "Name", required: true },
    {
      key: "for_type",
      label: "For",
      kind: "select",
      required: true,
      // Staff / Worker only — "Staff/Worker" is no longer offered (user
      // 2026-10-30). A row already holding it must be re-picked on edit.
      options: EMPLOYEE_CATEGORY_FOR.filter((f) => f.value !== "staff_worker").map((f) => ({
        value: f.value,
        label: f.label,
      })),
      widthClass: "w-36",
    },
  ],
  fromRow: (r) => ({ name: r.name, for_type: r.for_type === "staff_worker" ? "" : r.for_type }),
  searchText: (r) => [r.name, r.for_type].filter(Boolean).join(" "),
  statusOf: (r) => (r.is_draft ? "draft" : r.inactive ? "inactive" : "active"),
  // Offers near-matching names — the curated vocabulary above plus the
  // rows already in THIS master — while typing;
  // keyboard: down-arrow into the chips, Enter applies, Esc dismisses.
  spellSuggest: { seed: EMPLOYEE_CATEGORY_NAMES },
  dupCheck: { table: "employee_categories", fieldKey: "name", nameColumn: "name" },
  toPayload: (v, s) => ({
    short_name: String(v.name) || null,
    name: String(v.name),
    for_type: String(v.for_type) as "staff" | "worker",
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
