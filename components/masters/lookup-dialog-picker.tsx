"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DataPicker, type ManageConfig, type PickerRow } from "@/components/ui/data-picker";
import { createLookupValue } from "@/lib/masters/lookup-quick";
import { updateLookup, deleteLookup } from "@/lib/masters/extras-actions";
import {
  lookupLabel,
  CLOSED_LOOKUP_KINDS,
  NO_INLINE_CREATE_KINDS,
  type ConfigLookup,
  type LookupKind,
} from "@/lib/masters/extras-types";
import { isInactive } from "@/lib/masters/inactive";

/**
 * The `config_lookups` picker — City, State, Department, Designation, Internal
 * Department, Ship Type, Payment Term, Item Class, HSN, Yarn Count and the rest
 * of the shared code lists. ~78 call sites across masters and orders.
 *
 * Now a ~90-line adapter over `DataPicker` (was a 360-line modal dialog of its
 * own). The dialog is gone: the list drops down under the field, searches as you
 * type, and Add / Modify / Delete happen in place — one shape for stored data
 * everywhere in the app (client 2026-07-29). Props, name and import path are
 * unchanged, which is why none of those call sites needed editing.
 *
 * ## This is the merge of two components that shared a name
 *
 * `lookup-picker.tsx` exported a SECOND `LookupDialogPicker` with different
 * behaviour — `adminOnly`, the `item_class` Type field, and inactive-value
 * filtering — and five screens imported that one. Two components with one name
 * and different semantics is a trap that only survives while nobody has to touch
 * them; consolidating the pickers meant it had to go. This file is the superset,
 * so the richer behaviour reached the other ~73 sites rather than being lost:
 *
 * - **Inactive values** are excluded from new selections but still resolve for a
 *   record that already references one (and render greyed). Dropping a value
 *   from a list without that rule makes an existing record look empty. That rule
 *   is now app-wide and lives in `DataPicker`; this file only reports which rows
 *   are switched off.
 * - **`adminOnly`** additionally gates Add behind `isSuperAdmin` — legacy
 *   behaviour for lists like Structure that only an admin may extend on the fly.
 * - **`type_code`** is a functional grouping distinct from Code, and only
 *   `kind="item_class"` has one (migration 0287), hence `showTypeField`.
 *
 * Add and Modify write through the shared store, so a value created here is
 * immediately available everywhere that kind is used — exactly as the legacy
 * green ⊕ / blue ⓘ popup behaved.
 */
export function LookupDialogPicker({
  kind,
  label,
  options,
  value,
  onChange,
  usedIds,
  canCreate,
  canEdit = false,
  canDelete,
  isSuperAdmin = false,
  adminOnly = false,
  required = false,
  compact = false,
}: {
  kind: LookupKind;
  label: string;
  options: ConfigLookup[];
  value: string | null;
  onChange: (id: string) => void;
  /**
   * Pick-once inside a repeating grid: ids already taken by the sibling rows.
   * Straight through to `DataPicker` — see the prop there for when it applies
   * and, just as importantly, when it must not.
   */
  usedIds?: Iterable<string> | null;
  canCreate?: boolean;
  canEdit?: boolean;
  /**
   * Defaults to `canEdit`, deliberately.
   *
   * These flags have always been the HOST screen's permissions standing in for
   * "may I maintain this shared code list" — an Applicant editor passes its own
   * `perms.canEdit` to a City picker. Under that (already loose) model, gating
   * delete separately would mean threading a fourth prop through ~78 sites to
   * express a distinction the existing three do not make. Modify already lets an
   * operator rename a value app-wide, which is the more destructive of the two,
   * and delete here is guarded: a value any record references comes back
   * deactivated, not deleted. Pass `canDelete={false}` to opt a field out.
   */
  canDelete?: boolean;
  isSuperAdmin?: boolean;
  /** Add is admin-only for this list (legacy behaviour for e.g. Structure). */
  adminOnly?: boolean;
  /** Show a required asterisk on the label. */
  required?: boolean;
  /** Trigger-only (no label) for dense grid rows. */
  compact?: boolean;
}) {
  const router = useRouter();
  /*
   * A CLOSED kind is SELECT-ONLY: no "+ Add", no pencil, no trash, and none of
   * the three shortcuts behind them. Not gated on a permission or a role,
   * because there is no operator the list is open to — `adminOnly` below is the
   * other shape and is NOT the same thing ("an admin may extend this on the
   * fly" vs "the vocabulary is fixed"). See CLOSED_LOOKUP_KINDS.
   *
   * All three flags, not just Add. Removing Add alone would have made the other
   * two WORSE than they were: these lists have no maintenance screen of their
   * own, so a delete or a rename with no way to add would be a one-way door out
   * of the UI — and for `fabric_structure` the name IS the code a new row gets,
   * so a rename breaks `fabricStructureUom()` exactly as an invented value did.
   *
   * `NO_INLINE_CREATE_KINDS` is the weaker half, and it is deliberately read
   * ONLY here: those lists are fixed but their seeded rows stay editable, so
   * Modify and Delete keep answering to the call site below. `item_class` is
   * that shape — inventing an eighth class breaks the code-keyed material
   * rules, while renaming one does not, because its code is seeded rather than
   * copied from the name.
   */
  const closed = CLOSED_LOOKUP_KINDS.has(kind);
  const canAdd =
    !closed &&
    !NO_INLINE_CREATE_KINDS.has(kind) &&
    Boolean(canCreate) &&
    (!adminOnly || isSuperAdmin);
  const showTypeField = kind === "item_class";

  /*
   * NOT for kind="state" — use `components/masters/state-picker.tsx`.
   *
   * States moved to `public.states` (0355) and `state_id` FKs were repointed
   * there, but `statesAsLookups()` maps those rows into the lookup shape, so a
   * State field LOOKS like it belongs here. It does not: everything below
   * writes to `config_lookups`, so Add put the state in the wrong table — it
   * vanished on the next refresh and returned an id that was not a valid
   * `state_id`. Harmless while State fields passed no permissions; the
   * 2026-07-31 sweep gave them CRUD and exposed it.
   *
   * NOT for kind="payment_term" either — use
   * `components/masters/payment-term-picker.tsx`. Identical shape (the master is
   * `public.payment_terms`, 0242; the FKs were repointed by 0375, and
   * `paymentTermsAsLookups()` is the shim), but it never had State's saving
   * coincidence: no term shared an id across the two tables, so simply PICKING
   * one already failed every save with a foreign-key violation.
   *
   * The pattern to check before adding a kind here: if the field's options come
   * from `lookup-compat.ts` rather than `config_lookups`, this component is the
   * wrong one — its writes and that field's reads are different tables.
   */

  // Values created / edited in this session, merged over the server rows. The
  // options arrive as a prop from a server component, so without this a value
  // the operator just added is invisible until `router.refresh()` lands.
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
        // Sorted by the NAME, not the composed label: alphabetical by the words
        // the operator reads first, so Ship Type still runs CARRIAGE… → COST… →
        // DELIVERED…, not CFR → CIF → CIP.
        .sort((a, b) => a.name.localeCompare(b.name))
        // Codes are backend-only (client 2026-07-23) — show just the name. The
        // ONE exception is a kind whose code is a term of the trade rather than a
        // generated key: Ship Type reads "FREE ON BOARD (FOB)", which also makes
        // it findable by typing the Incoterm (the filter matches the label).
        .map((o) => ({ id: o.id, label: lookupLabel(kind, o), inactive: isInactive(o) })),
    [all, kind],
  );

  const manage: ManageConfig = {
    canCreate: canAdd,
    canEdit: !closed && Boolean(canEdit),
    canDelete: !closed && (canDelete ?? Boolean(canEdit)),
    showTypeField,
    // Scoped per kind, matching `uq_config_lookups_kind_name` — so the field says
    // "already exists" while the operator types instead of on Save. State is the
    // exception below: its rows live in `public.states`, so it is checked there.
    dupCheck: { table: "config_lookups", scope: { kind } },
    onCreate: (d) => createLookupValue(kind, d.name, d.code || null, d.typeCode || null),
    onUpdate: (id, d) => {
      const existing = byId.get(id);
      return updateLookup(id, {
        kind,
        code: d.code || null,
        name: d.name,
        type_code: showTypeField ? d.typeCode || null : (existing?.type_code ?? null),
        notes: existing?.notes ?? null,
        is_active: existing?.is_active ?? true,
      });
    },
    onDelete: (id) => deleteLookup(id),
    onCreated: (id, d) => {
      setExtra((xs) => [
        ...xs,
        {
          id,
          kind,
          code: d.code || null,
          name: d.name,
          type_code: d.typeCode || null,
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
        const patch = { code: d.code || null, name: d.name, type_code: d.typeCode || null };
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
        // records that already point at it, but out of the selectable list.
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
      return { code: o?.code ?? "", name: o?.name ?? "", typeCode: o?.type_code ?? "" };
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
      usedIds={usedIds}
      clearable={false}
      required={required}
      compact={compact}
      manage={manage}
    />
  );
}
