"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { createState, updateState, deleteState } from "@/lib/masters/state-actions";
import type { State } from "@/lib/masters/state-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

/**
 * Legacy "State" master (GST). Code (GST state code, validated) · State name ·
 * Default flag.
 */
const descriptor: SimpleMasterDescriptor<State> = {
  entityLabel: "State",
  status: "active",
  fields: [
    { key: "code", label: "Code", format: "gst_state", mono: true, widthClass: "w-24" },
    { key: "name", label: "State", required: true },
    { key: "is_default", label: "Default", kind: "checkbox" },
  ],
  fromRow: (r) => ({ code: r.code ?? "", name: r.name, is_default: r.is_default }),
  searchText: (r) => [r.code, r.name].filter(Boolean).join(" "),
  statusOf: (r) => (r.inactive ? "inactive" : "active"),
  toPayload: (v, s) => ({
    code: String(v.code) || null,
    name: String(v.name),
    is_default: !!v.is_default,
    inactive: !s.active,
  }),
  actions: { create: createState, update: updateState, remove: deleteState },
};

export function StateMasterScreen({ rows, perms }: { rows: State[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
