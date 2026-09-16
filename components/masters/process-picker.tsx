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
        /* NO `search`. It carried the old dialog's second column — the short
           description — which was made SEARCHABLE rather than displayed (client
           2026-08-31, "fix it globally"). The client then removed the field
           itself from the Process master (2026-09-16,
           doc/order/fabriprocess.md §4, "the redundant short description
           textbox") and 0565 dropped both columns, so there is nothing left to
           search by: a process is told apart by its NAME here. Do not reach for
           `hsn_code` to refill this — a tax code is not a way of saying which
           process you meant. */
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
