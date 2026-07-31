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

export function ProcessPicker({
  label,
  processes,
  value,
  onChange,
  clearable = true,
}: {
  label: string;
  processes: Process[];
  value: string;
  onChange: (v: string) => void;
  clearable?: boolean;
}) {
  const rows: PickerRow[] = useMemo(
    () =>
      processes.map((p) => ({
        id: p.id,
        label: p.name,
        // The sublabel is where the old dialog's second column goes — here the
        // short description, which is what tells two similar processes apart.
        sublabel: p.short_description ?? undefined,
      })),
    [processes],
  );
  return (
    <DataPicker
      label={label}
      rows={rows}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      clearable={clearable}
    />
  );
}
