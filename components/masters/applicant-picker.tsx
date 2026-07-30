"use client";

import { useMemo } from "react";
import { DataPicker, type PickerRow } from "@/components/ui/data-picker";
import type { Applicant } from "@/lib/masters/applicant-types";

/**
 * Select-only picker over the `applicants` master — the Customer form's five
 * applicant slots, and the "+ Add applicant" pill at the foot of that grid.
 *
 * No inline Add: an Applicant is a rich master (header + Address + contacts)
 * edited on its own screen.
 *
 * `variant="add"` renders the dashed pill instead of a field box; the list,
 * search and keys behind it are identical, which is the whole point of routing
 * both through `DataPicker` (client 2026-07-29). Props and import path
 * unchanged from the modal dialog this replaced.
 */
export function ApplicantPicker({
  applicants,
  value,
  onChange,
  compact = false,
  label = "Applicant",
  variant = "field",
  addLabel = "+ Add applicant",
}: {
  applicants: Applicant[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** Trigger-only (no label) for dense grid rows. */
  compact?: boolean;
  label?: string;
  /** "field" = a select box; "add" = a dashed pill that appends on pick. */
  variant?: "field" | "add";
  addLabel?: string;
}) {
  const rows: PickerRow[] = useMemo(
    () =>
      [...applicants]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((a) => ({ id: a.id, label: a.name })),
    [applicants],
  );

  return (
    <DataPicker
      label={label}
      rows={rows}
      value={value}
      onChange={onChange}
      compact={compact}
      triggerVariant={variant}
      addLabel={addLabel}
    />
  );
}
