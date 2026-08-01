"use client";

import { useMemo } from "react";
import { DataPicker, type PickerRow } from "@/components/ui/data-picker";
import { isInactive, type Deactivatable } from "@/lib/masters/inactive";

/**
 * `Deactivatable` rather than a single `inactive?: boolean` on purpose: option
 * lists reach this component straight off a service, and the schema spells the
 * disable flag three ways (`inactive` · `blocked` · `is_active`). Accepting all
 * three means a service only has to SELECT its own column — no per-call-site
 * `.map()` to normalize, and no way to normalize it wrongly.
 *
 * A row carrying none of them is active, which is correct for the flag-less
 * masters (`ports`, `currencies`, and the order / UOM-conversion documents that
 * also ride this shape).
 */
export type PickerItem = { id: string; code: string | null; name: string } & Deactivatable;

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
 *
 * It also has an inactive state now, which it did not when `listVendorsForPicker`
 * was written — so callers pass every row and let the panel hide the disabled
 * ones, rather than pre-filtering in SQL and leaving an already-chosen row
 * unresolvable.
 */
export function RecordPicker({
  label,
  items,
  value,
  onChange,
  usedIds,
  compact = false,
  required = false,
  disabled = false,
  id,
}: {
  label: string;
  items: PickerItem[];
  value: string | null;
  onChange: (id: string | null) => void;
  /**
   * Pick-once inside a repeating grid: ids already taken by the sibling rows.
   * Straight through to `DataPicker` — see the prop there for when it applies
   * and, just as importantly, when it must not.
   */
  usedIds?: Iterable<string> | null;
  compact?: boolean;
  required?: boolean;
  /** Read-only for a viewer — the field still shows what is stored. */
  disabled?: boolean;
  /**
   * Lands on the trigger, so a caller can name it from outside with its own
   * `<label htmlFor>`. `compact` drops the picker's own <Label>, and one field
   * repeated down a grid needs a name per ROW ("HSN for GOLD ZIP"), which a
   * single shared label cannot give — see `material-hsn-assign-screen.tsx`.
   */
  id?: string;
}) {
  const rows: PickerRow[] = useMemo(
    () =>
      [...items]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((i) => ({ id: i.id, label: i.name, inactive: isInactive(i) })),
    [items],
  );

  return (
    <DataPicker
      label={label}
      rows={rows}
      value={value}
      onChange={onChange}
      usedIds={usedIds}
      compact={compact}
      required={required}
      disabled={disabled}
      id={id}
    />
  );
}
