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
  emptyHint,
  value,
  onChange,
  usedIds,
  compact = false,
  required = false,
  disabled = false,
  id,
  identity = "name",
  placeholder,
  onAddOverride,
}: {
  label: string;
  items: PickerItem[];
  /** Shown in the open panel instead of "No <noun> found." when the master
   *  itself is empty — see `emptyHint` on `DataPicker`. */
  emptyHint?: string | null;
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
  /**
   * Replaces the default "— Select <noun> —" in the empty box. For a field whose
   * emptiness has a REASON worth stating where there is no room for a line
   * underneath — a narrowed-to-nothing vendor list in a grid cell. Straight
   * through to `DataPicker`; a selected value always wins over it.
   */
  placeholder?: string;
  /**
   * "+ Add" opens a CALLER-SUPPLIED create surface, and commits the id it
   * returns.
   *
   * THIS IS NOT A REVERSAL OF THE NO-CRUD RULE ABOVE — it is the case that rule
   * points at. The refusal is to an INLINE name-only row, because these fields
   * reference records that carry more than a name and would be born unusable;
   * `LookupDialogPicker` gets the inline variant precisely because a config
   * list genuinely is just a name. An override hands the operator the real
   * form instead, which is the thing the refusal says is needed.
   *
   * Opt-in and undefined by default, so every existing call site is unchanged:
   * with no override, `DataPicker` shows no Add affordance at all.
   */
  onAddOverride?: (commit: (id: string) => void) => void;
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
    const decorated = [...items]
      .map(decorate)
      .sort((a, b) => a.label.localeCompare(b.label));

    /**
     * ## THE ONE PLACE A HIDDEN CODE COMES BACK: TWO ROWS THAT READ ALIKE
     *
     * `identity="name"` stopped displaying codes (client 2026-08-31, screenshot
     * 2571). That is right in the ordinary case and UNUSABLE in one specific
     * case, and this repo has already paid for that case once: the Garment Order
     * Amendment `SCNo` field listed five rows all reading `Aurelia Retail` and
     * the operator could not tell which order was which (client 2026-08-10).
     * Hiding the code globally re-creates exactly that failure wherever two
     * records share a name — and AGENTS.md says where that is guaranteed to
     * happen: *"never check `employees.name` — two workers legitimately share a
     * name; the identity there is the employee ID."* The Merchandiser field in
     * screenshot 2571 is an employee picker.
     *
     * So the code is restored as a visible sublabel ONLY on the rows that
     * collide. Nothing shows on a list where every name is distinct, which is
     * the instruction; and where two rows would otherwise be indistinguishable,
     * the operator gets the one piece of text that tells them apart.
     *
     * It is done HERE rather than in `pickerIdentityParts` because it is not a
     * property of a row — it is a property of the LIST. One row cannot know
     * another row shares its label. Same reason the cascading-filter rule lives
     * at the caller that can see both facets.
     */
    const seen = new Map<string, number>();
    for (const r of decorated) {
      const k = r.label.toLowerCase();
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return decorated.map((r) =>
      r.sublabel == null && r.search && (seen.get(r.label.toLowerCase()) ?? 0) > 1
        ? { ...r, sublabel: r.search }
        : r,
    );
  }, [items, identity]);

  return (
    <DataPicker
      label={label}
      rows={rows}
      emptyHint={emptyHint}
      value={value}
      onChange={onChange}
      usedIds={usedIds}
      compact={compact}
      required={required}
      disabled={disabled}
      id={id}
      placeholder={placeholder}
      onAddOverride={onAddOverride}
    />
  );
}
