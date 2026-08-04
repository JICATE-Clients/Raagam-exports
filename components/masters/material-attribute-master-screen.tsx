"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PaginationBar } from "@/components/ui/pagination";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { usePagination } from "@/lib/use-pagination";
import { useMasterFilter } from "@/lib/masters/use-master-filter";
import { FilterBar } from "@/components/ui/filter-bar";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import {
  createMaterialAttribute,
  updateMaterialAttribute,
  deleteMaterialAttribute,
} from "@/lib/masters/material-attribute-actions";
import type { MaterialAttribute, MaterialAttributeInput } from "@/lib/masters/material-attribute-types";
import type { Attribute, ConfigLookup } from "@/lib/masters/extras-types";
import type { Category } from "@/lib/masters/category-types";
import type { Levy } from "@/lib/masters/levy-types";
import { CategoryPicker, AttributePicker } from "@/components/masters/lookup-picker";
import { ChildGrid, gridKeyNav } from "@/components/masters/child-grid";
import { IdentityRow } from "@/components/masters/section-grid";
import { DetailSection } from "@/components/masters/detail-section";
import { RowActions, rowActionsColumn } from "@/components/ui/row-actions";
import { createdMeta, withCreatedColumns } from "@/components/ui/created-columns";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; isSuperAdmin: boolean; canExport?: boolean };

type OptionRow = { key: string; description: string; blocked: boolean };
type LineRow = {
  key: string;
  attribute_id: string;
  value_in_steps: boolean;
  start_value: string;
  end_value: string;
  /** Kept only so a line configured before 0350 saves back with its old UOM
   *  reference intact — nothing on this screen reads or sets it any more. */
  unit_id: string;
  unit_label: string;
  step_value: string;
  mandatory: boolean;
  inactive: boolean;
  options: OptionRow[];
};

const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

/** Preview of the values a Value-In-Steps line will offer on the Material form
 *  (must mirror `stepValues` in material-master-screen.tsx): the start value,
 *  then step, 2×step, 3×step … above start and ≤ end. */
function previewSteps(start: number | null, end: number | null, step: number | null): number[] {
  if (start == null || end == null || !step || step <= 0 || end < start) return [];
  const out = [Number(start.toFixed(4))];
  for (let k = 1; k * step <= end + 1e-9 && out.length < 1000; k++) {
    const v = Number((k * step).toFixed(4));
    if (v > start) out.push(v);
  }
  return out;
}

/**
 * Master-detail CRUD for the legacy "Material attributes" master: a header
 * (Item Class scoped to Pack/Sew · Category) plus a per-attribute value-spec
 * grid (range/step/unit/mandatory/inactive), each line picking one of the
 * selected Item Class's Attribute Values (0293: Attribute was merged into
 * Item Class — the named-value child grid is what these lines pick from).
 *
 * dup-check: exempt -- the duplicate is prevented EARLIER and better here. The
 * identity is the (item_class_id, category_id) pair, and a category already
 * spoken for is removed from the Category picker, so the collision cannot be
 * typed in the first place. `uq_material_attributes_class_category` (0347) is
 * the backstop. A live check would also need `dup-guard`'s eq mode, since both
 * columns are uuids and `.ilike()` has no operator for them.
 */
export function MaterialAttributeMasterScreen({
  rows,
  attributes,
  categories,
  levies,
  fabricStructures,
  perms,
}: {
  rows: MaterialAttribute[];
  attributes: Attribute[];
  categories: Category[];
  levies: Levy[];
  fabricStructures: ConfigLookup[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [itemClassId, setItemClassId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  // Legacy screen has no separator field — the generated item name always joins
  // its parts with " / " (client 2026-07-25, matches legacy: "LABEL / MAIN / PRINTED / …").
  const NAME_SEPARATOR = " / ";
  const [lines, setLines] = useState<LineRow[]>([]);
  /**
   * Which attribute lines are showing their value list. A SET — any number at
   * once, like the legacy grid's ⊟/⊞ (screenshot 2026-07-27).
   *
   * It used to be one key, "at most one open", and the reason was purely
   * mechanical: a line's spec occupied several stacked rows, so a few open lines
   * pushed "+ Add attribute" below the fold (client 2026-07-27). Both halves of
   * that are gone — a line is one row now, and the trailing star row replaced the
   * button — so the restriction was buying nothing and cost the operator the
   * ability to compare two attributes side by side.
   */
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const toggleExpanded = (key: string) =>
    setExpandedKeys((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const keySeq = useRef(0);
  const newKey = () => `l${keySeq.current++}`;
  const optSeq = useRef(0);
  const newOptKey = () => `o${optSeq.current++}`;

  const classLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of attributes) m.set(a.id, a.name);
    return m;
  }, [attributes]);
  const categoryName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name || c.short_name || "—");
    return m;
  }, [categories]);
  const categoryShortName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.short_name || "—");
    return m;
  }, [categories]);
  const attrValueLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of attributes) for (const v of a.values) m.set(v.id, v.value);
    return m;
  }, [attributes]);

  // Cascading options: Category and Attribute Value only ever show rows
  // scoped to the selected Item Class — never the full/global list.
  const scopedCategories = useMemo(
    () => categories.filter((c) => c.item_class_id === itemClassId),
    [categories, itemClassId],
  );
  // One config per (Item Class + Category): when adding, hide categories that
  // already have a config so a duplicate can't be created — the user edits the
  // existing one instead. When editing, the current category stays selectable.
  const configuredCategoryIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      if (r.item_class_id === itemClassId && r.category_id && r.id !== editId) s.add(r.category_id);
    }
    return s;
  }, [rows, itemClassId, editId]);
  const availableCategories = useMemo(
    () => scopedCategories.filter((c) => !configuredCategoryIds.has(c.id)),
    [scopedCategories, configuredCategoryIds],
  );
  const scopedAttributeValues = useMemo(
    () => attributes.find((a) => a.id === itemClassId)?.values ?? [],
    [attributes, itemClassId],
  );
  // Class CODE of the picked Item Class — drives which fields the Category
  // quick-create mini-child renders. Always PACK/SEW: the page filters
  // `attributes` through isAccessoryClass before this screen sees them.
  const selectedClassCode = useMemo(
    () => attributes.find((a) => a.id === itemClassId)?.code ?? null,
    [attributes, itemClassId],
  );

  function changeItemClass(v: string) {
    setItemClassId(v);
    setCategoryId("");
  }

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset, dateFilter } = useMasterFilter<
    MaterialAttribute,
    { itemClass: string; category: string }
  >(rows, {
    search: (r, q) =>
      [
        classLabel.get(r.item_class_id ?? ""),
        categoryName.get(r.category_id ?? ""),
        categoryShortName.get(r.category_id ?? ""),
        ...r.lines.map((l) => attrValueLabel.get(l.attribute_id ?? "")),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    filters: {
      itemClass: (r, v) => r.item_class_id === v,
      category: (r, v) => r.category_id === v,
    },
    initialFilters: { itemClass: "", category: "" },
  });

  const pg = usePagination(filtered, 10);

  function blankLine(): LineRow {
    return {
      key: newKey(),
      attribute_id: "",
      value_in_steps: false,
      start_value: "",
      end_value: "",
      unit_id: "",
      unit_label: "",
      step_value: "",
      mandatory: false,
      inactive: false,
      // No values, and no blank one either. A value box appears when the operator
      // asks for one — "+ Add value", or Enter off the last value — never as a
      // permanently open empty field (client 2026-08-04).
      options: [],
    };
  }

  /**
   * THE STAR ROW. Legacy's grid always ends in a blank `*` line: you type in it
   * and it becomes a row, and a fresh blank takes its place (screenshot
   * 2026-07-27). That is the whole add affordance — legacy has no "+ Add"
   * button anywhere on this screen, which is why asking where ours should sit
   * kept producing unsatisfying answers.
   *
   * Cheap to keep honest: `submit()` already drops lines with no attribute
   * picked, so the trailing blank never reaches the server.
   */
  const withStarRow = (ls: LineRow[]): LineRow[] =>
    ls.length && !ls[ls.length - 1].attribute_id ? ls : [...ls, blankLine()];

  function openAdd() {
    setEditId(null);
    setItemClassId("");
    setCategoryId("");
    const first = blankLine();
    setLines([first]);
    setExpandedKeys(new Set([first.key]));
    setOpen(true);
  }
  function openEdit(r: MaterialAttribute) {
    setEditId(r.id);
    setItemClassId(r.item_class_id ?? "");
    setCategoryId(r.category_id ?? "");
    const built: LineRow[] =
      r.lines.length
        ? r.lines.map((l) => ({
            key: newKey(),
            attribute_id: l.attribute_id ?? "",
            value_in_steps: l.value_in_steps,
            start_value: l.start_value != null ? String(l.start_value) : "",
            end_value: l.end_value != null ? String(l.end_value) : "",
            unit_id: l.unit_id ?? "",
            unit_label: l.unit_label ?? "",
            step_value: l.step_value != null ? String(l.step_value) : "",
            mandatory: l.mandatory,
            inactive: l.inactive,
            options: (l.options ?? []).map((o) => ({
              key: newOptKey(),
              description: o.description,
              blocked: o.blocked,
            })),
          }))
        : [];
    setLines(withStarRow(built));
    // Stepped lines: re-derive the generated value list from the stored
    // Start/End/Step/Unit so it shows immediately (blocked flags preserved).
    setLines((ls) => ls.map((l) => (l.value_in_steps ? { ...l, options: genOptions(l) } : l)));
    // Open the first line: on an existing record the user is usually here to
    // change one attribute, and a fully collapsed list gives no clue that the
    // rows expand at all.
    setExpandedKeys(new Set(built[0] ? [built[0].key] : []));
    setOpen(true);
  }

  /**
   * Patch a line and re-assert the star row: the moment the trailing blank gains
   * an attribute it stops being the star row, so a fresh blank takes its place.
   * That single rule is the whole "add" mechanism on this screen.
   */
  const setLineAt = (key: string, patch: Partial<LineRow>) =>
    setLines((ls) => withStarRow(ls.map((l) => (l.key === key ? { ...l, ...patch } : l))));
  const removeLine = (key: string) => {
    setLines((ls) => withStarRow(ls.filter((l) => l.key !== key)));
    setExpandedKeys((s) => {
      if (!s.has(key)) return s;
      const next = new Set(s);
      next.delete(key);
      return next;
    });
  };

  /**
   * Picking the attribute is what turns the star row into a real line, so it is
   * also the moment to OPEN it.
   *
   * Without this the new row arrived collapsed and the operator had to click its
   * chevron before they could type a single value — "if the user moves to the
   * next attribute it is automatically closed" (client 2026-08-04). Nothing was
   * closing it; it had simply never been opened, which looks identical from the
   * outside. Opening on the pick means the whole flow — pick, type values, move
   * on — never needs the mouse.
   *
   * Only ever ADDS a key. Whatever else the operator has open stays open; that
   * is the point of `expandedKeys` being a set.
   */
  const pickAttribute = (key: string, attributeId: string) => {
    setLineAt(key, { attribute_id: attributeId });
    if (attributeId) setExpandedKeys((s) => (s.has(key) ? s : new Set(s).add(key)));
  };

  /**
   * Per-line pre-defined value list (legacy nested grid). Enter on the last
   * value adds the next one, so a held Enter would otherwise stack blank rows —
   * there is nothing to add until the row already there has been typed into.
   *
   * THE REFUSAL IS THE ESCALATION. Returning `false` makes `gridKeyNav` decline
   * the key instead of swallowing it, so Enter carries up to the attribute grid
   * and starts the next ATTRIBUTE. That is the whole "Enter Enter" path: Enter
   * after the last value opens a blank box, Enter on the blank box means "no
   * more values here" and moves the operator on. Before this the refusal
   * happened inside the `setLines` updater, where the caller could not see it,
   * and Enter was simply dead in that box (client 2026-08-04).
   *
   * Decided against the current `lines`, not inside the updater, because the
   * answer has to be known SYNCHRONOUSLY — the keydown is already deciding
   * whether to preventDefault.
   */
  const addOption = (lineKey: string): boolean => {
    const line = lines.find((l) => l.key === lineKey);
    if (!line) return false;
    const last = line.options[line.options.length - 1];
    if (last && !last.description.trim()) return false;
    setLines((ls) =>
      ls.map((l) =>
        l.key === lineKey
          ? { ...l, options: [...l.options, { key: newOptKey(), description: "", blocked: false }] }
          : l,
      ),
    );
    return true;
  };
  const setOptionAt = (lineKey: string, optKey: string, patch: Partial<OptionRow>) =>
    setLines((ls) =>
      ls.map((l) =>
        l.key === lineKey
          ? { ...l, options: l.options.map((o) => (o.key === optKey ? { ...o, ...patch } : o)) }
          : l,
      ),
    );
  const removeOption = (lineKey: string, optKey: string) =>
    setLines((ls) =>
      ls.map((l) =>
        l.key === lineKey
          ? { ...l, options: l.options.filter((o) => o.key !== optKey) }
          : l,
      ),
    );

  // Regenerate a Value-In-Steps line's value list from Start/End/Step/Unit.
  // This is what auto-fills "0 MM, 10 MM … 100 MM" (legacy 2100).
  //
  // Generated values are never individually blocked — narrow Start/End/Step
  // instead. This used to carry blocked flags across a regen by matching on the
  // description string, which meant changing the Unit rewrote every description
  // ("10" → "10 MM") and silently cleared every flag the user had set. With the
  // per-value box gone for stepped lines, that whole failure mode goes with it.
  const genOptions = (l: LineRow): OptionRow[] => {
    const vals = previewSteps(numOrNull(l.start_value), numOrNull(l.end_value), numOrNull(l.step_value));
    // Typed label, not a UOM lookup (client 2026-07-28) — see the Unit field.
    const uname = l.unit_label.trim();
    return vals.map((v) => ({
      key: newOptKey(),
      description: uname ? `${v} ${uname}` : String(v),
      blocked: false,
    }));
  };
  /**
   * Duplicates, caught as they are typed (client 2026-07-28).
   *
   * The screen used to accept the same attribute on two lines of one set, and
   * the same value twice inside one attribute's list — both save cleanly and
   * then show up twice in the Material form's dropdown, which is where the
   * client found them. 0350 forbids both in the database
   * (`uq_material_attribute_lines_attr`, `uq_mal_options_desc`) and the actions
   * reject a stale post; these two sets are what turns the row red and holds
   * Save while it is still fixable.
   *
   * Blanks never count: an unpicked line or an empty value box is unfinished,
   * not wrong.
   */
  const duplicateAttrIds = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const l of lines) {
      if (!l.attribute_id) continue;
      if (seen.has(l.attribute_id)) dup.add(l.attribute_id);
      else seen.add(l.attribute_id);
    }
    return dup;
  }, [lines]);
  /** line key → the normalised descriptions that appear more than once in it.
   *  Normalised the same way as the DB index: trimmed and upper-cased. */
  const duplicateOptions = useMemo(() => {
    const byLine = new Map<string, Set<string>>();
    for (const l of lines) {
      const seen = new Set<string>();
      const dup = new Set<string>();
      for (const o of l.options) {
        const norm = o.description.trim().toUpperCase();
        if (!norm) continue;
        if (seen.has(norm)) dup.add(norm);
        else seen.add(norm);
      }
      byLine.set(l.key, dup);
    }
    return byLine;
  }, [lines]);
  const hasDuplicateLine = duplicateAttrIds.size > 0;
  // Stepped lines can't produce a duplicate (previewSteps is strictly
  // increasing), but they are counted anyway — the gate should follow the DB
  // constraint, not an argument about why it can't be hit.
  const hasDuplicateOption = useMemo(
    () => [...duplicateOptions.values()].some((s) => s.size > 0),
    [duplicateOptions],
  );

  // Update a line and, when it is Value-In-Steps, regenerate its value list so
  // the rows stay in sync with the Start/End/Step/Unit fields.
  const patchLine = (key: string, patch: Partial<LineRow>) =>
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        // Stepped lines regenerate their (read-only) list; a manual one keeps
        // whatever the operator typed, untouched.
        if (next.value_in_steps) next.options = genOptions(next);
        return next;
      }),
    );

  function submit() {
    startTransition(async () => {
      const payload: MaterialAttributeInput = {
        // Both mandatory now — the pair is this record's unique key (0347). Save
        // is already disabled until each is picked, so the empty string can only
        // reach here if that gate is ever removed, and the schema will say so.
        item_class_id: itemClassId,
        category_id: categoryId,
        name_separator: NAME_SEPARATOR,
        lines: lines
          .filter((l) => l.attribute_id)
          .map((l, i) => ({
            sno: i + 1,
            attribute_id: l.attribute_id,
            value_in_steps: l.value_in_steps,
            start_value: numOrNull(l.start_value),
            end_value: numOrNull(l.end_value),
            // unit_id is never edited here any more, but keeps round-tripping
            // so a pre-0350 line is not stripped of it by an unrelated edit.
            unit_id: l.unit_id || null,
            unit_label: l.unit_label.trim() || null,
            step_value: numOrNull(l.step_value),
            mandatory: l.mandatory,
            inactive: l.inactive,
            // Persist the value list for BOTH stepped (auto-generated) and
            // manual lines — it's the single source of the Material dropdown.
            options: l.options
              .filter((o) => o.description.trim())
              .map((o, j) => ({ sno: j + 1, description: o.description.trim(), blocked: o.blocked })),
          })),
      };
      const res = editId
        ? await updateMaterialAttribute(editId, payload)
        : await createMaterialAttribute(payload);
      if (res.ok) {
        success(editId ? "Material attribute updated." : "Material attribute added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: MaterialAttribute) {
    startTransition(async () => {
      const res = await deleteMaterialAttribute(r.id);
      if (res.ok) {
        success("Material attribute deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<MaterialAttribute>[] = [
    {
      header: "Item Class",
      cell: (r) => <span className="text-sm">{r.item_class_id ? classLabel.get(r.item_class_id) ?? "—" : "—"}</span>,
    },
    {
      header: "Category",
      cell: (r) => <span className="text-sm">{r.category_id ? categoryName.get(r.category_id) ?? "—" : "—"}</span>,
    },
    {
      header: "Attributes",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm text-muted-foreground">{r.lines.length}</span>,
    },
    rowActionsColumn((r) => (
      <RowActions
        onEdit={() => openEdit(r)}
        onDelete={() => remove(r)}
        canEdit={perms.canEdit}
        canDelete={perms.canDelete}
        isPending={isPending}
      />
    )),
  ];

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterBar
          search={query}
          onSearch={(v) => {
            setQuery(v);
            pg.setPage(1);
          }}
          searchPlaceholder="Search material attributes…"
          activeCount={activeCount}
          dateFilter={{
            ...dateFilter,
            onChange: (v) => {
              dateFilter.onChange(v);
              pg.setPage(1);
            },
          }}
          onReset={reset}
        >
          <div>
            <Label htmlFor="ma-filter-class">Item Class</Label>
            <Select
              id="ma-filter-class"
              value={filterValues.itemClass}
              onChange={(e) => {
                setFilter("itemClass", e.target.value);
                pg.setPage(1);
              }}
            >
              <option value="">All</option>
              {attributes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="ma-filter-cat">Category</Label>
            <Select
              id="ma-filter-cat"
              value={filterValues.category}
              onChange={(e) => {
                setFilter("category", e.target.value);
                pg.setPage(1);
              }}
            >
              <option value="">All</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.short_name || "—"}
                </option>
              ))}
            </Select>
          </div>
        </FilterBar>
        <div className="flex flex-1 items-center justify-end gap-2">
          <DataIoToolbar entityKey="material-attributes" rows={filtered} canExport={perms.canExport} />
          {perms.canCreate && (
            <Button size="md" onClick={openAdd}>
              + Add Material Attribute
            </Button>
          )}
        </div>
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={withCreatedColumns(columns, pg.paged)} rows={pg.paged} getKey={(r) => r.id} empty="No material attributes yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No material attributes yet.
          </div>
        ) : (
          pg.paged.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => perms.canEdit && openEdit(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="text-[15px] font-semibold text-foreground">
                {r.item_class_id ? classLabel.get(r.item_class_id) ?? "—" : "—"}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {r.category_id ? categoryName.get(r.category_id) ?? "—" : "No category"}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{createdMeta(r)}</div>
              <div className="mt-2 text-[13px] text-muted-foreground">
                {r.lines.length} attribute{r.lines.length === 1 ? "" : "s"}
              </div>
            </button>
          ))
        )}
      </div>

      <PaginationBar
        page={pg.page}
        pageCount={pg.pageCount}
        total={pg.total}
        pageSize={pg.pageSize}
        onPageChange={pg.setPage}
        onPageSizeChange={pg.setPageSize}
      />

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Material Attribute" : "New Material Attribute"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              // Duplicates block the save rather than being silently dropped —
              // the offending row is already red, so the disabled button has an
              // explanation on screen.
              disabled={
                isPending || !itemClassId || !categoryId || hasDuplicateLine || hasDuplicateOption
              }
              onClick={submit}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {/* Single column, header ABOVE the attributes (client 2026-07-27).
              This used to be `lg:grid-cols-2` with the header on the left and
              the attribute lines on the right — but the header holds exactly
              two fields, so the left half was empty for the entire height of
              the attributes panel while the panel itself was squeezed into
              ~570px and every line wrapped. Stacking gives the lines the full
              1180px, which is what lets the picker and the three flags share
              one row instead of three. */}
          {/* The record's IDENTITY, not a section: `(item_class_id,
              category_id)` is the unique key behind
              `uq_material_attributes_class_category`, which is exactly what
              `IdentityRow` is for — a full-width band with no border and no
              caption, because the thing that identifies a record needs none.
              (It replaced a `DetailSection label="Header"`, whose caption named
              nothing and whose chrome cost a row of vertical space.) Same
              treatment as the Material editor's own identity row.

              Category takes the wider track: it is free text and holds the
              longer value, while Item Class is a two-value enum that must not
              sprawl to match it.

              The children are `Field`s with NO `size`. Span classes only
              resolve inside `@container/section` and there is none here, so
              they fall through to the full width of their track — the
              documented fallback (field.tsx), and what lets the tracks below
              own the widths. */}
          <IdentityRow tracks="minmax(0,1fr) minmax(0,1.4fr)">
            <Field
              label="Item Class"
              required
              htmlFor="ma-item-class"
              hint="Sewing and Packing only"
            >
              {/* A plain <Select>, not a picker, and deliberately so: the rest
                  of this form is READ OFF the chosen class. Its attribute
                  values (`scopedAttributeValues`) and its code both come from the
                  selected row, and Category below is scoped to it — so a class
                  created inline would select itself and leave the panel with no
                  attributes to line up. The list is also pre-filtered to the
                  accessory classes this screen is for (see the note below),
                  which a picker's "+ Add" would quietly widen. Item Classes are
                  maintained on their own master. */}
              <Select
                id="ma-item-class"
                value={itemClassId}
                onChange={(e) => changeItemClass(e.target.value)}
              >
                <option value="">— Select —</option>
                {/* `attributes` arrives pre-filtered to accessory classes by the
                    page (see the isAccessoryClass filter there) — this only
                    drops inactive rows. */}
                {attributes
                  .filter((c) => c.is_active || c.id === itemClassId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </Field>
            {/* The label is `Field`'s, not the picker's. Passing `label` down
                made the picker render its OWN <Label> — no `htmlFor`, and a
                plain space before the required marker instead of `ml-0.5` — so
                the two asterisks on this row sat at different offsets and only
                Item Class was click-focusable. */}
            <Field
              label="Category"
              required
              hint={
                !itemClassId
                  ? "Pick an Item Class first."
                  : !editId && availableCategories.length === 0
                    ? "Every category for this Item Class already has a Material Attribute set — edit the existing one from the list instead."
                    : undefined
              }
            >
              <CategoryPicker
                label=""
                categories={availableCategories}
                value={categoryId}
                onChange={setCategoryId}
                itemClassId={itemClassId}
                selectedClassCode={selectedClassCode}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
                levies={levies}
                fabricStructures={fabricStructures}
              />
            </Field>
          </IdentityRow>

          {/* Attribute lines — meaningless until an Item Class scopes the
              pickable values, so keep the placeholder gate here */}
          <div className="space-y-4">
          {!itemClassId ? (
            <div className="rounded-lg border border-dashed border-border bg-surface-muted/50 px-4 py-12 text-center text-sm text-muted-foreground">
              Select an Item Class above to add its attribute lines.
            </div>
          ) : (
          <div>
          {(() => {
            /**
             * THE LEGACY ROW, as columns.
             *
             * One attribute is one line and its flags are columns
             * (`doc/screen/87106156_HRSERVER2772026_111050.png`) — that is what
             * lets eight fields fit where the stacked card fitted three, because
             * the labels come off every row and are said once in the strip above.
             *
             * The track is an inline `gridTemplateColumns`, not a `grid-cols-*`
             * class: column widths are DATA, the same reasoning (and the same
             * technique) as `IdentityRow` in section-grid.tsx. It is declared
             * once and used by both the header strip and every row, so the two
             * cannot drift.
             */
            const ROW_TRACKS =
              "2rem 2.5rem minmax(9rem,1fr) 6.5rem 6rem 6rem 5rem 6rem 6rem 5.5rem 2rem";
            const HEADINGS = [
              "", "#", "Attribute", "Value In Steps",
              "Start Value", "End Value", "Unit", "Step Value",
              "Mandatory", "Blocked", "",
            ];
            const headerStrip = (
              <div
                className="grid items-end gap-x-2 border-b border-border pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                style={{ gridTemplateColumns: ROW_TRACKS }}
              >
                {HEADINGS.map((h, i) => (
                  <div key={i} className={cn(i >= 3 && i <= 9 && "text-center")}>
                    {h}
                  </div>
                ))}
              </div>
            );

            // The picker ALONE — no wrapper, no message underneath. It is the
            // row's identity control and lives in the Attribute column, where a
            // second stacked element would push the line to two rows in the
            // duplicate state. The caller renders the warning under it.
            const attrCell = (l: LineRow, isStar: boolean) => (
              <AttributePicker
                label=""
                values={scopedAttributeValues}
                value={l.attribute_id}
                onChange={(v) => pickAttribute(l.key, v)}
                invalid={!!l.attribute_id && duplicateAttrIds.has(l.attribute_id)}
                // MANDATORY, and the star row is the exemption that makes it
                // usable. `submit()` drops a line with no attribute, so a real
                // row that is blank has been CLEARED and silently loses whatever
                // else is on it — exactly what the hold exists to stop. The
                // trailing star row is blank by design; requiring it would cage
                // the operator on a row they never meant to add.
                //
                // Declared here rather than through `ChildGridColumn.required`
                // because this screen renders `renderMobileRow`, which those
                // columns never reach (child-grid.tsx says so where the prop is
                // defined). The picker's own `required` is the sanctioned second
                // way in, and it is the same prop that draws the `*`.
                required={!isStar}
              />
            );

            /**
             * Start / End / Unit / Step are ALWAYS PRESENT, and disabled unless
             * the line is Value In Steps.
             *
             * Legacy leaves them live and showing `0.00` on every row, stepped or
             * not, which invites an operator to type a range that nothing will
             * ever read. Keeping the columns preserves the rectangle — a grid
             * whose cells appear and disappear per row is not a grid — while
             * disabling them says which rows they belong to. `Input` sets
             * `tabIndex={-1}` on a disabled control itself, so the whole group
             * leaves the Tab order on a non-stepped row without this screen
             * saying anything.
             */
            const numCell = (
              l: LineRow,
              field: "start_value" | "end_value" | "step_value",
            ) => (
              <Input
                type="number"
                step="0.0001"
                className="text-right tabular-nums"
                disabled={!l.value_in_steps}
                value={l[field]}
                onChange={(e) => patchLine(l.key, { [field]: e.target.value })}
              />
            );
            // Typed, not picked from the UOM master (client 2026-07-28). It is
            // only ever printed onto the generated values ("10 MM") — nothing
            // converts by it — so the FK made the user maintain a UOM row for
            // every label they wanted to print.
            const unitCell = (l: LineRow) => (
              <Input
                uppercase
                disabled={!l.value_in_steps}
                value={l.unit_label}
                onChange={(e) => patchLine(l.key, { unit_label: e.target.value })}
                placeholder="MM"
              />
            );
            const flagCell = (l: LineRow, field: "value_in_steps" | "mandatory" | "inactive") => (
              // Centred in its column and `min-h-9` so the box sits on the same
              // 36px control line as the inputs either side of it.
              <div className="flex min-h-9 items-center justify-center">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer accent-primary"
                  checked={l[field]}
                  // Toggling Value In Steps regenerates the value list; the other
                  // two flags don't touch it.
                  onChange={(e) =>
                    field === "value_in_steps"
                      ? patchLine(l.key, { value_in_steps: e.target.checked })
                      : setLineAt(l.key, { [field]: e.target.checked })
                  }
                  aria-label={
                    field === "value_in_steps"
                      ? "Value in steps"
                      : field === "mandatory"
                        ? "Mandatory"
                        : "Blocked"
                  }
                />
              </div>
            );

            /**
             * The line's value list — the single source of the Material form's
             * dropdown.
             *
             * A BORDERED SUB-PANEL WITH ITS OWN HEADER, indented under the
             * Attribute column, which is how legacy nests it. Without the box it
             * read as orphaned (client 2026-08-04): a lone input floating in the
             * band between one attribute row and the next, with nothing saying
             * which row it belonged to. Indentation is not containment — the
             * border is what makes it a child of the row above.
             *
             * `#` earns its column for the same reason legacy has one: it gives
             * the operator something to say ("value 3 is wrong") about a list of
             * otherwise interchangeable text boxes.
             *
             * ONE VALUE PER ROW. That is legacy's shape (its sub-grid lists
             * PLAIN / WITH CENTRE / WITH "O" RING as three rows) and the only one
             * the keyboard can serve: four-across needs the values chunked four
             * to a `data-grid-row` so the arrows stay spatial, and Enter then
             * means "next chunk", which leaves the star row unreachable by the
             * very key meant to reach it. The width the card layout wasted is
             * reclaimed by the columns on the attribute row instead.
             *
             * For a Value-In-Steps line the rows are AUTO-GENERATED from
             * Start/End/Step/Unit and read-only — narrow the range to exclude a
             * value.
             */
            const VALUE_TRACKS = "2.5rem minmax(0,1fr) 2rem";
            const valuesCell = (l: LineRow) => {
              const stepped = l.value_in_steps;
              const dupValues = duplicateOptions.get(l.key);
              return (
                <div className="max-w-xl rounded-md border border-border bg-surface-muted/40 p-2">
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {stepped ? "Generated values" : "Values"}
                    </span>
                    {!stepped && (
                      <span className="text-xs text-muted-foreground">
                        these become the dropdown on the Material form
                      </span>
                    )}
                  </div>

                  {/* Its OWN grid, not just a stack of inputs. Without these
                      markers each value counted as a column of the outer
                      ATTRIBUTE row, so ↓ from "End Value" landed on the second
                      value of the next attribute line and ↓ inside the list
                      jumped lines instead of walking values (client 2026-07-25).
                      `ownDescendants` in child-grid.tsx scopes by nearest marker,
                      so this also removes them from the outer row's axis. */}
                  <div
                    data-grid-body
                    className="space-y-1"
                    onKeyDown={stepped ? undefined : (e) => gridKeyNav(e, () => addOption(l.key))}
                  >
                    {stepped ? (
                      // Read-only text, and there can be a hundred of them, so
                      // they wrap as chips rather than taking a row each. Nothing
                      // here is focusable — hence no row markers.
                      l.options.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Set Start / End / Step on the row above to generate values.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {l.options.map((o) => (
                            <span
                              key={o.key}
                              className="rounded-md border border-border bg-surface px-2 py-1 text-sm tabular-nums text-foreground"
                            >
                              {o.description}
                            </span>
                          ))}
                        </div>
                      )
                    ) : (
                      <>
                        {/* The column header earns its place only once there is
                            a column to head. On an empty list it would be two
                            captions stacked above a button. */}
                        {l.options.length > 0 && (
                          <div
                            className="grid items-center gap-x-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                            style={{ gridTemplateColumns: VALUE_TRACKS }}
                          >
                            <div className="text-center">#</div>
                            <div>Value</div>
                            <div />
                          </div>
                        )}
                        {l.options.map((o, oi) => {
                          const dup = !!dupValues?.has(o.description.trim().toUpperCase());
                          return (
                            // `data-grid-row` on the wrapper, not the grid row: the
                            // duplicate hint below belongs to the same row, and
                            // child-grid finds a row's fields by containment.
                            <div key={o.key} data-grid-row>
                              <div
                                className="grid items-center gap-x-2"
                                style={{ gridTemplateColumns: VALUE_TRACKS }}
                              >
                                <div className="text-center text-xs text-muted-foreground">
                                  {oi + 1}
                                </div>
                                <Input
                                  value={o.description}
                                  uppercase
                                  onChange={(e) => setOptionAt(l.key, o.key, { description: e.target.value })}
                                  placeholder="Type a value…"
                                  aria-invalid={dup ? true : undefined}
                                  className={cn(dup && "border-danger")}
                                />
                                <div className="flex items-center justify-center">
                                  {(
                                    // `data-row-remove` is all this needs: Tab steps
                                    // over every non-field centrally (lib/focus.ts),
                                    // and the marker is what lets Ctrl+Del on this
                                    // value click it.
                                    //
                                    // No per-value Blocked box, though legacy has
                                    // one. It went from stepped rows first — their
                                    // values are derived from Start/End/Step, so the
                                    // way to exclude one is to narrow the range
                                    // (client 2026-07-27) — and the same argument
                                    // finished it for manual lists: the way to
                                    // exclude a value you typed is to remove it
                                    // (client 2026-07-28). `options.blocked` stays in
                                    // the row type, the payload and the DB (0346), so
                                    // a value blocked before that change stays
                                    // blocked rather than being silently re-offered.
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      data-row-remove
                                      className="px-1 text-muted-foreground hover:text-danger"
                                      onClick={() => removeOption(l.key, o.key)}
                                      aria-label={`Remove value ${o.description}`.trim()}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                              {/* Both copies are flagged, not just the later one —
                                  the user is as likely to want to retype the first. */}
                              {dup && (
                                <p className="pl-[3.25rem] text-xs text-danger">
                                  Already listed in this attribute
                                </p>
                              )}
                            </div>
                          );
                        })}
                        {/* A BUTTON, not a permanently open empty box.
                            The values list carried a star row like the attribute
                            grid above it, for symmetry with legacy — but an
                            always-visible blank input in a bordered panel reads
                            as clutter rather than as an invitation, and the
                            client asked for the button back (2026-08-04).

                            The keyboard is unaffected, because the button was
                            never its path: Enter off the last value still opens
                            the next box, and Enter on that box while it is still
                            empty declines and moves the operator to the next
                            attribute. The difference is only that the box now
                            appears when it is asked for. */}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-0.5"
                          onClick={() => addOption(l.key)}
                        >
                          + Add value
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            };
            // Just the value list now, and rendered DIRECTLY — no `FieldGrid`.
            // Start/End/Unit/Step used to live here as a four-field row on the
            // 12-col track; they are columns on the line itself since the grid
            // went tabular, which is the point of the change. `valuesCell` now
            // draws its own bordered panel and owns its own width, so putting it
            // back on that track would make it one column of twelve.
            const specCell = (l: LineRow) => valuesCell(l);
            /** What a collapsed row shows in place of its value list: how many
             *  values it will offer. The flags are columns now, so they no longer
             *  need restating in words. */
            const valueCount = (l: LineRow) => {
              const n = l.options.filter((o) => o.description.trim()).length;
              return n === 1 ? "1 value" : `${n} values`;
            };
            return (
              // `DetailSection` draws the panel and names it once; the grid inside
              // is `frameless` with no caption of its own, so there is one border
              // and one title rather than a card inside a card. The header strip
              // sits between them — the columns belong to the rows, not to the
              // section, and this is the only place both can see the same track.
              <DetailSection label="Attributes">
                {headerStrip}
                <ChildGrid<LineRow>
                label=""
                forceCards
                listRows
                frameless
                rows={lines}
                // NO BUTTON, AND NO KEY THAT ADDS. Rows appear by filling in the
                // trailing star row (`withStarRow`), which is how the legacy grid
                // works and why it needs no "+ Add" anywhere. `hideAdd` also makes
                // `addFn` = `NO_ADD`, which now DECLINES Enter on the last row —
                // so Enter there advances out of the grid instead of dying.
                hideAdd
                onAdd={() => false}
                onRemove={(l) => removeLine(l.key)}
                // Paging is gone with the tall cards: a line is one row now, so a
                // category with a dozen attributes is a dozen rows — legacy shows
                // them all, and §6 forbids capping the height instead.
                columns={[
                  // `listRows` + `renderMobileRow` mean these never render — they
                  // are the fallback if this grid is ever switched to a table.
                  // `required` here as well as on the picker: this column is the
                  // fallback if the grid is ever switched to a table, and that
                  // path DOES honour `ChildGridColumn.required`. `isStar` is
                  // false because a table renders every row the same way — the
                  // star-row exemption belongs to `renderMobileRow`, which is
                  // what actually draws one.
                  { header: "Attribute", cell: (l) => attrCell(l, false), required: true },
                  { header: "Values", cell: valuesCell },
                ]}
                renderMobileRow={(l, i) => {
                  const isOpen = expandedKeys.has(l.key);
                  const dupAttr = !!l.attribute_id && duplicateAttrIds.has(l.attribute_id);
                  const dupValue = (duplicateOptions.get(l.key)?.size ?? 0) > 0;
                  // The star row is the one line that is SUPPOSED to be empty, so
                  // it gets no "#", no chevron and no remove — it is not a record
                  // yet, and offering to delete nothing reads as a bug.
                  const isStar = !l.attribute_id && i === lines.length - 1;
                  return (
                    <div className="space-y-1.5">
                      <div
                        className="grid items-start gap-x-2"
                        style={{ gridTemplateColumns: ROW_TRACKS }}
                      >
                        {/* ⊟ / ⊞, legacy's expander, in its own leading column.
                            A row with no attribute picked has nothing to show, so
                            the chevron only appears once the row is real. */}
                        <div className="flex min-h-9 items-center justify-center">
                          {!isStar && (
                            <button
                              type="button"
                              onClick={() => toggleExpanded(l.key)}
                              aria-expanded={isOpen}
                              aria-label={isOpen ? "Hide values" : "Show values"}
                              className="rounded p-0.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {isOpen ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                          )}
                        </div>
                        <div className="flex min-h-9 items-center justify-center text-xs text-muted-foreground">
                          {isStar ? "*" : i + 1}
                        </div>
                        <div className="min-w-0">
                          {attrCell(l, isStar)}
                          {dupAttr && (
                            <p className="mt-1 text-xs text-danger">Already used in this set</p>
                          )}
                        </div>
                        {flagCell(l, "value_in_steps")}
                        {numCell(l, "start_value")}
                        {numCell(l, "end_value")}
                        {unitCell(l)}
                        {numCell(l, "step_value")}
                        {flagCell(l, "mandatory")}
                        {flagCell(l, "inactive")}
                        <div className="flex min-h-9 items-center justify-center">
                          {!isStar && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              // `data-row-remove` is what Ctrl+Del drives; Tab
                              // steps over it centrally (lib/focus.ts).
                              data-row-remove
                              className="px-1 text-muted-foreground hover:text-danger"
                              onClick={() => removeLine(l.key)}
                              aria-label="Remove attribute"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* The nested block, indented under its own row exactly as
                          legacy indents its values sub-grid. Collapsed, the row
                          says only how many values it holds — and carries the
                          duplicate complaint, because a duplicate blocks Save and
                          the operator may have folded the offending row away. */}
                      {!isStar &&
                        (isOpen ? (
                          <div className="pb-1 pl-[4.5rem] pr-2">{specCell(l)}</div>
                        ) : (
                          <div className="pl-[4.5rem] text-xs text-muted-foreground">
                            {dupValue ? (
                              <span className="text-danger">Duplicate value</span>
                            ) : (
                              valueCount(l)
                            )}
                          </div>
                        ))}
                    </div>
                  );
                }}
                />
              </DetailSection>
            );
          })()}
          </div>
          )}
          </div>
        </div>
      </Sheet>
    </div>
  );
}
