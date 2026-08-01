"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DataPicker, type ManageConfig, type PickerRow } from "@/components/ui/data-picker";
import {
  createDefectGroup,
  updateDefectGroup,
  deleteDefectGroup,
} from "@/lib/masters/simple-master-actions";
import type { DefectGroup } from "@/lib/masters/defect-detail-types";
import { isInactive } from "@/lib/masters/inactive";

/**
 * Picker over the `defect_groups` master — the "Defect Group" field on Defect
 * Detail.
 *
 * Gets inline **Add / Modify / Delete**, unlike `RecordPicker`'s vendors and
 * customers: a Defect Group is a name and nothing else (its own screen is a
 * `SimpleMasterScreen` with one field, the code auto-generates), so a row
 * created from here is a complete row, not a stub. That is the same test
 * `LookupDialogPicker` passes — this one only exists because defect groups sit
 * in their own table rather than under a `config_lookups` kind.
 *
 * A ~40-line adapter over the ONE picker (`components/ui/data-picker.tsx`); see
 * doc/ui/LAYOUT.md §5a. Do not add a second picker shell.
 */
export function DefectGroupPicker({
  label = "Defect Group",
  groups,
  value,
  onChange,
  canCreate = false,
  canEdit = false,
  canDelete = false,
  compact = false,
}: {
  label?: string;
  groups: DefectGroup[];
  value: string;
  onChange: (v: string) => void;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();

  // Groups created / edited in this session, merged over the server rows —
  // `groups` arrives as a prop from a server component, so without this a group
  // just added is invisible until `router.refresh()` lands.
  const [extra, setExtra] = useState<DefectGroup[]>([]);

  const all = useMemo(() => {
    const byId = new Map<string, DefectGroup>();
    for (const g of groups) byId.set(g.id, g);
    for (const g of extra) byId.set(g.id, g); // session edits win
    return [...byId.values()];
  }, [groups, extra]);

  const byId = useMemo(() => new Map(all.map((g) => [g.id, g])), [all]);

  const rows: PickerRow[] = useMemo(
    () =>
      all
        .sort((a, b) => a.name.localeCompare(b.name))
        // The hide-unless-it-is-the-stored-value rule lives in DataPicker now;
        // this only has to say which rows are switched off.
        .map((g) => ({ id: g.id, label: g.name, inactive: isInactive(g) })),
    [all],
  );

  const manage: ManageConfig = {
    canCreate,
    canEdit,
    canDelete,
    dupCheck: { table: "defect_groups" },
    // Blank code = the action auto-generates one on create and keeps the stored
    // one on update; codes are backend-only (client 2026-07-23).
    onCreate: (d) => createDefectGroup({ code: "", name: d.name, is_active: true }),
    onUpdate: (id, d) =>
      updateDefectGroup(id, {
        code: "",
        name: d.name,
        // A rename must not silently reactivate a deactivated group.
        is_active: byId.get(id)?.is_active ?? true,
      }),
    onDelete: (id) => deleteDefectGroup(id),
    onCreated: (id, d) => {
      setExtra((xs) => [...xs, { id, name: d.name, is_active: true }]);
      router.refresh();
    },
    onUpdated: (id, d) => {
      setExtra((xs) => {
        if (xs.some((g) => g.id === id)) return xs.map((g) => (g.id === id ? { ...g, name: d.name } : g));
        const base = groups.find((g) => g.id === id);
        return base ? [...xs, { ...base, name: d.name }] : xs;
      });
      router.refresh();
    },
    onDeleted: (id, inactive) => {
      setExtra((xs) => {
        // A hard delete drops the row; a deactivate keeps it resolvable.
        if (!inactive) return xs.filter((g) => g.id !== id);
        if (xs.some((g) => g.id === id)) return xs.map((g) => (g.id === id ? { ...g, is_active: false } : g));
        const base = groups.find((g) => g.id === id);
        return base ? [...xs, { ...base, is_active: false }] : xs;
      });
      router.refresh();
    },
    draftOf: (row) => ({ code: "", name: byId.get(row.id)?.name ?? "" }),
  };

  return (
    <DataPicker
      label={label}
      rows={rows}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      compact={compact}
      manage={manage}
    />
  );
}
