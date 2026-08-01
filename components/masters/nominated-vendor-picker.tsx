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
  const { items, hint } = useMemo(
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
      />
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </>
  );
}
