"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DataPicker, type ManageConfig, type PickerRow } from "@/components/ui/data-picker";
import { createLookupValue } from "@/lib/masters/lookup-quick";
import { updateLookup, deleteLookup } from "@/lib/masters/extras-actions";
import type { ConfigLookup, LookupKind } from "@/lib/masters/extras-types";

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
 *   from a list without that rule makes an existing record look empty.
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
  const canAdd = Boolean(canCreate) && (!adminOnly || isSuperAdmin);
  const showTypeField = kind === "item_class";

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
        .filter((o) => o.is_active || o.id === value)
        .sort((a, b) => a.name.localeCompare(b.name))
        // Codes are backend-only (client 2026-07-23) — show just the name.
        .map((o) => ({ id: o.id, label: o.name, disabled: !o.is_active })),
    [all, value],
  );

  const manage: ManageConfig = {
    canCreate: canAdd,
    canEdit: Boolean(canEdit),
    canDelete: canDelete ?? Boolean(canEdit),
    showTypeField,
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
      clearable={false}
      required={required}
      compact={compact}
      manage={manage}
    />
  );
}
