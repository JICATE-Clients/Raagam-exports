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
import type { Attribute } from "@/lib/masters/extras-types";
import type { Category } from "@/lib/masters/category-types";
import type { Uom } from "@/lib/masters/types";
import { CategoryPicker, AttributePicker, LookupDialogPicker } from "@/components/masters/lookup-picker";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; isSuperAdmin: boolean; canExport?: boolean };

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
};

const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

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
  perms,
}: {
  rows: MaterialAttribute[];
  attributes: Attribute[];
  categories: Category[];
  units: Uom[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [itemClassId, setItemClassId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [lines, setLines] = useState<LineRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `l${keySeq.current++}`;

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
  const scopedAttributeValues = useMemo(
    () => attributes.find((a) => a.id === itemClassId)?.values ?? [],
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
          }))
        : [blankLine()],
    );
    setOpen(true);
  }

  const setLineAt = (key: string, patch: Partial<LineRow>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, blankLine()]);
  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  function submit() {
    startTransition(async () => {
      const payload: MaterialAttributeInput = {
        item_class_id: itemClassId || null,
        category_id: categoryId || null,
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
      header: "Category Short Name",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.category_id ? categoryShortName.get(r.category_id) ?? "—" : "—"}
        </span>
      ),
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
          {perms.canDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-danger"
              disabled={isPending}
              onClick={() => remove(r)}
            >
              Delete
            </Button>
          )}
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
          {/* header */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LookupDialogPicker
              kind="item_class"
              label="Item Class"
              required
              options={attributes}
              value={itemClassId}
              onChange={changeItemClass}
              canCreate={perms.canCreate}
              canEdit={perms.canEdit}
              canDelete={perms.canDelete}
              isSuperAdmin={perms.isSuperAdmin}
            />
            <div>
              <CategoryPicker
                label="Category"
                required
                categories={scopedCategories}
                value={categoryId}
                onChange={setCategoryId}
                itemClassId={itemClassId}
                canCreate={perms.canCreate}
                canEdit={perms.canEdit}
                canDelete={perms.canDelete}
              />
              {!itemClassId && (
                <p className="mt-1 text-xs text-muted-foreground">Pick an Item Class first.</p>
              )}
            </div>
            <div>
              <Label>Category Short Name</Label>
              <Input
                readOnly
                disabled
                value={categoryId ? categoryShortName.get(categoryId) ?? "—" : ""}
                placeholder="Pick a Category first"
                className="text-base md:text-sm"
              />
            </div>
          </div>

          {/* line cards */}
          <div className="space-y-2 border-t border-border pt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Attributes</div>
            {lines.map((l, i) => (
              <div key={l.key} className="space-y-2.5 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">#{i + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-danger"
                    onClick={() => removeLine(l.key)}
                    aria-label="Remove attribute"
                  >
                    ✕
                  </Button>
                </div>
                <div>
                  <AttributePicker
                    label="Attribute"
                    values={scopedAttributeValues}
                    value={l.attribute_id}
                    onChange={(v) => setLineAt(l.key, { attribute_id: v })}
                  />
                  {!itemClassId && (
                    <p className="mt-1 text-xs text-muted-foreground">Pick an Item Class first.</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Start Value</Label>
                    <Input
                      type="number"
                      step="0.0001"
                      value={l.start_value}
                      onChange={(e) => setLineAt(l.key, { start_value: e.target.value })}
                      className="text-base md:text-sm"
                    />
                  </div>
                  <div>
                    <Label>End Value</Label>
                    <Input
                      type="number"
                      step="0.0001"
                      value={l.end_value}
                      onChange={(e) => setLineAt(l.key, { end_value: e.target.value })}
                      className="text-base md:text-sm"
                    />
                  </div>
                  <div>
                    <Label>Step Value</Label>
                    <Input
                      type="number"
                      step="0.0001"
                      value={l.step_value}
                      onChange={(e) => setLineAt(l.key, { step_value: e.target.value })}
                      className="text-base md:text-sm"
                    />
                  </div>
                  <div>
                    <Label>Unit</Label>
                    <Select
                      value={l.unit_id}
                      onChange={(e) => setLineAt(l.key, { unit_id: e.target.value })}
                      className="text-base md:text-sm"
                    >
                      <option value="">— None —</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.code} — {u.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 pt-0.5">
                  {(
                    [
                      ["value_in_steps", "Value in steps"],
                      ["mandatory", "Mandatory"],
                      ["inactive", "Inactive"],
                    ] as const
                  ).map(([field, label]) => (
                    <label key={field} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer accent-primary"
                        checked={l[field]}
                        onChange={(e) => setLineAt(l.key, { [field]: e.target.checked })}
                      />
                      <span className="text-sm text-foreground">{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addLine}>
              + Add attribute
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
