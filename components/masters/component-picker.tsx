"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DataPicker, type ManageConfig, type PickerRow } from "@/components/ui/data-picker";
import {
  createComponentQuick,
  updateComponent,
  deleteComponent,
} from "@/lib/masters/component-actions";
import { isInactive } from "@/lib/masters/inactive";

/** What a call site must hand over — the `components` master, narrowed. */
export type ComponentOption = {
  id: string;
  name: string;
  inactive?: boolean | null;
};

/**
 * The Component field — the physical parts of a garment (COLLAR, CUFF, POCKET)
 * from the `components` master (0228).
 *
 * A `DataPicker` **with inline Add / Modify / Delete**, where the same field used
 * to be a select-only `RecordPicker`. The client asked to add master data without
 * leaving the entry screen (2026-08-11), and Component was the only field on the
 * Style screen that could not: an audit of both order screens found every other
 * picker already carrying "+ Add", and `--check picker-perms` clean repo-wide.
 *
 * WHY THIS MASTER MAY HAVE AN INLINE FORM WHEN `RecordPicker` DELIBERATELY HAS
 * NONE. That picker's header states the rule and it is a good one: its targets
 * are records created on their own full screens, where the rest of their fields
 * live, so a name-only Vendor would be born unusable. A Component is the
 * exception, and not by an argument — by the client's own instruction. The
 * Components master screen was cut to ONE field on 2026-08-05 ("remove the
 * description field and maintain only name … and that check box"), so the name
 * IS the record. `description`, `all_coordinates` and the coordinate list stayed
 * in the database as optional, "not sent = not changed" columns reachable
 * through `lib/data-io` — which means a row created here is indistinguishable
 * from one created on the master, not a thinner version of it.
 *
 * So this uses the picker's OWN inline name form rather than an `onAddOverride`
 * sheet. The sheet exists for a master whose quick-create needs more than a name
 * — `CountryPicker` opens one because a Country carries the ISD code half a
 * dozen masters read off it. Opening a sheet to ask one question would be a
 * heavier surface saying exactly what the inline form already says.
 *
 * The list arrives as a server prop, so `extra` / `removed` merge this session's
 * writes over it — without them a component the operator just added is invisible
 * until `router.refresh()` lands, which is the one moment it must be selectable.
 */
export function ComponentPicker({
  components,
  value,
  onChange,
  canCreate,
  canEdit,
  canDelete,
  compact = false,
  required = false,
  label = "Component",
  id,
}: {
  components: ComponentOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  canCreate: boolean;
  canEdit: boolean;
  /** Defaults to `canEdit`, as every other CRUD picker does. The delete itself
   *  is guarded — a component any record references is deactivated, not
   *  removed. */
  canDelete?: boolean;
  /** Trigger-only (no label) for dense grid rows. */
  compact?: boolean;
  required?: boolean;
  label?: string;
  /** Lands on the trigger so `goToSection(..., { fieldId })` can focus it. */
  id?: string;
}) {
  const router = useRouter();

  const [extra, setExtra] = useState<ComponentOption[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);

  const all = useMemo(() => {
    const byId = new Map<string, ComponentOption>();
    for (const c of components) byId.set(c.id, c);
    for (const c of extra) byId.set(c.id, c); // session edits win
    for (const gone of removed) byId.delete(gone);
    return [...byId.values()];
  }, [components, extra, removed]);

  const rows: PickerRow[] = useMemo(
    () =>
      [...all]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ id: c.id, label: c.name, inactive: isInactive(c) })),
    [all],
  );

  const manage: ManageConfig | undefined =
    canCreate || canEdit || canDelete
      ? {
          canCreate,
          canEdit,
          canDelete: canDelete ?? canEdit,
          onCreate: (d) => createComponentQuick(d.name),
          /**
           * THE STATUS IS CARRIED, NOT ASSUMED. `componentInput.inactive`
           * defaults to `false`, so sending the name alone would quietly
           * REACTIVATE a disabled component on rename. Only one row can be in
           * that state here — the picker hides inactive rows, but the value a
           * record already holds stays on the field by design (AGENTS.md,
           * "Disabled rows") — and it is exactly the row a rename would reach.
           */
          onUpdate: (rowId, d) =>
            updateComponent(rowId, {
              short_name: d.name,
              inactive: isInactive(all.find((c) => c.id === rowId) ?? {}),
            }),
          onDelete: (rowId) => deleteComponent(rowId),
          onCreated: (newId, d) => {
            setExtra((xs) => [...xs, { id: newId, name: d.name.toUpperCase() }]);
            router.refresh();
          },
          onUpdated: (rowId, d) => {
            setExtra((xs) => {
              const base = all.find((c) => c.id === rowId);
              const next = { ...(base ?? { id: rowId }), name: d.name.toUpperCase() };
              return [...xs.filter((c) => c.id !== rowId), next as ComponentOption];
            });
            router.refresh();
          },
          onDeleted: (rowId, inactive) => {
            setRemoved((xs) => [...xs, rowId]);
            if (!inactive) setExtra((xs) => xs.filter((c) => c.id !== rowId));
            router.refresh();
          },
          // No Code input on create — `DataPicker` derives it from the name, and
          // `components` has no code column at all.
          draftOf: (row) => ({ code: "", name: row.label }),
          /**
           * The operator cannot see the master list from a Style row, so nothing
           * on screen tells them COLLAR already exists. Unscoped, matching the
           * server guard in `createComponentQuick`.
           */
          dupCheck: { table: "components", nameColumn: "short_name" },
        }
      : undefined;

  return (
    <DataPicker
      id={id}
      label={label}
      rows={rows}
      value={value}
      onChange={onChange}
      compact={compact}
      required={required}
      manage={manage}
    />
  );
}
