"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import {
  createComponent,
  updateComponent,
  deleteComponent,
} from "@/lib/masters/component-actions";
import type { Component } from "@/lib/masters/component-types";
import { GARMENT_COMPONENT_NAMES } from "@/lib/masters/name-vocabularies";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

/**
 * Legacy "Component" master — the physical parts of a garment (COLLAR, CUFF,
 * POCKET). ONE FIELD: the name.
 *
 * It was a 450-line hand-written screen with a full-screen Sheet, and the client
 * asked for "the Count kind of UI" (2026-08-05, screenshots 2173/2174): no
 * dialog at all, the row itself becomes editable, "+ Add" opens a row at the top
 * of the list. That is `SimpleMasterScreen`, which 16 masters already use — so
 * the fix is to JOIN that tier, not to re-lay-out a bespoke editor. What the
 * screenshot showed is what a bespoke editor costs: a naked "All Coordinates"
 * checkbox rendered outside the Details card with nothing aligning it, and a
 * two-column body whose right half was empty in the default state.
 *
 * THREE COLUMNS LEFT THE FORM AND STAYED IN THE DATABASE — Description, All
 * Coordinates, and the Coordinates child list ("remove the description field and
 * maintain only name instead of short name label and that check box"). That is
 * the minimal-forms rule, not a schema change: `componentInput` marks all three
 * OPTIONAL and the actions patch only what is sent, so a rename here cannot
 * blank a description or delete a coordinate list it can no longer see. They
 * stay reachable through `lib/data-io` import/export, which is the documented
 * door for a legacy column the screen does not ask for.
 *
 * `short_name` is the DB column and the label is "Name", deliberately: the
 * record has exactly one name now, so calling it "Short" invites the question
 * "short for what?". Renaming the column would be a migration and 4 files for a
 * caption.
 */
const descriptor: SimpleMasterDescriptor<Component> = {
  entityLabel: "Component",
  ioEntityKey: "components",
  status: "active",
  fields: [{ key: "name", label: "Name", required: true }],
  fromRow: (r) => ({ name: r.short_name }),
  searchText: (r) => [r.short_name, r.description].filter(Boolean).join(" "),
  statusOf: (r) => (r.inactive ? "inactive" : "active"),
  /**
   * THE EYE STILL SHOWS WHAT THE RECORD HOLDS, including the three columns the
   * form stopped asking for. Dropping a field from a form is not the same as
   * pretending the value is not there — a component imported with a description,
   * or restricted to TOP before this change, must still be readable by the
   * operator looking at it.
   *
   * Declared rather than left to `pairsFromRow`, which would label this "Short
   * Name" (its own override list) while the column above says "Name" — the same
   * field, two words, on one screen.
   */
  view: (r) => [
    {
      label: "Component",
      pairs: [
        ["Name", r.short_name],
        ["Description", r.description],
        [
          "Coordinates",
          r.all_coordinates
            ? "All"
            : r.coordinates.length
              ? r.coordinates.map((c) => c.coordinate).join(", ")
              : null,
        ],
      ],
    },
  ],
  /**
   * The name and the status, and nothing else. Every key left out is a key the
   * update action will not touch — see the "not sent = not changed" note in
   * component-actions.ts. On a NEW row the table's own defaults apply
   * (`all_coordinates` true, `description` null), which is the legacy default.
   */
  toPayload: (v, s) => ({ short_name: String(v.name), inactive: !s.active }),
  /**
   * A real trade vocabulary, so the strip has something to offer on an empty
   * table — COLLAR beside a typed COLLER. Named at the call site because a seed
   * belongs to ONE master (AGENTS.md, "Near misses").
   */
  spellSuggest: { seed: GARMENT_COMPONENT_NAMES },
  dupCheck: { table: "components", fieldKey: "name", nameColumn: "short_name" },
  actions: { create: createComponent, update: updateComponent, remove: deleteComponent },
};

export function ComponentMasterScreen({ rows, perms }: { rows: Component[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
