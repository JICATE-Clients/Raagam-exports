"use client";

import { useMemo } from "react";
import { DataPicker, type PickerRow } from "@/components/ui/data-picker";
import type { GlAccountForPicker } from "@/lib/finance/gl-service";

/**
 * Select-only picker over the `gl_accounts` chart of accounts — the legacy
 * "Ac Head" red ⓘ field on the GST Structure / Levy screen.
 *
 * No inline Add: the chart of accounts is maintained in Finance, and an account
 * created without its type would not post. The account type rides along as the
 * row's sublabel, which is the column the old dialog showed beside the name.
 *
 * Thin adapter over `DataPicker`; props and import path unchanged from the modal
 * dialog this replaced (client 2026-07-29).
 */
export function AcHeadPicker({
  accounts,
  value,
  onChange,
  label = "Ac Head",
  compact = true,
  disabled = false,
}: {
  accounts: GlAccountForPicker[];
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  const rows: PickerRow[] = useMemo(
    () =>
      [...accounts]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((a) => ({ id: a.id, label: a.name, sublabel: a.account_type })),
    [accounts],
  );

  return (
    <DataPicker
      label={label}
      rows={rows}
      value={value}
      onChange={onChange}
      compact={compact}
      disabled={disabled}
    />
  );
}
