"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
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
import { FilterBar } from "@/components/masters/filter-bar";
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
import type { Commodity } from "@/lib/masters/commodity-types";
import type { Uom } from "@/lib/masters/types";
import { CategoryPicker, AttributePicker } from "@/components/masters/lookup-picker";
import { ChildGrid, gridKeyNav } from "@/components/masters/child-grid";
import { DetailSection } from "@/components/masters/detail-section";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; isSuperAdmin: boolean; canExport?: boolean };

type OptionRow = { key: string; description: string; blocked: boolean };
type LineRow = {
  key: string;
  attribute_id: string;
  value_in_steps: boolean;
  start_value: string;
  end_value: string;
  unit_id: string;
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
 */
export function MaterialAttributeMasterScreen({
  rows,
  attributes,
  categories,
  units,
  levies,
  commodities,
  itemClasses,
  fabricStructures,
  perms,
}: {
  rows: MaterialAttribute[];
  attributes: Attribute[];
  categories: Category[];
  units: Uom[];
  levies: Levy[];
  commodities: Commodity[];
  itemClasses: ConfigLookup[];
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
   * Which attribute line is open for editing — at most one at a time.
   *
   * A line ticked "Value In Steps" grows by a Start/End/Step/Unit row PLUS a
   * generated value list, so a screen with a few filled-in attributes pushed
   * "+ Add attribute" below the fold and the user had to scroll to the bottom
   * to add the next one (client 2026-07-27). Collapsing every line except the
   * one being worked on keeps that button in reach no matter how many
   * attributes the category ends up with.
   *
   * This is NOT the accordion `doc/ui/LAYOUT.md` §4 forbids — that rule is
   * about hiding SECTIONS of one record, where the user needs most of the
   * content at once. These are repeating line items, and §6 already says a row
   * this wide (picker + 3 flags + 4 range fields + an N-row value list) should
   * stop being inlined and get its own editor. A summary row that expands in
   * place is the lighter version of that.
   */
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
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

  const { query, setQuery, filtered, filterValues, setFilter, activeCount, reset } = useMasterFilter<
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
      step_value: "",
      mandatory: false,
      inactive: false,
      options: [],
    };
  }

  function openAdd() {
    setEditId(null);
    setItemClassId("");
    setCategoryId("");
    const first = blankLine();
    setLines([first]);
    setExpandedKey(first.key);
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
            step_value: l.step_value != null ? String(l.step_value) : "",
            mandatory: l.mandatory,
            inactive: l.inactive,
            options: (l.options ?? []).map((o) => ({
              key: newOptKey(),
              description: o.description,
              blocked: o.blocked,
            })),
          }))
        : [blankLine()];
    setLines(built);
    // Stepped lines: re-derive the generated value list from the stored
    // Start/End/Step/Unit so it shows immediately (blocked flags preserved).
    setLines((ls) => ls.map((l) => (l.value_in_steps ? { ...l, options: genOptions(l) } : l)));
    // Open the first line: on an existing record the user is usually here to
    // change one attribute, and a fully collapsed list gives no clue that the
    // rows expand at all.
    setExpandedKey(built[0]?.key ?? null);
    setOpen(true);
  }

  const setLineAt = (key: string, patch: Partial<LineRow>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  /** Adding always opens the new line and closes whatever was open — this is
   *  the "move on to the next attribute" step, and the finished one folds away
   *  behind its summary. */
  const addLine = () => {
    const next = blankLine();
    setLines((ls) => [...ls, next]);
    setExpandedKey(next.key);
  };
  const removeLine = (key: string) => {
    setLines((ls) => ls.filter((l) => l.key !== key));
    setExpandedKey((k) => (k === key ? null : k));
  };

  // Per-line pre-defined value list (legacy nested grid).
  const addOption = (lineKey: string) =>
    setLines((ls) =>
      ls.map((l) =>
        l.key === lineKey
          ? { ...l, options: [...l.options, { key: newOptKey(), description: "", blocked: false }] }
          : l,
      ),
    );
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
        l.key === lineKey ? { ...l, options: l.options.filter((o) => o.key !== optKey) } : l,
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
    const uname = l.unit_id ? units.find((u) => u.id === l.unit_id)?.name ?? "" : "";
    return vals.map((v) => ({
      key: newOptKey(),
      description: uname ? `${v} ${uname}` : String(v),
      blocked: false,
    }));
  };
  // Update a line and, when it is Value-In-Steps, regenerate its value list so
  // the rows stay in sync with the Start/End/Step/Unit fields.
  const patchLine = (key: string, patch: Partial<LineRow>) =>
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, ...patch };
        if (next.value_in_steps) next.options = genOptions(next);
        return next;
      }),
    );

  function submit() {
    startTransition(async () => {
      const payload: MaterialAttributeInput = {
        item_class_id: itemClassId || null,
        category_id: categoryId || null,
        name_separator: NAME_SEPARATOR,
        lines: lines
          .filter((l) => l.attribute_id)
          .map((l, i) => ({
            sno: i + 1,
            attribute_id: l.attribute_id,
            value_in_steps: l.value_in_steps,
            start_value: numOrNull(l.start_value),
            end_value: numOrNull(l.end_value),
            unit_id: l.unit_id || null,
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
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {perms.canEdit && (
            <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
              Edit
            </Button>
          )}
          {perms.canDelete && <DeleteConfirmButton isPending={isPending} onConfirm={() => remove(r)} />}
        </div>
      ),
    },
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
              className="text-base md:text-sm"
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
              className="text-base md:text-sm"
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
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No material attributes yet." />
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
            <Button size="md" disabled={isPending || !itemClassId || !categoryId} onClick={submit}>
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
          <DetailSection label="Header" cols={12}>
            <Field
              label="Item Class"
              required
              size="md"
              htmlFor="ma-item-class"
              hint="Sewing and Packing only"
            >
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
            <Field size="md">
              <CategoryPicker
                label="Category"
                required
                categories={availableCategories}
                value={categoryId}
                onChange={setCategoryId}
                itemClassId={itemClassId}
                selectedClassCode={selectedClassCode}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
                levies={levies}
                commodities={commodities}
                itemClasses={itemClasses}
                fabricStructures={fabricStructures}
              />
              {!itemClassId && (
                <p className="mt-0.5 text-xs text-muted-foreground">Pick an Item Class first.</p>
              )}
              {!editId && itemClassId && availableCategories.length === 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Every category for this Item Class already has a Material Attribute set —
                  edit the existing one from the list instead.
                </p>
              )}
            </Field>
          </DetailSection>

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
            const attrCell = (l: LineRow) => (
              <AttributePicker label="" values={scopedAttributeValues} value={l.attribute_id} onChange={(v) => setLineAt(l.key, { attribute_id: v })} />
            );
            // Start / End / Step / Unit on ONE row (client 2026-07-25) — 2×2 on
            // mobile, four across from sm up.
            // Start / End / Step / Unit on ONE row — changing any of them
            // regenerates the line's value list (patchLine).
            const rangeCell = (l: LineRow) => (
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                <div>
                  <Label className="text-[11px] font-normal text-muted-foreground">Start Value</Label>
                  <Input type="number" step="0.0001" value={l.start_value} onChange={(e) => patchLine(l.key, { start_value: e.target.value })} className="text-base md:text-sm" />
                </div>
                <div>
                  <Label className="text-[11px] font-normal text-muted-foreground">End Value</Label>
                  <Input type="number" step="0.0001" value={l.end_value} onChange={(e) => patchLine(l.key, { end_value: e.target.value })} className="text-base md:text-sm" />
                </div>
                <div>
                  <Label className="text-[11px] font-normal text-muted-foreground">Step Value</Label>
                  <Input type="number" step="0.0001" value={l.step_value} onChange={(e) => patchLine(l.key, { step_value: e.target.value })} className="text-base md:text-sm" />
                </div>
                <div>
                  <Label className="text-[11px] font-normal text-muted-foreground">Unit</Label>
                  <Select value={l.unit_id} onChange={(e) => patchLine(l.key, { unit_id: e.target.value })} className="text-base md:text-sm">
                    <option value="">— None —</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            );
            const flagsCell = (l: LineRow) => (
              <div className="flex flex-wrap gap-3">
                {(
                  [
                    ["value_in_steps", "Value In Steps"],
                    ["mandatory", "Mandatory"],
                    ["inactive", "Blocked"],
                  ] as const
                ).map(([field, label]) => (
                  <label key={field} className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer accent-primary"
                      checked={l[field]}
                      // Toggling Value In Steps regenerates the value list; the
                      // other flags don't touch it.
                      onChange={(e) =>
                        field === "value_in_steps"
                          ? patchLine(l.key, { value_in_steps: e.target.checked })
                          : setLineAt(l.key, { [field]: e.target.checked })
                      }
                    />
                    <span className="text-sm text-foreground">{label}</span>
                  </label>
                ))}
              </div>
            );
            // The line's value list — the single source of the Material form's
            // dropdown. For a Value-In-Steps line the rows are AUTO-GENERATED from
            // Start/End/Step/Unit and are fully read-only — narrow the range to
            // exclude a value. Otherwise they're typed manually and removed with
            // Remove. Neither kind has a per-value Blocked box any more
            // (client 2026-07-28); every configured value is offered.
            const valuesCell = (l: LineRow) => {
              const stepped = l.value_in_steps;
              return (
                <div>
                  <Label className="text-[11px] font-normal text-muted-foreground">
                    {stepped ? "Generated values" : "Values"}
                  </Label>
                  {/* Its OWN grid, not just a stack of inputs. Without these
                      markers each value counted as a column of the outer
                      ATTRIBUTE row, so ↓ from "End Value" landed on the second
                      value of the next attribute line and ↓ inside the list
                      jumped lines instead of walking values (client 2026-07-25).
                      `ownDescendants` in child-grid.tsx scopes by nearest
                      marker, so this also removes them from the outer row's
                      axis. The local handler runs before the outer grid's and
                      stops the key, so Enter on the last value adds a VALUE
                      rather than a whole attribute line. */}
                  <div
                    data-grid-body
                    className="space-y-1.5"
                    onKeyDown={stepped ? undefined : (e) => gridKeyNav(e, () => addOption(l.key))}
                  >
                    {l.options.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        {stepped
                          ? "Set Start / End / Step above to generate values."
                          : "No values yet — add the pick-list the Material form will offer."}
                      </p>
                    )}
                    {l.options.map((o) => (
                      <div key={o.key} data-grid-row className="flex items-center gap-2">
                        {stepped ? (
                          <span className="flex-1 rounded-md border border-border bg-surface-muted px-3 py-1.5 text-sm text-foreground">
                            {o.description}
                          </span>
                        ) : (
                          <Input
                            value={o.description}
                            uppercase
                            onChange={(e) => setOptionAt(l.key, o.key, { description: e.target.value })}
                            placeholder="e.g. MAIN LABEL"
                            className="text-base md:text-sm"
                          />
                        )}
                        {/* No per-value Blocked box. It went from stepped rows
                            first — a stepped line's values are derived from
                            Start/End/Step, so the way to exclude one is to narrow
                            the range (client 2026-07-27) — and the same argument
                            finishes it for manual lists: the way to exclude a
                            value you typed is to Remove it. Between that and the
                            line-level Blocked, a third control that half-hides a
                            single value earned nothing (client 2026-07-28).

                            `options.blocked` is deliberately still in the row
                            type, the payload and the DB (migration 0346): the UI
                            is hidden, the column round-trips, so a value blocked
                            before this change stays blocked rather than being
                            silently re-offered. Its one reader is the
                            `filter((o) => !o.blocked)` in material-master-screen.tsx,
                            which now simply never filters anything out. */}
                        {!stepped && (
                          <Button variant="ghost" size="sm" onClick={() => removeOption(l.key, o.key)}>
                            Remove
                          </Button>
                        )}
                      </div>
                    ))}
                    {!stepped && (
                      <Button variant="outline" size="sm" onClick={() => addOption(l.key)}>
                        + Add value
                      </Button>
                    )}
                  </div>
                </div>
              );
            };
            // Value-In-Steps → the Start/End/Step/Unit row PLUS the generated
            // value list; otherwise just the manual value list.
            const specCell = (l: LineRow) =>
              l.value_in_steps ? (
                <div className="space-y-2">
                  {rangeCell(l)}
                  {valuesCell(l)}
                </div>
              ) : (
                valuesCell(l)
              );
            /** One-line stand-in for a collapsed attribute: what it is, how it
             *  behaves, and how many values it will offer. Enough to recognise
             *  the line without opening it. */
            const summaryOf = (l: LineRow) => {
              const bits: string[] = [];
              if (l.value_in_steps) bits.push("Steps");
              if (l.mandatory) bits.push("Mandatory");
              if (l.inactive) bits.push("Blocked");
              bits.push(l.options.length === 1 ? "1 value" : `${l.options.length} values`);
              return bits.join(" · ");
            };
            return (
              <ChildGrid<LineRow>
                label="Attributes"
                forceCards
                pageSize={6}
                rows={lines}
                onAdd={addLine}
                onRemove={(l) => removeLine(l.key)}
                addLabel="+ Add attribute"
                columns={[
                  { header: "Attribute", cell: attrCell },
                  { header: "Flags", cell: flagsCell },
                  { header: "Range / Values", cell: specCell },
                ]}
                renderMobileRow={(l) => {
                  const isOpen = expandedKey === l.key;
                  const name = attrValueLabel.get(l.attribute_id) ?? "";
                  return (
                    <div className="space-y-2">
                      {/* The line's own header doubles as the expand control.
                          A <button> rather than a click handler on a div so it
                          is reachable by keyboard and announced as a control. */}
                      <button
                        type="button"
                        onClick={() => setExpandedKey(isOpen ? null : l.key)}
                        aria-expanded={isOpen}
                        className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-surface-muted"
                      >
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span
                          className={cn(
                            "truncate text-sm font-medium",
                            name ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {name || "— No attribute picked —"}
                        </span>
                        {!isOpen && (
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                            {summaryOf(l)}
                          </span>
                        )}
                      </button>

                      {isOpen && (
                        <>
                          {/* Picker and flags share one row — only possible now
                              the panel is full width. */}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            <div className="min-w-[14rem] flex-1">{attrCell(l)}</div>
                            <div className="shrink-0">{flagsCell(l)}</div>
                          </div>
                          {specCell(l)}
                        </>
                      )}
                    </div>
                  );
                }}
              />
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
