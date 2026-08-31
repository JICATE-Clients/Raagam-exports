"use client";

// Select-only picker over the Process master (0227) — the ⓘ on the legacy
// Vendor ▸ Process and Vendor ▸ SubContractor grids ("Process Name").
//
// Select-only on purpose: a Process carries a billing basis, an HSN code and
// five item-class flags of its own, so creating one from inside a vendor form
// would either ask for all of that in a dropdown or be born incomplete. Same
// call as LevyPicker and for the same reason — the master has its own screen.
//
// A ~30-line adapter over the ONE picker (`components/ui/data-picker.tsx`); see
// doc/ui/LAYOUT.md §5a. Do not add a second picker shell.

import { useMemo } from "react";
import { DataPicker, type PickerRow } from "@/components/ui/data-picker";
import type { Process } from "@/lib/masters/process-types";
import { isInactive } from "@/lib/masters/inactive";

export function ProcessPicker({
  label,
  processes,
  value,
  onChange,
  usedIds,
  clearable = true,
}: {
  label: string;
  processes: Process[];
  value: string;
  onChange: (v: string) => void;
  /**
   * Pick-once inside a repeating grid: ids already taken by the sibling rows.
   * Straight through to `DataPicker` — see the prop there for when it applies
   * and, just as importantly, when it must not.
   *
   * Per GRID, never per screen: Vendor ▸ Process and Vendor ▸ SubContractor both
   * pick from this master, and the same process legitimately appears once in
   * each — they are two different statements about the vendor.
   */
  usedIds?: Iterable<string> | null;
  clearable?: boolean;
}) {
  const rows: PickerRow[] = useMemo(
    () =>
      processes.map((p) => ({
        id: p.id,
        label: p.name,
        // The old dialog's second column — the short description — is now
        // SEARCHABLE rather than displayed (client 2026-08-31, "fix it
        // globally"). Two similar processes are still told apart by typing it.
        search: p.short_description ?? undefined,
        inactive: isInactive(p),
      })),
    [processes],
  );
  return (
    <DataPicker
      label={label}
      rows={rows}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      usedIds={usedIds}
      clearable={clearable}
    />
  );
}
