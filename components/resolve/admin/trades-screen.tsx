"use client";

import { useMemo } from "react";
import {
  SimpleMasterScreen,
  type SimpleMasterDescriptor,
} from "@/components/masters/simple-master-screen";
import { FIELD_WIDTH } from "@/components/ui/field";
import { saveTrade, setTradeInactive } from "@/lib/resolve/actions";
import type { Trade } from "@/lib/resolve/types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

/** A code from the name — the operator is never asked for one (client
 *  2026-07-23). The save's duplicate guard checks the code as well as the name,
 *  so a collision says so rather than suffixing silently. */
function codeFrom(name: string): string {
  return (
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "TRADE"
  );
}

/**
 * Resolve Hub ▸ Administration ▸ Trades — the kinds of fix (Electrical,
 * Plumbing, Carpentry …). Shared across units ("master data is shared"), so
 * one list serves every unit's teams and routing.
 *
 * Delete switches the trade OFF rather than removing it: tickets, teams and
 * routing rules point at trades, and a vanished trade would blank all three.
 */
export function TradesScreen({ rows, perms }: { rows: Trade[]; perms: Perms }) {
  const descriptor = useMemo<SimpleMasterDescriptor<Trade>>(() => {
    const codeOf = new Map(rows.map((r) => [r.id, r.code]));
    type Payload = { name: string; description: string | null; inactive: boolean };
    return {
      entityLabel: "Trade",
      status: "active",
      editor: "sheet",
      fields: [
        { key: "name", label: "Name", required: true, widthClass: FIELD_WIDTH.party },
        { key: "description", label: "Description", widthClass: FIELD_WIDTH.name },
      ],
      fromRow: (r) => ({ name: r.name, description: r.description ?? "" }),
      searchText: (r) => [r.code, r.name, r.description].filter(Boolean).join(" "),
      statusOf: (r) => (r.inactive ? "inactive" : "active"),
      dupCheck: { table: "rh_trades", fieldKey: "name", nameColumn: "name" },
      spellSuggest: true,
      toPayload: (v, s): Payload => ({
        name: String(v.name),
        description: String(v.description ?? "") || null,
        inactive: !s.active,
      }),
      actions: {
        create: ((p: Payload) => saveTrade({ ...p, code: codeFrom(p.name) })) as never,
        update: ((id: string, p: Payload) =>
          saveTrade({ ...p, id, code: codeOf.get(id) ?? codeFrom(p.name) })) as never,
        remove: async (id: string) => {
          const res = await setTradeInactive(id, true);
          return res.ok ? { ok: true as const, inactive: true } : res;
        },
      },
    };
  }, [rows]);

  return <SimpleMasterScreen rows={rows} perms={perms} descriptor={descriptor} />;
}
