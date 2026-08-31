"use client";

import { useMemo } from "react";
import { DataPicker, type PickerRow } from "@/components/ui/data-picker";
import type { CostHead } from "@/lib/finance/cost-heads/types";
import { isInactive } from "@/lib/masters/inactive";

/**
 * Select-only picker over the finance `cost_heads` master — the Account Head
 * "Cost head" field.
 *
 * No inline Add: cost heads are maintained in the Finance module, where their
 * category and posting rules live. Mirrors `LocationPicker` / `AcHeadPicker`.
 *
 * Thin adapter over `DataPicker`; props and import path unchanged from the modal
 * dialog this replaced (client 2026-07-29).
 */
export function CostHeadPicker({
  costHeads,
  value,
  onChange,
  label = "Cost head",
  compact = false,
}: {
  costHeads: CostHead[];
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  compact?: boolean;
}) {
  const rows: PickerRow[] = useMemo(
    () =>
      [...costHeads]
        .sort((a, b) => a.name.localeCompare(b.name))
        // Category is SEARCHABLE, NOT DISPLAYED (client 2026-08-31).
        .map((c) => ({ id: c.id, label: c.name, search: c.category, inactive: isInactive(c) })),
    [costHeads],
  );

  return (
    <DataPicker label={label} rows={rows} value={value} onChange={onChange} compact={compact} />
  );
}
