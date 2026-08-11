"use client";

import { useMemo } from "react";
import { RecordPicker } from "@/components/masters/record-picker";
import {
  nominatedVendorOptions,
  type NominatedVendorArgs,
} from "@/lib/masters/vendor-nominations";

/**
 * A Vendor field that obeys the customer's nomination list.
 *
 * One component instead of the same `useMemo` + `filter` + hint block copied
 * down Material BOM Amendment, Order Trims and Accessory BOM — three copies is
 * three chances for one of them to compare supply types case-sensitively, or to
 * forget that the vendor a row already holds must survive the filter. The rule
 * itself is in `lib/masters/vendor-nominations.ts`; this only renders it.
 *
 * The hint is deliberately part of the field, not a toast: an empty dropdown
 * with no explanation reads as a broken screen, and the fix ("nominate the
 * vendor on the customer") is somewhere else entirely.
 *
 * WHERE it is part of the field depends on the room. A full-width field gets the
 * paragraph underneath. A `compact` one is a ~150px grid cell on a one-line row,
 * where that paragraph made Vendor three lines tall and knocked every other cell
 * in the row out of line (operator, 2026-08-10) — so there the reason becomes the
 * empty box's PLACEHOLDER instead. Same rule, same words, one line.
 *
 * This is NOT the hint being dropped. AGENTS.md "Nominated vendors" requires
 * empty-and-explain — "a silent fallback makes the nomination list advisory and
 * the operator never learns it needs filling in" — and an empty dropdown that
 * says nothing at all is precisely what that forbids.
 */
export function NominatedVendorPicker({
  label = "Vendor",
  value,
  onChange,
  compact = false,
  required = false,
  disabled = false,
  id,
  ...rule
}: Omit<NominatedVendorArgs, "currentValue"> & {
  label?: string;
  value: string | null;
  onChange: (id: string | null) => void;
  compact?: boolean;
  required?: boolean;
  disabled?: boolean;
  id?: string;
}) {
  const { items, hint, shortHint } = useMemo(
    () => nominatedVendorOptions({ ...rule, currentValue: value }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      rule.supplyType,
      rule.customerId,
      rule.customerName,
      rule.vendors,
      rule.nominations,
      rule.unresolvedCustomerHint,
      value,
    ],
  );

  // In a grid cell the reason goes IN the box; anywhere else it goes under it.
  // `shortHint` is set only when the list came back empty, so a field that has
  // options keeps its normal "— Select Vendor —" either way.
  const inline = compact && !!shortHint;

  return (
    <>
      <RecordPicker
        label={label}
        items={items}
        value={value}
        onChange={onChange}
        compact={compact}
        required={required}
        disabled={disabled}
        id={id}
        placeholder={inline ? shortHint : undefined}
      />
      {hint && !inline && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </>
  );
}
