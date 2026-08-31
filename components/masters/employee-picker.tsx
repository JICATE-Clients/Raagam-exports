"use client";

import { useMemo } from "react";
import { DataPicker, type PickerRow } from "@/components/ui/data-picker";
import type { EmployeeRef } from "@/lib/masters/employee-types";
import { isInactive } from "@/lib/masters/inactive";

/**
 * Select-only picker over the `employees` master — the Manager self-reference.
 *
 * No inline Add (an employee is created on the Employee master). `excludeId`
 * drops the record being edited so it cannot manage itself.
 *
 * THE EMPLOYEE CODE IS SEARCHABLE, NOT DISPLAYED. It used to ride as the row's
 * `sublabel`, which printed `SAMPLE MERCHANDISER   EMP-MERCH-01` in the list —
 * reported on the Merchandiser field (client 2026-08-31, screenshot 2571:
 * "no need to add that sub-name behind the value … fix it globally").
 *
 * Note what the shape of that bug was: this component hand-rolls its rows and
 * so never went through `pickerIdentityParts`, the one file that decides how a
 * {code, name} pair is displayed. Fixing the rule alone would have left this
 * field printing the code anyway. `search` is the same channel the shared rule
 * now uses, so payroll staff can still type the number they know people by.
 *
 * Thin adapter over `DataPicker`; props and import path unchanged from the modal
 * dialog this replaced (client 2026-07-29).
 */
export function EmployeePicker({
  employees,
  value,
  onChange,
  excludeId = null,
  label = "Manager",
  compact = false,
}: {
  employees: EmployeeRef[];
  value: string | null;
  onChange: (id: string | null) => void;
  excludeId?: string | null;
  label?: string;
  compact?: boolean;
}) {
  const rows: PickerRow[] = useMemo(
    () =>
      employees
        .filter((e) => e.id !== excludeId)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => ({
          id: e.id,
          label: e.name,
          // Hidden, but still matched by the search box — see the note above.
          search: e.code,
          inactive: isInactive(e),
        })),
    [employees, excludeId],
  );

  return (
    <DataPicker label={label} rows={rows} value={value} onChange={onChange} compact={compact} />
  );
}
