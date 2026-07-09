"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import {
  createMaterialAttribute,
  updateMaterialAttribute,
  deleteMaterialAttribute,
} from "@/lib/masters/material-attribute-actions";
import {
  ITEM_CLASSES,
  type MaterialAttribute,
  type MaterialAttributeInput,
} from "@/lib/masters/material-attribute-types";
import type { Attribute, ConfigLookup } from "@/lib/masters/extras-types";
import type { Uom } from "@/lib/masters/types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

type LineRow = {
  key: string;
  attribute_id: string;
  value_in_steps: boolean;
  start_value: string;
  end_value: string;
  unit_id: string;
  step_value: string;
  mandatory: boolean;
  blocked: boolean;
};

const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

export function MaterialAttributeMasterScreen({
  rows,
  attributes,
  categories,
  units,
  perms,
}: {
  rows: MaterialAttribute[];
  attributes: Attribute[];
  categories: ConfigLookup[];
  units: Uom[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [itemClass, setItemClass] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [lines, setLines] = useState<LineRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `l${keySeq.current++}`;

  const categoryName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);
  const attrCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of attributes) m.set(a.id, a.code);
    return m;
  }, [attributes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.item_class, categoryName.get(r.category_id ?? ""), ...r.lines.map((l) => attrCode.get(l.attribute_id ?? ""))]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query, categoryName, attrCode]);

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
      blocked: false,
    };
  }

  function openAdd() {
    setEditId(null);
    setItemClass("");
    setCategoryId("");
    setLines([blankLine()]);
    setOpen(true);
  }
  function openEdit(r: MaterialAttribute) {
    setEditId(r.id);
    setItemClass(r.item_class ?? "");
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
            blocked: l.blocked,
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
        item_class: itemClass || null,
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
            blocked: l.blocked,
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
    { header: "Item Class", cell: (r) => <span className="text-sm">{r.item_class ?? "—"}</span> },
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

  const attrLabel = (a: Attribute) => (a.description ? `${a.code} — ${a.description}` : a.code);

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search material attributes…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Material Attribute
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No material attributes yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No material attributes yet.
          </div>
        ) : (
          filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => perms.canEdit && openEdit(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="text-[15px] font-semibold text-foreground">{r.item_class ?? "—"}</div>
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
            <Button size="md" disabled={isPending || !itemClass || !categoryId} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* header */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="ma-class">
                Item Class <span className="text-danger">*</span>
              </Label>
              <Select
                id="ma-class"
                value={itemClass}
                onChange={(e) => setItemClass(e.target.value)}
                className="text-base md:text-sm"
              >
                <option value="">— Select —</option>
                {ITEM_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="ma-cat">
                Category <span className="text-danger">*</span>
              </Label>
              <Select
                id="ma-cat"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="text-base md:text-sm"
              >
                <option value="">— Select —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
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
                  <Label>Attribute</Label>
                  <Select
                    value={l.attribute_id}
                    onChange={(e) => setLineAt(l.key, { attribute_id: e.target.value })}
                    className="text-base md:text-sm"
                  >
                    <option value="">— Select attribute —</option>
                    {attributes.map((a) => (
                      <option key={a.id} value={a.id}>
                        {attrLabel(a)}
                      </option>
                    ))}
                  </Select>
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
                      ["blocked", "Blocked"],
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
