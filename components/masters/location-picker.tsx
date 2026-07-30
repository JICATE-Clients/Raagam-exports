"use client";

import { useMemo } from "react";
import { DataPicker, type PickerRow } from "@/components/ui/data-picker";
import type { EmployeeLocation } from "@/lib/masters/employee-types";

/**
 * Select-only picker over the `locations` master (GST entities: HO / Unit 2).
 *
 * No inline Add or Delete: a location is a GST registration maintained in the
 * System module, and one created from a dropdown would have no registration
 * details behind it.
 *
 * Thin adapter over `DataPicker`; props and import path unchanged from the modal
 * dialog this replaced (client 2026-07-29).
 */
export function LocationPicker({
  locations,
  value,
  onChange,
  label = "Location",
  compact = false,
}: {
  locations: EmployeeLocation[];
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  compact?: boolean;
}) {
  const rows: PickerRow[] = useMemo(
    () =>
      [...locations]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((l) => ({ id: l.id, label: l.name })),
    [locations],
  );

  return (
    <DataPicker label={label} rows={rows} value={value} onChange={onChange} compact={compact} />
  );
}
