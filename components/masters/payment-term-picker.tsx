"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DataPicker, type ManageConfig, type PickerRow } from "@/components/ui/data-picker";
import {
  createPaymentTermQuick,
  updatePaymentTermQuick,
  deletePaymentTerm,
} from "@/lib/masters/payment-term-actions";
import type { ConfigLookup } from "@/lib/masters/extras-types";
import { isInactive } from "@/lib/masters/inactive";

/**
 * The Payment Terms field, everywhere one appears (6 fields across 4 screens).
 *
 * ## Why this exists rather than `LookupDialogPicker kind="payment_term"`
 *
 * Payment Terms is the second lookup whose READ and WRITE sides pointed at
 * different tables — the same defect `StatePicker` was built for, found the same
 * week. The options are `paymentTermsAsLookups(termRows)`, rows of
 * `public.payment_terms` (the Associates ▸ Payment Term master, 0242) carrying
 * their real `payment_terms.id`, but `LookupDialogPicker` writes every kind to
 * `config_lookups` (`lookup-dialog-picker.tsx:126,138`). So on a Payment Terms
 * field:
 *
 * - **Add** wrote the term into `config_lookups`; the field re-read
 *   `public.payment_terms` on the next refresh, so the new term VANISHED.
 * - **Modify** renamed a `config_lookups` row nothing reads.
 * - **Delete** removed or deactivated an entirely different record.
 *
 * Worse than State's, which survived on a uuid coincidence: no payment term ever
 * shared an id across the two tables, so SELECTING a listed term failed every
 * save outright —
 * `violates foreign key constraint "applicants_payment_term_id_fkey"`, on a
 * field the operator has no way to connect to the message (client, 2026-07-31).
 * 0375 repointed `applicants` / `consignees` / `garment_order_amendments` at the
 * master, which is what makes this component's writes land where the FK looks.
 *
 * ## Why the options stay `ConfigLookup[]`
 *
 * `paymentTermsAsLookups` already maps `payment_terms.id → ConfigLookup.id` and
 * `entry_no → code`, and the host screens read that same array elsewhere (the
 * read-only "Payment Terms" row in their view sheets resolves through it). Taking
 * `PaymentTerm[]` here would fork those consumers for no gain, so this stays a
 * drop-in: callers change the component name and drop `kind`, nothing else.
 */
export function PaymentTermPicker({
  label = "Payment Terms",
  options,
  value,
  onChange,
  canCreate,
  canEdit = false,
  canDelete,
  required = false,
  compact = false,
}: {
  label?: string;
  /** `paymentTermsAsLookups(rows)` — ids are `payment_terms.id`. */
  options: ConfigLookup[];
  value: string | null;
  onChange: (id: string) => void;
  canCreate?: boolean;
  canEdit?: boolean;
  /** Defaults to `canEdit` — same reasoning as `LookupDialogPicker`. Delete is
   *  guarded: a term any record references is deactivated, not removed (0344). */
  canDelete?: boolean;
  required?: boolean;
  /** Trigger-only (no label) for dense grid rows. */
  compact?: boolean;
}) {
  const router = useRouter();

  // Terms created / edited in this session, merged over the server rows. The
  // options arrive as a prop from a server component, so without this a term the
  // operator just added is invisible until `router.refresh()` lands.
  const [extra, setExtra] = useState<ConfigLookup[]>([]);

  const all = useMemo(() => {
    const byId = new Map<string, ConfigLookup>();
    for (const o of options) byId.set(o.id, o);
    for (const o of extra) byId.set(o.id, o); // session edits win
    return [...byId.values()];
  }, [options, extra]);

  const byId = useMemo(() => new Map(all.map((o) => [o.id, o])), [all]);

  const rows: PickerRow[] = useMemo(
    () =>
      all
        // Description only — `entry_no` is an auto-assigned serial, not something
        // the operator picks by. Sorted by the text they actually read.
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((o) => ({ id: o.id, label: o.name, inactive: isInactive(o) })),
    [all],
  );

  const manage: ManageConfig = {
    canCreate: Boolean(canCreate),
    canEdit: Boolean(canEdit),
    canDelete: canDelete ?? Boolean(canEdit),
    // Scoped to the master's display column: the term's text lives in
    // `description`, so the default `name` column would silently check nothing.
    // Unfiltered on `inactive`, matching the server guard — a deactivated term
    // keeps its description reserved.
    dupCheck: { table: "payment_terms", nameColumn: "description" },
    onCreate: (d) => createPaymentTermQuick(d.name),
    onUpdate: (id, d) => updatePaymentTermQuick(id, d.name),
    onDelete: (id) => deletePaymentTerm(id),
    onCreated: (id, d) => {
      setExtra((xs) => [
        ...xs,
        {
          id,
          kind: "payment_term" as const,
          // `entry_no` is assigned by the database; the row shows its
          // description until `router.refresh()` brings the real number back.
          code: null,
          name: d.name,
          type_code: null,
          notes: null,
          is_active: true,
          created_at: "",
          updated_at: "",
        },
      ]);
      router.refresh();
    },
    onUpdated: (id, d) => {
      setExtra((xs) => {
        const patch = { name: d.name };
        if (xs.some((o) => o.id === id)) {
          return xs.map((o) => (o.id === id ? { ...o, ...patch } : o));
        }
        const base = options.find((o) => o.id === id);
        return base ? [...xs, { ...base, ...patch }] : xs;
      });
      router.refresh();
    },
    onDeleted: (id, inactive) => {
      setExtra((xs) => {
        // A hard delete drops the row; a deactivate keeps it resolvable for
        // records that already reference it, but out of the selectable list.
        if (!inactive) return xs.filter((o) => o.id !== id);
        if (xs.some((o) => o.id === id)) {
          return xs.map((o) => (o.id === id ? { ...o, is_active: false } : o));
        }
        const base = options.find((o) => o.id === id);
        return base ? [...xs, { ...base, is_active: false }] : xs;
      });
      router.refresh();
    },
    draftOf: (row) => {
      const o = byId.get(row.id);
      return { code: o?.code ?? "", name: o?.name ?? "" };
    },
  };

  return (
    <DataPicker
      label={label}
      rows={rows}
      value={value}
      // The legacy contract is "a picked id", never null — these fields clear by
      // picking something else, and every call site types `onChange` that way.
      onChange={(id) => onChange(id ?? "")}
      clearable={false}
      required={required}
      compact={compact}
      manage={manage}
    />
  );
}
