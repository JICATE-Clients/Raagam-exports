"use client";

import { useMemo } from "react";
import { DataPicker, type PickerRow } from "@/components/ui/data-picker";
import { isInactive, type Deactivatable } from "@/lib/masters/inactive";
import { pickerIdentityParts, type PickerIdentity } from "@/lib/masters/picker-identity";

export type { PickerIdentity };

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
 * Receivable Terms, Ports, Destinations, Couriers, Vendors, Customers. ~60 call
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
 *
 * IT USED TO THROW `code` AWAY. `PickerItem` has always declared it and every
 * call site has always passed it, and the mapping below rendered `label: name`
 * and nothing else. Harmless for a Vendor, whose name IS its identity — and
 * fatal for an SC No, where the code is the identity and the name is the
 * customer: the Garment Order Amendment screen's `SCNo` field listed five rows
 * all reading `Aurelia Retail` and the operator could not tell which order was
 * which (client 2026-08-10). Nine fields across Orders and Sales were in that
 * state, which is why this is fixed here and not at the call site.
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
  identity = "name",
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
  /** See `PickerIdentity`. Defaults to the name, which is the house rule. */
  identity?: PickerIdentity;
}) {
  const rows: PickerRow[] = useMemo(() => {
    const decorate = (i: PickerItem): PickerRow => ({
      id: i.id,
      ...pickerIdentityParts(i.code, i.name, identity),
      inactive: isInactive(i),
    });
    // Sorted by what is DISPLAYED, not always by `name`. For the default that is
    // the same ordering as before — `primary` is the name — so nothing reorders
    // except the code-led fields, where sorting by customer was the complaint.
    return [...items]
      .map(decorate)
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [items, identity]);

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
