"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { createItemClass, updateItemClass, deleteItemClass } from "@/lib/masters/extras-actions";
import type { Attribute } from "@/lib/masters/extras-types";
import { ITEM_CLASS_NAMES } from "@/lib/masters/name-vocabularies";
import { FIELD_WIDTH } from "@/components/ui/field";
import { fmtDateTime } from "@/lib/format";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

/**
 * Item Class master (doc/update.md #1-3) — the simple half of the Item Class /
 * Attribute split. Fields: Name + Has Attribute. Backed by config_lookups kind
 * 'item_class'. The per-class value list is EDITED on the Attribute screen (only
 * when Has Attribute is on) but is READ here, in the view sheet — "Has
 * Attribute: Yes" is not an answer to "which attributes?". The rows arrive with
 * `values` already attached (one join, same table), so the view fetches nothing.
 *
 * THE COMPONENT KIND OF UI (client 2026-09-29: "component fields la irukka
 * mari item class table um venum"). No dialog: the row itself becomes
 * editable, "+ Add" opens a row at the top — `SimpleMasterScreen`, the engine
 * Component, Count and ~20 other masters already run on. It had been a
 * hand-written screen with a Sheet holding one text box and a switch; the same
 * morning both switches moved into the list, and joining the engine is what
 * that was reaching for. Duplicate hold, spell-suggest chips, CAPS, the reload
 * guard, Status block/unblock and Created Date / User all come from the engine.
 *
 * `code` is never sent: create derives it from the name (`createItemClass`),
 * and an update without it leaves a legacy code as it was.
 */
const descriptor: SimpleMasterDescriptor<Attribute> = {
  entityLabel: "Item Class",
  status: "active",
  // Block / Unblock from the listing, not the form (client 2026-09-26, the
  // 08-17 rule for the Materials module).
  blockEntity: "item_class",
  fields: [
    {
      key: "name",
      label: "Name",
      required: true,
      // `party` (200px): a closed set of seven, the longest "PACKING
      // ACCESSORIES" (19 capitals); `term` (176) clips it.
      widthClass: FIELD_WIDTH.party,
    },
    { key: "has_attribute", label: "Has Attribute", kind: "checkbox" },
  ],
  extraColumns: [
    {
      header: "Attributes",
      cell: (r) => <span className="tabular-nums">{(r.values ?? []).length || "—"}</span>,
    },
  ],
  extraFilters: [
    {
      key: "attr",
      label: "Has Attribute",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
      predicate: (r, v) => (v === "yes" ? !!r.has_attribute : v === "no" ? !r.has_attribute : true),
    },
  ],
  fromRow: (r) => ({ name: r.name, has_attribute: !!r.has_attribute }),
  searchText: (r) => [r.code, r.name].filter(Boolean).join(" "),
  statusOf: (r) => (r.is_active ? "active" : "inactive"),
  view: (r) => [
    {
      label: "Details",
      pairs: [
        ["Has Attribute", r.has_attribute ? "Yes" : "No"],
        ["Attributes", (r.values ?? []).length],
        ["Notes", r.notes],
        ["Last Updated", fmtDateTime(r.updated_at)],
      ],
    },
    {
      // `content`, not `pairs`: an attribute is a name plus how it is answered
      // (a list of options, or a number). Never auto-hidden — "none defined yet"
      // on a class flagged Has Attribute is the whole point of looking.
      label: "Attributes",
      content: !r.has_attribute ? (
        <p className="text-sm text-muted-foreground">This class does not use attributes.</p>
      ) : (r.values ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No attributes defined yet — add them on Materials ▸ Attribute.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {(r.values ?? []).map((v) => (
            <li key={v.id} className="text-sm">
              <span className="font-medium text-foreground">{v.value}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {v.input_type === "option_list"
                  ? (v.options ?? []).length > 0
                    ? (v.options ?? []).map((o) => o.value).join(", ")
                    : "Option list — no options yet"
                  : "Numeric range"}
              </span>
            </li>
          ))}
        </ul>
      ),
    },
  ],
  toPayload: (v, s) => ({ name: String(v.name), has_attribute: !!v.has_attribute, is_active: s.active }),
  /**
   * "Did you mean SEWING ACCESSORIES?" — the duplicate check fires only on an
   * EXACT match, and every downstream master scopes itself by item class, so a
   * near-miss eighth class fragments all of them. Seeded from the closed set the
   * app reasons about; named here and imported nowhere else.
   */
  spellSuggest: { seed: ITEM_CLASS_NAMES },
  dupCheck: { table: "config_lookups", fieldKey: "name", scope: { kind: "item_class" } },
  actions: { create: createItemClass, update: updateItemClass, remove: deleteItemClass },
};

export function ItemClassMasterScreen({ rows, perms }: { rows: Attribute[]; perms: Perms }) {
  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
