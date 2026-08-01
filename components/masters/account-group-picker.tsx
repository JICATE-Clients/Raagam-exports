"use client";

import { useMemo } from "react";
import { DataPicker, type PickerRow } from "@/components/ui/data-picker";
import type { AccountGroup } from "@/lib/masters/account-group-types";
import { isInactive } from "@/lib/masters/inactive";

/**
 * The legacy "Under" picker over the `account_groups` master itself.
 *
 * Select-only: an Account Group is edited on this very screen, so an inline Add
 * would be a second, worse editor for the record already in front of the
 * operator. `excludeId` drops the row being edited so a group cannot be placed
 * under itself.
 *
 * Thin adapter over `DataPicker`; props and import path unchanged from the modal
 * dialog this replaced (client 2026-07-29).
 */
export function AccountGroupPicker({
  groups,
  value,
  onChange,
  excludeId = null,
  label = "Under",
}: {
  groups: AccountGroup[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** The group currently being edited — excluded from the list (no self-parent). */
  excludeId?: string | null;
  label?: string;
}) {
  const rows: PickerRow[] = useMemo(
    () =>
      groups
        .filter((g) => g.id !== excludeId)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((g) => ({ id: g.id, label: g.name, inactive: isInactive(g) })),
    [groups, excludeId],
  );

  return <DataPicker label={label} rows={rows} value={value} onChange={onChange} />;
}
