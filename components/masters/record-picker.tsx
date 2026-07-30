"use client";

import { useMemo } from "react";
import { DataPicker, type PickerRow } from "@/components/ui/data-picker";

export type PickerItem = { id: string; code: string | null; name: string };

/**
 * Select-only picker over any existing master normalized to {id, code, name} —
 * Receivable Terms, Ports, Destinations, Couriers, Vendors, Customers. 17 call
 * sites.
 *
 * No `manage`, so no Add / Modify / Delete: these reference records that are
 * created on their own full screens, where the rest of their fields live. A
 * name-only row for a Vendor would be born unusable. Config-list fields, which
 * genuinely are just a name, get the CRUD variant — `LookupDialogPicker`.
 *
 * Now a thin adapter over `DataPicker` (was a 195-line modal dialog), so it
 * drops down and searches like every other field carrying stored data. Same
 * name, props and import path as before, which is why no call site changed.
 */
export function RecordPicker({
  label,
  items,
  value,
  onChange,
  compact = false,
  required = false,
}: {
  label: string;
  items: PickerItem[];
  value: string | null;
  onChange: (id: string | null) => void;
  compact?: boolean;
  required?: boolean;
}) {
  const rows: PickerRow[] = useMemo(
    () =>
      [...items]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((i) => ({ id: i.id, label: i.name })),
    [items],
  );

  return (
    <DataPicker
      label={label}
      rows={rows}
      value={value}
      onChange={onChange}
      compact={compact}
      required={required}
    />
  );
}
