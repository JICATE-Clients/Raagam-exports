"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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
  // quick-create mini-child renders (here always PACK/SEW → User Defined).
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
    setLines([blankLine()]);
    setOpen(true);
  }
  function openEdit(r: MaterialAttribute) {
    setEditId(r.id);
    setItemClassId(r.item_class_id ?? "");
    setCategoryId(r.category_id ?? "");
    setLines(
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
        : [blankLine()],
    );
    // Stepped lines: re-derive the generated value list from the stored
    // Start/End/Step/Unit so it shows immediately (blocked flags preserved).
    setLines((ls) => ls.map((l) => (l.value_in_steps ? { ...l, options: genOptions(l) } : l)));
    setOpen(true);
  }

  const setLineAt = (key: string, patch: Partial<LineRow>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, blankLine()]);
  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

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

  // Regenerate a Value-In-Steps line's value list from Start/End/Step/Unit,
  // preserving any per-value Blocked flags across the change (matched by
  // description). This is what auto-fills "0 MM, 10 MM … 100 MM" (legacy 2100).
  const genOptions = (l: LineRow): OptionRow[] => {
    const vals = previewSteps(numOrNull(l.start_value), numOrNull(l.end_value), numOrNull(l.step_value));
    const uname = l.unit_id ? units.find((u) => u.id === l.unit_id)?.name ?? "" : "";
    const prevBlocked = new Map(l.options.map((o) => [o.description, o.blocked]));
    return vals.map((v) => {
      const description = uname ? `${v} ${uname}` : String(v);
      return { key: newOptKey(), description, blocked: prevBlocked.get(description) ?? false };
    });
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
        <div className="space-y-4">
          {/* Two-column body — header fields LEFT, attribute-lines grid RIGHT
              (Material form design). Stacks on mobile via grid-cols-1. */}
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            {/* LEFT: header fields */}
            <div className="space-y-4">
              <DetailSection label="Header" cols={2}>
                <div>
                  <Label htmlFor="ma-item-class">
                    Item Class <span className="text-danger">*</span>
                  </Label>
                  <Select
                    id="ma-item-class"
                    value={itemClassId}
                    onChange={(e) => changeItemClass(e.target.value)}
                    className="text-base md:text-sm"
                  >
                    <option value="">— Select —</option>
                    {attributes
                      .filter((c) => c.is_active || c.id === itemClassId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </Select>
                </div>
                <div>
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
                    <p className="mt-1 text-xs text-muted-foreground">Pick an Item Class first.</p>
                  )}
                  {!editId && itemClassId && availableCategories.length === 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Every category for this Item Class already has a Material Attribute set —
                      edit the existing one from the list instead.
                    </p>
                  )}
                </div>
              </DetailSection>
            </div>

            {/* RIGHT: attribute lines — meaningless until an Item Class scopes the
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
            // Start/End/Step/Unit (Description read-only, per-row Blocked still
            // editable, no add/remove). Otherwise they're typed manually.
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
                        <label className="flex shrink-0 cursor-pointer items-center gap-1.5">
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer accent-primary"
                            checked={o.blocked}
                            onChange={(e) => setOptionAt(l.key, o.key, { blocked: e.target.checked })}
                          />
                          <span className="text-xs text-muted-foreground">Blocked</span>
                        </label>
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
                renderMobileRow={(l) => (
                  <>
                    {attrCell(l)}
                    {flagsCell(l)}
                    {specCell(l)}
                  </>
                )}
              />
            );
          })()}
          </div>
          )}
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
