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
import { TIMING_GROUPS } from "@/lib/masters/group-timing-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

/**
 * Legacy HR "Employee Category" master — twin of Designation: Name · For
 * (Staff / Worker / Staff-Worker) · Timing Group (Staff / Security /
 * Production Staff, 0769). Draft-capable via the inline status select
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
      options: EMPLOYEE_CATEGORY_FOR.map((f) => ({ value: f.value, label: f.label })),
      widthClass: "w-36",
    },
    {
      // Which of the three fixed groups this category keeps the hours of
      // (client 2026-10-28: "Male Staff" and "Female Staff" both → Staff).
      // The hours themselves are on Master Data ▸ HR ▸ Work Timing.
      key: "timing_group",
      label: "Timing Group",
      kind: "select",
      required: true,
      options: TIMING_GROUPS.map((g) => ({ value: g.value, label: g.label })),
      widthClass: "w-44",
    },
  ],
  fromRow: (r) => ({ name: r.name, for_type: r.for_type, timing_group: r.timing_group ?? "" }),
  searchText: (r) =>
    [r.name, r.for_type, TIMING_GROUPS.find((g) => g.value === r.timing_group)?.label]
      .filter(Boolean)
      .join(" "),
  statusOf: (r) => (r.is_draft ? "draft" : r.inactive ? "inactive" : "active"),
  // Offers near-matching names — the curated vocabulary above plus the
  // rows already in THIS master — while typing;
  // keyboard: down-arrow into the chips, Enter applies, Esc dismisses.
  spellSuggest: { seed: EMPLOYEE_CATEGORY_NAMES },
  dupCheck: { table: "employee_categories", fieldKey: "name", nameColumn: "name" },
  toPayload: (v, s) => ({
    short_name: String(v.name) || null,
    name: String(v.name),
    for_type: String(v.for_type),
    timing_group: String(v.timing_group) as "staff" | "security" | "production_staff",
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
