"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { DataPicker, type ManageConfig, type PickerRow } from "@/components/ui/data-picker";
import { createCurrency, updateCurrency, deleteCurrency } from "@/lib/masters/extras-actions";
import type { Currency } from "@/lib/masters/types";

/**
 * The Currency field (Applicant, Customer, Consignee — three slots each).
 *
 * Keyed by ISO CODE, not by an id: `value` and `onChange` both carry "USD",
 * which is what every host form stores. `PickerRow.id` holds the code, so the
 * shared picker needs to know nothing about it.
 *
 * A `DataPicker` plus a quick-create sheet for Add / Modify — a currency is a
 * code, a name AND a symbol, and the symbol prints on invoices, so the inline
 * name-only form would leave it blank (client 2026-07-29).
 */
export function CurrencyPicker({
  label,
  currencies,
  value,
  onChange,
  canCreate,
  canEdit,
  canDelete,
  compact = false,
}: {
  label: string;
  currencies: Currency[];
  value: string | null;
  onChange: (code: string) => void;
  canCreate: boolean;
  canEdit: boolean;
  /** Defaults to `canEdit` — see the note in `lookup-dialog-picker.tsx`. */
  canDelete?: boolean;
  /** Trigger-only (no label) for dense rows. */
  compact?: boolean;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, start] = useTransition();

  const [extra, setExtra] = useState<Currency[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);

  const all = useMemo(() => {
    const byCode = new Map<string, Currency>();
    for (const c of currencies) byCode.set(c.code, c);
    for (const c of extra) byCode.set(c.code, c);
    for (const code of removed) byCode.delete(code);
    return [...byCode.values()];
  }, [currencies, extra, removed]);

  const rows: PickerRow[] = useMemo(
    () =>
      [...all]
        .sort((a, b) => a.code.localeCompare(b.code))
        // The code IS the identity here, so it leads; the name follows muted.
        // No `inactive`: `public.currencies` (0004) is code / name / symbol and
        // has no disable column — an ISO currency is retired by deleting the row.
        // Flag-less by construction, see FLAGLESS_PICKERS in audit_layout.py.
        // picker-code: exempt -- CODE-LED. An ISO code IS the currency, so the
        // label is the code and the name is the human half beside it. This is
        // identity="code", the shape the client asked FOR (2026-08-10, five SC No
        // rows all reading "Aurelia Retail"), not the name-plus-code shape they
        // asked to be removed.
        .map((c) => ({ id: c.code, label: c.code, sublabel: c.name })),
    [all],
  );

  const [formOpen, setFormOpen] = useState(false);
  const [formEditCode, setFormEditCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const commitRef = useRef<((id: string) => void) | null>(null);

  function openAdd(commit: (id: string) => void) {
    commitRef.current = commit;
    setFormEditCode(null);
    setCode("");
    setName("");
    setSymbol("");
    setFormOpen(true);
  }
  function openEdit(row: PickerRow, commit: (id: string) => void) {
    const c = all.find((x) => x.code === row.id);
    if (!c) return;
    commitRef.current = commit;
    setFormEditCode(c.code);
    setCode(c.code);
    setName(c.name);
    setSymbol(c.symbol ?? "");
    setFormOpen(true);
  }

  function saveForm() {
    start(async () => {
      const cd = code.trim();
      const nm = name.trim();
      const sy = symbol.trim() || null;
      const payload = { code: cd, name: nm, symbol: sy };
      const res = formEditCode
        ? await updateCurrency(formEditCode, payload)
        : await createCurrency(payload);
      if (!res.ok) return error(res.error);
      setExtra((xs) => [...xs.filter((c) => c.code !== cd), { code: cd, name: nm, symbol: sy }]);
      success(formEditCode ? `${label} updated.` : `${label} added.`);
      if (!formEditCode) commitRef.current?.(cd);
      setFormOpen(false);
      router.refresh();
    });
  }

  const manage: ManageConfig = {
    canCreate,
    canEdit,
    canDelete: canDelete ?? canEdit,
    // Unreachable — the two overrides below intercept first.
    onCreate: async () => ({ ok: false, error: "Use the Currency form." }),
    onUpdate: async () => ({ ok: false, error: "Use the Currency form." }),
    /**
     * `deleteCurrency` is a hard delete with no deactivate fallback: the
     * currency code is an FK on buyers and customers, so Postgres rejects the
     * delete and the message surfaces as an error toast. Reported as
     * `inactive: false` because nothing was deactivated — the row either went or
     * the call failed.
     */
    onDelete: async (currencyCode) => {
      const res = await deleteCurrency(currencyCode);
      return res.ok ? { ok: true as const, inactive: false } : res;
    },
    onCreated: () => {},
    onUpdated: () => {},
    onDeleted: (currencyCode) => {
      setRemoved((xs) => [...xs, currencyCode]);
      setExtra((xs) => xs.filter((c) => c.code !== currencyCode));
      router.refresh();
    },
    draftOf: (r) => ({ code: r.id, name: r.sublabel ?? "" }),
  };

  return (
    <>
      <DataPicker
        label={label}
        rows={rows}
        value={value}
        onChange={(picked) => onChange(picked ?? "")}
        clearable={false}
        compact={compact}
        manage={manage}
        onAddOverride={openAdd}
        onEditOverride={openEdit}
      />

      <Sheet
        open={formOpen}
        onClose={() => setFormOpen(false)}
        size="sm"
        title={formEditCode ? `Modify ${label}` : `Add ${label}`}
        footer={
          <>
            <Button type="button" variant="outline" size="md" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="md"
              disabled={isPending || !code.trim() || !name.trim()}
              onClick={saveForm}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code" required htmlFor="cur-code">
              <Input
                id="cur-code"
                autoFocus
                uppercase
                // The code is the primary key, so changing it on an existing
                // row would orphan every record pointing at it.
                disabled={Boolean(formEditCode)}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <div>
              <Label htmlFor="cur-symbol">Symbol</Label>
              <Input id="cur-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
            </div>
          </div>
          <Field label="Name" required htmlFor="cur-name">
            <Input id="cur-name" uppercase value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
      </Sheet>
    </>
  );
}
