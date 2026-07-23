"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import {
  createAdvanceLoanType,
  updateAdvanceLoanType,
  deleteAdvanceLoanType,
} from "@/lib/masters/advance-loan-type-actions";
import { LOAN_TYPES, type AdvanceLoanType } from "@/lib/masters/advance-loan-type-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

/**
 * Legacy "Advance and Loan Type" master (HR): Short Name (req) · Description ·
 * Loan Type (Salary Advance / Monthly Repayment / Loan).
 */
const descriptor: SimpleMasterDescriptor<AdvanceLoanType> = {
  entityLabel: "Advance / Loan Type",
  status: "active",
  fields: [
    { key: "short_name", label: "Short Name", required: true },
    { key: "description", label: "Description" },
    {
      key: "loan_type",
      label: "Type",
      kind: "select",
      required: true,
      options: LOAN_TYPES.map((t) => ({ value: t, label: t })),
      widthClass: "w-44",
    },
  ],
  fromRow: (r) => ({
    short_name: r.short_name,
    description: r.description ?? "",
    loan_type: r.loan_type,
  }),
  searchText: (r) => [r.short_name, r.description, r.loan_type].filter(Boolean).join(" "),
  statusOf: (r) => (r.inactive ? "inactive" : "active"),
  toPayload: (v, s) => ({
    short_name: String(v.short_name),
    description: String(v.description) || null,
    loan_type: String(v.loan_type),
    inactive: !s.active,
  }),
  actions: {
    create: createAdvanceLoanType,
    update: updateAdvanceLoanType,
    remove: deleteAdvanceLoanType,
  },
};

export function AdvanceLoanTypeMasterScreen({ rows, perms }: { rows: AdvanceLoanType[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
