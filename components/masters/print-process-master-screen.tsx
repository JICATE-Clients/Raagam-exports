"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import {
  createPrintProcess,
  updatePrintProcess,
  deletePrintProcess,
} from "@/lib/masters/print-process-actions";
import { PRINT_PROCESS_FLAGS, type PrintProcess } from "@/lib/masters/print-process-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const FLAG_KEYS = PRINT_PROCESS_FLAGS.map((f) => f.key);

const descriptor: SimpleMasterDescriptor<PrintProcess> = {
  entityLabel: "Print Process",
  ioEntityKey: "print-processes",
  status: "active",
  // Code is auto-generated from the name on create (client 2026-07-23: don't
  // ask users for codes) — backend-only, never shown or edited.
  fields: [
    { key: "name", label: "Name", required: true },
    // Process-type flags as inline checkbox columns (legacy grid had the same).
    ...PRINT_PROCESS_FLAGS.map((f) => ({ key: f.key, label: f.label, kind: "checkbox" as const })),
  ],
  mobileTitleKey: "name",
  fromRow: (r) => ({
    name: r.name,
    ...Object.fromEntries(FLAG_KEYS.map((k) => [k, r[k as keyof PrintProcess] as boolean])),
  }),
  searchText: (r) =>
    [
      r.code,
      r.name,
      ...PRINT_PROCESS_FLAGS.filter((f) => r[f.key as keyof PrintProcess]).map((f) => f.label),
    ]
      .filter(Boolean)
      .join(" "),
  statusOf: (r) => (r.is_active ? "active" : "inactive"),
  validate: (v) =>
    FLAG_KEYS.some((k) => v[k]) ? null : "At least one process type must be selected.",
  toPayload: (v, s) => ({
    code: "", // blank → create auto-generates; update keeps the stored code
    name: String(v.name),
    ...Object.fromEntries(FLAG_KEYS.map((k) => [k, !!v[k]])),
    is_active: s.active,
  }),
  // Live check mirrors the on-save name dup guard (codes are auto-generated).
  dupCheck: { table: "print_processes", fieldKey: "name" },
  actions: { create: createPrintProcess, update: updatePrintProcess, remove: deletePrintProcess },
};

export function PrintProcessMasterScreen({ rows, perms }: { rows: PrintProcess[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
