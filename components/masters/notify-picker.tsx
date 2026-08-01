"use client";

import { useMemo } from "react";
import { DataPicker, type PickerRow } from "@/components/ui/data-picker";
import type { Notify } from "@/lib/masters/notify-types";
import { isInactive } from "@/lib/masters/inactive";

/**
 * Select-only picker over the `notifies` master (the Consignee "Notify" grid).
 *
 * No inline Add — a Notify party carries a full address and contact grid, so it
 * is created on its own screen. Mirrors `CustomerPicker` / `ApplicantPicker`.
 *
 * Thin adapter over `DataPicker`; props and import path unchanged from the modal
 * dialog this replaced (client 2026-07-29).
 */
export function NotifyPicker({
  notifies,
  value,
  onChange,
  label = "Notify",
  compact = false,
}: {
  notifies: Notify[];
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  compact?: boolean;
}) {
  const rows: PickerRow[] = useMemo(
    () =>
      [...notifies]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((n) => ({ id: n.id, label: n.name, inactive: isInactive(n) })),
    [notifies],
  );

  return (
    <DataPicker label={label} rows={rows} value={value} onChange={onChange} compact={compact} />
  );
}
