"use client";

import { useMemo } from "react";
import { DataPicker, type PickerRow } from "@/components/ui/data-picker";
import type { Customer } from "@/lib/masters/customer-types";
import { isInactive } from "@/lib/masters/inactive";

/**
 * Select-only picker over the `customers` master (the legacy "Customer" field
 * on the Consignee form).
 *
 * No inline Add: a Customer carries currencies, ports, terms and a GSTIN, so a
 * name-only row would be born unusable — it is created on its own screen. Same
 * reasoning as `record-picker.tsx`.
 *
 * A thin adapter over `DataPicker` (was a 187-line modal dialog): the list now
 * drops down under the field and searches as you type, like every other field
 * carrying stored data (client 2026-07-29). Props and import path unchanged.
 */
export function CustomerPicker({
  customers,
  value,
  onChange,
  label = "Customer",
  compact = false,
}: {
  customers: Customer[];
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  compact?: boolean;
}) {
  const rows: PickerRow[] = useMemo(
    () =>
      [...customers]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ id: c.id, label: c.name, inactive: isInactive(c) })),
    [customers],
  );

  return (
    <DataPicker label={label} rows={rows} value={value} onChange={onChange} compact={compact} />
  );
}
