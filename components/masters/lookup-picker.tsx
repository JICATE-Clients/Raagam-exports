"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DataPicker, type ManageConfig, type PickerRow } from "@/components/ui/data-picker";
import { createCategory, updateCategory, deleteCategory } from "@/lib/masters/category-actions";
import { quickCreateMaterial, renameMaterial, deleteMaterial } from "@/lib/masters/material-actions";
import { YarnQuickCreateSheet } from "@/components/masters/yarn-quick-create-sheet";
import { GarmentQuickCreateSheet } from "@/components/masters/garment-quick-create-sheet";
import { CategoryQuickCreateSheet } from "@/components/masters/category-quick-create-sheet";
import type { ConfigLookup, AttributeValue } from "@/lib/masters/extras-types";
import type { Levy } from "@/lib/masters/levy-types";
import type { Category } from "@/lib/masters/category-types";
import { isInactive, type Deactivatable } from "@/lib/masters/inactive";

export type { ManageConfig, PickerRow };

// ============================================================================
// Pickers over the RICH masters — Levy, Materials, Categories, Attributes.
//
// The shared body used to live here: `DialogListPicker`, ~400 lines that opened
// a nested Sheet with a search box, a row list and inline Add/Modify/Delete.
// That was one of THREE shapes stored data could arrive in (a modal dialog and a
// plain dropdown were the others), so which one a field got came down to when it
// was built. The client asked for one shape everywhere (2026-07-29): a dropdown
// that lists the data, searches as you type, and does CRUD in place.
//
// So `DialogListPicker` is gone and its `ManageConfig` contract — already the
// best CRUD abstraction in the codebase — moved to
// `components/ui/data-picker.tsx` intact. Everything below now composes
// `DataPicker` and is otherwise unchanged.
//
// This file also exported a SECOND `LookupDialogPicker`, colliding by name with
// the one in `lookup-dialog-picker.tsx` while behaving differently. They are
// merged there now (superset kept); the five screens that imported it from here
// import it from there instead.
// ============================================================================


/**
 * Select-only picker for masters that already have their own dedicated
 * management screen (e.g. Levy) — search + OK/Cancel/Clear, no inline
 * Add/Modify (mirrors the legacy ApplicantPicker/EmployeePicker pattern).
 */
export function LevyPicker({
  label,
  levies,
  value,
  onChange,
  clearable = true,
}: {
  label: string;
  levies: Levy[];
  value: string;
  onChange: (v: string) => void;
  clearable?: boolean;
}) {
  const rows: PickerRow[] = useMemo(
    () =>
      levies.map((l) => ({
        id: l.id,
        label: l.description || `Entry #${l.entry_no}`,
        sublabel: `Entry #${l.entry_no}`,
        inactive: isInactive(l),
      })),
    [levies],
  );
  return (
    <DataPicker
      label={label}
      rows={rows}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      clearable={clearable}
    />
  );
}

/**
 * Picker over the Materials master (`items`). Select-only by default — used by
 * the "Using (Items)" grid to link a line to a real material regardless of
 * class (0304). When `quickCreateClassId` + manage permissions are given (e.g.
 * the Fabric ▸ Attributes component-yarn list), it also gets inline
 * **Add / Modify / Delete**: quick-create only sets the Name inside that item
 * class (code auto-generated), Modify renames, Delete soft-deactivates when
 * the item is in use — richer fields stay editable from the full Materials
 * master, same as the CategoryPicker precedent.
 *
 * With `yarnQuickCreate` (Component Yarn pickers), "+ Add" instead opens the
 * full `YarnQuickCreateSheet` — a complete Yarn (Count/Category/Purity/Type,
 * auto-name, kg UOMs) without leaving the host form (client 2026-07-23,
 * Fabric Master #11). Modify/Delete keep the inline rename/soft-delete.
 */
export function ItemPicker({
  label,
  title,
  items,
  value,
  onChange,
  usedIds,
  clearable = true,
  required = false,
  placeholder,
  compact = false,
  quickCreateClassId,
  canCreate = false,
  canEdit = false,
  canDelete = false,
  yarnQuickCreate,
  garmentQuickCreate,
}: {
  label: string;
  title?: string;
  /** Pass the WHOLE material rows — the disable flag rides along and the panel
   *  hides switched-off items itself. Callers must not pre-filter. */
  items: ({ id: string; code: string; name: string } & Deactivatable)[];
  value: string;
  onChange: (v: string) => void;
  /**
   * Pick-once inside a repeating grid: ids already taken by the sibling rows.
   * Straight through to `DataPicker` — see the prop there for when it applies
   * and, just as importantly, when it must not.
   */
  usedIds?: Iterable<string> | null;
  clearable?: boolean;
  /**
   * Draws the red `*` AND holds the cursor while the field is blank — one
   * declaration, both halves, same as every other picker.
   *
   * This is the SANCTIONED route for a cell inside a grid that renders
   * `renderMobileRow`: `ChildGridColumn.required` never reaches those rows
   * (child-grid.tsx says so where the prop is defined), so declaring it
   * there would draw a star with nothing behind it.
   */
  required?: boolean;
  placeholder?: string;
  /** Trigger-only (no label) for dense grid rows — as `LookupDialogPicker`. */
  compact?: boolean;
  /** Item class new quick-created items belong to — enables the CRUD bar. */
  quickCreateClassId?: string;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  /** Lookup lists for the full Yarn quick-create sheet — when set (together
   *  with `quickCreateClassId`), "+ Add" opens it instead of the inline
   *  name-only form. `categories` must already be YARN-scoped by the caller. */
  yarnQuickCreate?: {
    counts: ConfigLookup[];
    purities: ConfigLookup[];
    yarnTypes: ConfigLookup[];
    categories: Category[];
    kgUnitId?: string | null;
  };
  /**
   * The same door as `yarnQuickCreate`, for item class GARMENTS: when set
   * (together with `quickCreateClassId`) "+ Add" opens the full garment
   * mini-form instead of the inline name-only one. `categories` must already
   * be GARMENTS-scoped by the caller, exactly as the yarn one must be
   * YARN-scoped.
   *
   * TWO PROPS RATHER THAN ONE GENERIC `quickCreate`, deliberately: the two
   * classes need genuinely different forms (a yarn has Count and Purity, a
   * garment has neither), and `MATERIAL_FORMS` says the same thing about the
   * five classes generally. A single prop would have to carry the union of
   * every class's lists and then decide at runtime which half is real.
   */
  garmentQuickCreate?: {
    categories: Category[];
    uoms: { id: string; code: string | null; name: string; inactive?: boolean }[];
    levies: Levy[];
    fabricStructures: ConfigLookup[];
    itemClasses: ConfigLookup[];
  };
}) {
  const router = useRouter();
  // Yarn quick-create sheet state — `qcCommit` holds the host dialog's commit
  // so a successful create can select the new yarn and close the picker.
  const [qcOpen, setQcOpen] = useState(false);
  const qcCommit = useRef<((id: string) => void) | null>(null);
  // Quick-created items, visible immediately; the server row (with its real
  // generated code) replaces the stub once router.refresh() lands.
  // Same shape as `items` so the merged list keeps the disable flag — a bare
  // {id, code, name} here would widen `all` back to flag-less and silently
  // un-hide every switched-off material.
  const [extra, setExtra] = useState<
    ({ id: string; code: string; name: string } & Deactivatable)[]
  >([]);
  const all = useMemo(() => {
    const seen = new Set<string>();
    return [...items, ...extra].filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
  }, [items, extra]);
  // Codes are backend-only (client 2026-07-23) — rows show just the name.
  const rows: PickerRow[] = useMemo(
    () => all.map((it) => ({ id: it.id, label: it.name, inactive: isInactive(it) })),
    [all],
  );

  const manage: ManageConfig | undefined =
    quickCreateClassId && (canCreate || canEdit || canDelete)
      ? {
          canCreate,
          canEdit,
          canDelete,
          onCreate: (d) => quickCreateMaterial(quickCreateClassId, d.name),
          onUpdate: (id, d) => renameMaterial(id, d.name),
          onDelete: (id) => deleteMaterial(id),
          onCreated: (id, d) => {
            setExtra((xs) => [...xs, { id, code: "", name: d.name }]);
            router.refresh();
          },
          onUpdated: (id, d) => {
            setExtra((xs) => {
              const has = xs.some((it) => it.id === id);
              if (has) return xs.map((it) => (it.id === id ? { ...it, name: d.name } : it));
              const base = items.find((it) => it.id === id);
              return base ? [...xs, { ...base, name: d.name }] : xs;
            });
            router.refresh();
          },
          onDeleted: (id, inactive) => {
            if (!inactive) setExtra((xs) => xs.filter((it) => it.id !== id));
            router.refresh();
          },
          // code unused by renameMaterial — the stored code is preserved server-side.
          draftOf: (row) => ({ code: "", name: row.label }),
        }
      : undefined;

  const useYarnQc = !!yarnQuickCreate && !!quickCreateClassId;
  const useGarmentQc = !useYarnQc && !!garmentQuickCreate && !!quickCreateClassId;

  return (
    <>
      <DataPicker
        label={label}
        title={title}
        placeholder={placeholder}
        rows={rows}
        value={value}
        onChange={(v) => onChange(v ?? "")}
        usedIds={usedIds}
        clearable={clearable}
        required={required}
        compact={compact}
        manage={manage}
        onAddOverride={
          useYarnQc || useGarmentQc
            ? (commit) => {
                qcCommit.current = commit;
                setQcOpen(true);
              }
            : undefined
        }
      />
      {useYarnQc && (
        <YarnQuickCreateSheet
          open={qcOpen}
          onClose={() => setQcOpen(false)}
          onCreated={({ id, code, name }) => {
            // Same optimistic flow as manage.onCreated: stub the new yarn into
            // the list, select it (committing also closes the picker dialog),
            // and let router.refresh() swap in the real server row.
            setExtra((xs) => [...xs, { id, code, name }]);
            (qcCommit.current ?? onChange)(id);
            router.refresh();
          }}
          yarnClassId={quickCreateClassId!}
          counts={yarnQuickCreate!.counts}
          purities={yarnQuickCreate!.purities}
          yarnTypes={yarnQuickCreate!.yarnTypes}
          categories={yarnQuickCreate!.categories}
          kgUnitId={yarnQuickCreate!.kgUnitId}
          perms={{ canCreate, canEdit, canDelete }}
        />
      )}
      {useGarmentQc && (
        <GarmentQuickCreateSheet
          open={qcOpen}
          onClose={() => setQcOpen(false)}
          onCreated={({ id, code, name }) => {
            // Same optimistic flow as the yarn sheet above.
            setExtra((xs) => [...xs, { id, code, name }]);
            (qcCommit.current ?? onChange)(id);
            router.refresh();
          }}
          garmentClassId={quickCreateClassId!}
          categories={garmentQuickCreate!.categories}
          uoms={garmentQuickCreate!.uoms}
          levies={garmentQuickCreate!.levies}
          fabricStructures={garmentQuickCreate!.fabricStructures}
          itemClasses={garmentQuickCreate!.itemClasses}
          perms={{ canCreate, canEdit, canDelete }}
        />
      )}
    </>
  );
}

/**
 * Picker over the rich `categories` master (0223) — the caller scopes
 * `categories` to the parent Item Class before passing it in, so this never
 * shows categories from other item classes (cascading-picker rule). When
 * `itemClassId` + a manage permission are given, it also gets inline
 * **Add / Modify / Delete** (quick-create only sets Short Name + Name; richer
 * fields like Made/Levy stay editable from the full Category master).
 */
export function CategoryPicker({
  label,
  title,
  placeholder,
  categories,
  value,
  onChange,
  usedIds,
  clearable = true,
  required = false,
  itemClassId,
  selectedClassCode,
  canCreate = false,
  canEdit = false,
  canDelete = false,
  levies,
  fabricStructures,
  itemClasses,
  compact = false,
  id,
}: {
  label: string;
  /**
   * The empty-state text. `DataPicker` defaults to `— Select {noun} —`, which
   * LAYOUT.md's own convention (§5a: "a field select's blank first option reads
   * `— Select —` / `— None —`") is shorter than — and on a narrow field the
   * noun is what pushes it past the box, with the label above already naming it.
   */
  placeholder?: string;
  /** Overrides `label` for the panel title and toasts — for a grid cell, whose
   *  column header already names the field and so passes `label=""`. Same prop
   *  and same reason as `ItemPicker` above. */
  title?: string;
  categories: Category[];
  value: string;
  onChange: (v: string) => void;
  /**
   * Pick-once inside a repeating grid: ids already taken by the sibling rows.
   * Straight through to `DataPicker` — see the prop there.
   *
   * Where the grid's real key is a PAIR (Vendor ▸ Item Category is unique on
   * Item Class + Category), the caller must build this from the rows sharing
   * this row's class — a flat set over the Category column alone would refuse a
   * category that is legitimately used under a different class.
   */
  usedIds?: Iterable<string> | null;
  clearable?: boolean;
  required?: boolean;
  /** Parent Item Class id — new categories are created scoped to it; Add is
   *  disabled until it's set. */
  itemClassId?: string;
  /** Parent Item Class CODE (YARN/FABRIC/GEN/…) — drives which fields the
   *  full quick-create sheet renders (Category Type, Fabric Structure, …). */
  selectedClassCode?: string | null;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  /** Lookup lists for the full quick-create sheet — when set (with an
   *  `itemClassId` + create permission), "+ Add" opens the complete Category
   *  mini-child instead of the inline name-only form. */
  levies?: Levy[];
  fabricStructures?: ConfigLookup[];
  /** Pass this and the quick-create sheet ASKS for the Item Class itself,
   *  driving its own class-dependent fields from the answer. Omit it and the
   *  class comes from `itemClassId`, which is what a caller whose form already
   *  asked (the Material child) must do — two forms asking one question drift. */
  itemClasses?: ConfigLookup[];
  /** Trigger-only (no label) for a dense grid row or a `<Field>` that already
   *  draws the label. Straight through to `DataPicker`, same as every other
   *  adapter — without it a caller wrapping this in `<Field label>` gets the
   *  label twice. */
  compact?: boolean;
  /**
   * Anchors the field for `goToSection(..., { fieldId })` — a blocked Save jumps
   * to the section AND focuses the offending control, and that lookup is a plain
   * `querySelector("#id")`, so an id that never reaches the DOM makes the jump
   * silently do nothing. Straight through to `DataPicker`.
   */
  id?: string;
}) {
  const router = useRouter();
  const [extra, setExtra] = useState<Category[]>([]);
  // Full quick-create sheet state — `qcCommit` holds the picker dialog's commit
  // so a successful create can select the new category and close the dialog.
  const [qcOpen, setQcOpen] = useState(false);
  const qcCommit = useRef<((id: string) => void) | null>(null);

  // extra is scoped to whichever item class it was added under — filter it
  // to the current one so switching Item Class doesn't leak stale additions.
  const all = useMemo(() => {
    const scopedExtra = itemClassId ? extra.filter((c) => c.item_class_id === itemClassId) : extra;
    const seen = new Set<string>();
    return [...categories, ...scopedExtra].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  }, [categories, extra, itemClassId]);

  const byId = useMemo(() => new Map(all.map((c) => [c.id, c])), [all]);

  const rows: PickerRow[] = useMemo(
    () =>
      all.map((c) => ({
        id: c.id,
        label: c.name || c.short_name || "—",
        sublabel: c.short_spec,
        inactive: isInactive(c),
      })),
    [all],
  );

  const canAdd = canCreate && !!itemClassId;
  const manage: ManageConfig | undefined =
    canAdd || canEdit || canDelete
      ? {
          canCreate: canAdd,
          canEdit,
          canDelete,
          onCreate: (d) =>
            createCategory({
              item_class_id: itemClassId!,
              short_name: d.code || null,
              name: d.name,
              short_spec: null,
              made: null,
              levy_id: null,
              fabric_structure_id: null,
              wastage_per: 0,
              profit_per: 0,
              freight_per: 0,
              insurance_per: 0,
              interest_per: 0,
              size_group_id: null,
              status_monitoring_type: null,
              user_defined: false,
              inactive: false,
              has_sub_categories: false,
              sub_categories: [],
            }),
          onUpdate: (id, d) => {
            const existing = byId.get(id);
            return updateCategory(id, {
              item_class_id: existing?.item_class_id ?? itemClassId!,
              short_name: d.code || null,
              name: d.name,
              short_spec: existing?.short_spec ?? null,
              made: existing?.made ?? null,
              levy_id: existing?.levy_id ?? null,
              fabric_structure_id: existing?.fabric_structure_id ?? null,
              wastage_per: existing?.wastage_per ?? 0,
              profit_per: existing?.profit_per ?? 0,
              freight_per: existing?.freight_per ?? 0,
              insurance_per: existing?.insurance_per ?? 0,
              interest_per: existing?.interest_per ?? 0,
              size_group_id: existing?.size_group_id ?? null,
              status_monitoring_type: existing?.status_monitoring_type ?? null,
              user_defined: existing?.user_defined ?? false,
              inactive: existing?.inactive ?? false,
              // This is a RENAME-only path, but updateCategory reconciles the
              // sub-category grid from whatever it is handed — sending [] here
              // would silently delete every sub-category on a rename. Pass the
              // stored rows straight back through, ids included (0349).
              has_sub_categories: existing?.has_sub_categories ?? false,
              sub_categories: (existing?.sub_categories ?? []).map((c) => ({
                id: c.id,
                sno: c.sno,
                name: c.name,
              })),
            });
          },
          onDelete: (id) => deleteCategory(id),
          onCreated: (id, d) => {
            setExtra((xs) => [
              ...xs,
              {
                id,
                item_class_id: itemClassId!,
                short_name: d.code || null,
                name: d.name,
                short_spec: null,
                made: null,
                levy_id: null,
                fabric_structure_id: null,
                wastage_per: null,
                profit_per: null,
                freight_per: null,
                insurance_per: null,
                interest_per: null,
                size_group_id: null,
                status_monitoring_type: null,
                user_defined: false,
                inactive: false,
                has_sub_categories: false,
                sub_categories: [],
                created_by: null,
                created_by_name: null,
                created_at: "",
                updated_at: "",
              },
            ]);
            router.refresh();
          },
          onUpdated: (id, d) => {
            setExtra((xs) => {
              const has = xs.some((c) => c.id === id);
              if (has) return xs.map((c) => (c.id === id ? { ...c, short_name: d.code || null, name: d.name } : c));
              const base = categories.find((c) => c.id === id);
              return base ? [...xs, { ...base, short_name: d.code || null, name: d.name }] : xs;
            });
            router.refresh();
          },
          onDeleted: (id, inactive) => {
            setExtra((xs) => {
              if (!inactive) return xs.filter((c) => c.id !== id);
              const has = xs.some((c) => c.id === id);
              if (has) return xs.map((c) => (c.id === id ? { ...c, inactive: true } : c));
              const base = categories.find((c) => c.id === id);
              return base ? [...xs, { ...base, inactive: true }] : xs;
            });
            router.refresh();
          },
          draftOf: (row) => {
            const c = byId.get(row.id);
            return { code: c?.short_name ?? "", name: c?.name ?? "" };
          },
        }
      : undefined;

  // "+ Add" opens the full mini-child sheet when the caller wired the lookup
  // lists through; otherwise it falls back to the inline name-only add form.
  const useFullQc = canAdd && !!(levies && fabricStructures);

  return (
    <>
      <DataPicker
        label={label}
        title={title}
        placeholder={placeholder}
        rows={rows}
        value={value}
        onChange={(v) => onChange(v ?? "")}
        usedIds={usedIds}
        clearable={clearable}
        required={required}
        compact={compact}
        id={id}
        manage={manage}
        onAddOverride={
          useFullQc
            ? (commit) => {
                qcCommit.current = commit;
                setQcOpen(true);
              }
            : undefined
        }
      />
      {useFullQc && (
        <CategoryQuickCreateSheet
          open={qcOpen}
          onClose={() => setQcOpen(false)}
          onCreated={(cat) => {
            // Same optimistic flow as manage.onCreated: stub the new category
            // into the list, select it (committing also closes the picker
            // dialog), and let router.refresh() swap in the real server row.
            setExtra((xs) => [...xs, cat]);
            (qcCommit.current ?? onChange)(cat.id);
            router.refresh();
          }}
          itemClassId={itemClassId!}
          selectedClassCode={selectedClassCode ?? null}
          itemClasses={itemClasses}
          levies={levies!}
          fabricStructures={fabricStructures!}
          perms={{ canCreate, canEdit, canDelete }}
        />
      )}
    </>
  );
}

/**
 * Select-only picker over an Item Class's Attribute values (0220, merged
 * into Item Class by 0293) — the caller scopes `values` to the parent Item
 * Class before passing it in, so this never shows attributes from other
 * item classes (cascading-picker rule).
 */
export function AttributePicker({
  label,
  values,
  value,
  onChange,
  clearable = true,
  required = false,
  invalid = false,
}: {
  label: string;
  values: AttributeValue[];
  value: string;
  onChange: (v: string) => void;
  clearable?: boolean;
  required?: boolean;
  /** Set when the host grid already lists this attribute on another line — one
   *  attribute may appear only once per set (0350). */
  invalid?: boolean;
}) {
  // No `inactive`: `attribute_values` has no disable column (it is a child of the
  // Attribute row, which is what gets switched off). Flag-less by construction —
  // see FLAGLESS_PICKERS in scripts/audit_layout.py.
  const rows: PickerRow[] = useMemo(
    () => values.map((v) => ({ id: v.id, label: v.value })),
    [values],
  );
  return (
    <DataPicker
      label={label}
      rows={rows}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      clearable={clearable}
      required={required}
      invalid={invalid}
    />
  );
}
