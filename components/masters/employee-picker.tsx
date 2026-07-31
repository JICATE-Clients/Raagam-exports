"use client";

import { useMemo } from "react";
import { DataPicker, type PickerRow } from "@/components/ui/data-picker";
import type { EmployeeRef } from "@/lib/masters/employee-types";

/**
 * Select-only picker over the `employees` master — the Manager self-reference.
 *
 * No inline Add (an employee is created on the Employee master). `excludeId`
 * drops the record being edited so it cannot manage itself.
 *
 * The employee code rides along as the row's sublabel rather than being welded
 * into the label: the closed field shows the NAME, which is the standing rule
 * for every master (codes are hidden from the UI), while the list still shows
 * the number the payroll staff know people by.
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
        .map((e) => ({ id: e.id, label: e.name, sublabel: e.code })),
    [employees, excludeId],
  );

  return (
    <DataPicker label={label} rows={rows} value={value} onChange={onChange} compact={compact} />
  );
}
