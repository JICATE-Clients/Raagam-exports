"use client";

import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { createCurrency, updateCurrency, deleteCurrency } from "@/lib/masters/extras-actions";
import type { Currency } from "@/lib/masters/types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

/**
 * Currency master over the `currencies` table (PK = code, no status column).
 * Code is locked on edit because other tables reference it; delete is now the
 * shared two-step confirm (was one-click).
 */
const descriptor: SimpleMasterDescriptor<Currency> = {
  entityLabel: "Currency",
  status: "none",
  getId: (r) => r.code,
  fields: [
    {
      key: "code",
      label: "Code",
      required: true,
      mono: true,
      format: "currency",
      widthClass: "w-28",
      lockedOnEdit: true,
      placeholder: "INR",
    },
    { key: "name", label: "Name", required: true, placeholder: "Indian Rupee" },
    { key: "symbol", label: "Symbol", widthClass: "w-24", placeholder: "₹" },
  ],
  fromRow: (r) => ({ code: r.code, name: r.name, symbol: r.symbol ?? "" }),
  searchText: (r) => [r.code, r.name, r.symbol].filter(Boolean).join(" "),
  toPayload: (v) => ({
    code: String(v.code).toUpperCase(),
    name: String(v.name),
    symbol: String(v.symbol) || null,
  }),
  actions: { create: createCurrency, update: updateCurrency, remove: deleteCurrency },
};

export function CurrencyMasterScreen({ rows, perms }: { rows: Currency[]; perms: Perms }) {
  const sorted = [...rows].sort((a, b) => a.code.localeCompare(b.code));
  return <SimpleMasterScreen rows={sorted} perms={perms} descriptor={descriptor} />;
}
